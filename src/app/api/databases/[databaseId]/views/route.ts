import { NextResponse } from "next/server";
import { db } from "@/lib/db";
import { userDatabaseViews, VIEW_SCOPES } from "@/lib/db/schema";
import { and, eq, sql } from "drizzle-orm";
import { requireOrgScoped, OrgScopeError } from "@/lib/auth/require-org-scoped";
import { z } from "zod";
import { viewConfigSchema } from "@/lib/bases/view-config";
import { decideViewCreate, listVisibleViews } from "@/lib/databases/view-access";

type RouteParams = { params: Promise<{ databaseId: string }> };

/** Violation d'unicité PostgreSQL (le code peut être porté par `cause` selon la version du pilote). */
function isUniqueViolation(e: unknown): boolean {
  const err = e as { code?: string; cause?: { code?: string } } | null;
  return err?.code === "23505" || err?.cause?.code === "23505";
}

export async function GET(_request: Request, { params }: RouteParams) {
  const { databaseId } = await params;
  let ctx;
  try {
    ctx = await requireOrgScoped({ resource: { type: "database", id: databaseId }, minPermission: "viewer" });
  } catch (e) {
    if (e instanceof OrgScopeError) return e.response;
    throw e;
  }

  const views = await listVisibleViews(db, databaseId, ctx.user.id);
  return NextResponse.json(views);
}

const viewTypeEnum = z.enum(["grid", "kanban", "gallery", "calendar", "form", "dashboard"]);

const createSchema = z.object({
  name: z.string().min(1).max(255),
  type: viewTypeEnum,
  config: viewConfigSchema.optional(),
  isDefault: z.boolean().optional(),
  isPublic: z.boolean().optional(),
  scope: z.enum(VIEW_SCOPES).optional(),
});

export async function POST(request: Request, { params }: RouteParams) {
  const { databaseId } = await params;
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

  const body = await request.json();
  const parsed = createSchema.safeParse(body);
  if (!parsed.success) {
    return NextResponse.json({ error: parsed.error.issues[0].message }, { status: 400 });
  }

  const scope = parsed.data.scope ?? "shared";
  const decision = decideViewCreate({
    scope,
    isDefault: parsed.data.isDefault,
    isPublic: parsed.data.isPublic,
  });
  if (!decision.ok) {
    return NextResponse.json({ error: decision.error }, { status: decision.status });
  }

  try {
    const view = await db.transaction(async (tx) => {
      const [maxPos] = await tx
        .select({ max: sql<number>`COALESCE(MAX(${userDatabaseViews.position}), -1)` })
        .from(userDatabaseViews)
        .where(
          and(
            eq(userDatabaseViews.databaseId, databaseId),
            eq(userDatabaseViews.scope, scope),
            // Vues personnelles : seules celles de l'appelant comptent (aucune fuite d'existence).
            scope === "personal" ? eq(userDatabaseViews.createdBy, ctx.user.id) : undefined,
          ),
        );

      // Défaut demandé : démarquer les autres défauts, parmi les vues partagées seulement
      if (parsed.data.isDefault) {
        await tx
          .update(userDatabaseViews)
          .set({ isDefault: false })
          .where(and(eq(userDatabaseViews.databaseId, databaseId), eq(userDatabaseViews.scope, "shared")));
      }

      const [created] = await tx
        .insert(userDatabaseViews)
        .values({
          databaseId,
          name: parsed.data.name,
          type: parsed.data.type,
          config: parsed.data.config ?? { filters: [], sorts: [], visibleColumns: "*", version: "v1" },
          isDefault: parsed.data.isDefault ?? false,
          scope,
          position: (maxPos?.max ?? -1) + 1,
          createdBy: ctx.user.id,
        })
        .returning();
      return created;
    });
    return NextResponse.json(view, { status: 201 });
  } catch (e) {
    if (isUniqueViolation(e)) {
      return NextResponse.json({ error: "Nom déjà utilisé" }, { status: 409 });
    }
    throw e;
  }
}
