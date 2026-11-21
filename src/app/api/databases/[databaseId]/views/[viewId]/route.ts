import { NextResponse } from "next/server";
import { db } from "@/lib/db";
import { userDatabaseViews, VIEW_SCOPES } from "@/lib/db/schema";
import { eq, and } from "drizzle-orm";
import { requireOrgScoped, OrgScopeError } from "@/lib/auth/require-org-scoped";
import { z } from "zod";
import { decideViewDelete, decideViewUpdate, getVisibleView } from "@/lib/databases/view-access";
import { viewConfigSchema } from "@/lib/bases/view-config";

type RouteParams = { params: Promise<{ databaseId: string; viewId: string }> };

const updateSchema = z.object({
  name: z.string().min(1).max(255).optional(),
  config: viewConfigSchema.optional(),
  isDefault: z.boolean().optional(),
  isPublic: z.boolean().optional(),
  position: z.number().int().min(0).optional(),
  scope: z.enum(VIEW_SCOPES).optional(),
});

function isUniqueViolation(e: unknown): boolean {
  const err = e as { code?: string; cause?: { code?: string } } | null;
  return err?.code === "23505" || err?.cause?.code === "23505";
}

const NOT_FOUND = () => NextResponse.json({ error: "Introuvable" }, { status: 404 });

/**
 * Génère un token public opaque (32+ bytes en base64url). Voir spec §4 R6.
 */
function generatePublicToken(): string {
  const bytes = new Uint8Array(32);
  crypto.getRandomValues(bytes);
  return Buffer.from(bytes)
    .toString("base64")
    .replace(/\+/g, "-")
    .replace(/\//g, "_")
    .replace(/=+$/, "");
}

export async function PATCH(request: Request, { params }: RouteParams) {
  const { databaseId, viewId } = await params;
  let ctx;
  try {
    ctx = await requireOrgScoped({
      resource: { type: "database", id: databaseId },
      minPermission: "editor",
    });
  } catch (e) {
    if (e instanceof OrgScopeError) return e.response;
    throw e;
  }

  // Vue inexistante, d'une autre base ou personnelle d'un autre : même 404
  const snapshot = await getVisibleView(db, databaseId, viewId, ctx.user.id);
  if (!snapshot) return NOT_FOUND();

  const body = await request.json();
  const parsed = updateSchema.safeParse(body);
  if (!parsed.success) {
    return NextResponse.json({ error: parsed.error.issues[0].message }, { status: 400 });
  }
  const fields = parsed.data;

  try {
    const result = await db.transaction(async (tx) => {
      const decision = await decideViewUpdate(tx, {
        view: snapshot,
        userId: ctx.user.id,
        patch: { scope: fields.scope, isDefault: fields.isDefault, isPublic: fields.isPublic },
      });
      if (!decision.ok) return { error: decision, updated: undefined };
      const existing = decision.view;

      if (decision.unsetDefaultOthers) {
        await tx
          .update(userDatabaseViews)
          .set({ isDefault: false })
          .where(and(eq(userDatabaseViews.databaseId, databaseId), eq(userDatabaseViews.scope, "shared")));
      }

      const updates: Record<string, unknown> = { ...fields, updatedAt: new Date() };
      // Merge shallow de config pour préserver les clés non passées.
      if (fields.config) {
        const existingConfig = (existing.config as Record<string, unknown> | null | undefined) ?? {};
        updates.config = { ...existingConfig, ...fields.config };
      }
      // publicToken : généré quand isPublic passe à true, révoqué quand isPublic passe à false
      // ou quand la vue devient personnelle.
      if (fields.isPublic === true && !existing.publicToken) {
        updates.publicToken = generatePublicToken();
      } else if (fields.isPublic === false || decision.revokePublicToken) {
        updates.publicToken = null;
        updates.isPublic = false;
      }

      const [updated] = await tx
        .update(userDatabaseViews)
        .set(updates)
        .where(eq(userDatabaseViews.id, viewId))
        .returning();
      return { error: undefined, updated };
    });
    if (result.error) {
      return NextResponse.json({ error: result.error.error }, { status: result.error.status });
    }
    return NextResponse.json(result.updated);
  } catch (e) {
    if (isUniqueViolation(e)) {
      return NextResponse.json({ error: "Nom déjà utilisé" }, { status: 409 });
    }
    throw e;
  }
}

export async function DELETE(_request: Request, { params }: RouteParams) {
  const { databaseId, viewId } = await params;
  let ctx;
  try {
    ctx = await requireOrgScoped({
      resource: { type: "database", id: databaseId },
      minPermission: "editor",
    });
  } catch (e) {
    if (e instanceof OrgScopeError) return e.response;
    throw e;
  }

  const snapshot = await getVisibleView(db, databaseId, viewId, ctx.user.id);
  if (!snapshot) return NOT_FOUND();

  const result = await db.transaction(async (tx) => {
    const decision = await decideViewDelete(tx, { view: snapshot, userId: ctx.user.id });
    if (!decision.ok) return decision;

    await tx.delete(userDatabaseViews).where(eq(userDatabaseViews.id, viewId));

    // Vue par défaut supprimée : promouvoir la première vue partagée
    if (decision.promoteDefault) {
      const [newDefault] = await tx
        .select({ id: userDatabaseViews.id })
        .from(userDatabaseViews)
        .where(and(eq(userDatabaseViews.databaseId, databaseId), eq(userDatabaseViews.scope, "shared")))
        .orderBy(userDatabaseViews.position)
        .limit(1);
      if (newDefault) {
        await tx.update(userDatabaseViews).set({ isDefault: true }).where(eq(userDatabaseViews.id, newDefault.id));
      }
    }
    return decision;
  });
  if (!result.ok) {
    return NextResponse.json({ error: result.error }, { status: result.status });
  }
  return NextResponse.json({ ok: true });
}
