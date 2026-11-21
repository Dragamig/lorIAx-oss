import { NextRequest, NextResponse } from "next/server";
import { db } from "@/lib/db";
import { brandKits, organizationMembers } from "@/lib/db/schema-org";
import { eq, and } from "drizzle-orm";
import { requireOrgScoped, OrgScopeError } from "@/lib/auth/require-org-scoped";
import { isGlobalAdmin } from "@/lib/auth/check-access";
import { brandKitSchema, EMPTY_BRAND_KIT, logoMediaId } from "@/lib/studio/brand-kit-schema";
import { getMediaForAccess, resolveMediaAccess } from "@/lib/media/access";
import { isOrgWideSpace } from "@/lib/media/org-wide";

// GET /api/studio/brand-kit — kit de l'organisation courante (tout membre)
export async function GET(req: NextRequest) {
  try {
    const ctx = await requireOrgScoped({}, req);
    const [kit] = await db
      .select()
      .from(brandKits)
      .where(eq(brandKits.organizationId, ctx.orgId))
      .limit(1);
    if (!kit) return NextResponse.json(EMPTY_BRAND_KIT);
    return NextResponse.json({
      colors: kit.colors,
      logos: kit.logos,
      fontHeading: kit.fontHeading,
      fontBody: kit.fontBody,
    });
  } catch (e) {
    if (e instanceof OrgScopeError) return e.response;
    throw e;
  }
}

// PUT /api/studio/brand-kit — upsert (admin/owner de l'org, ou admin global)
export async function PUT(req: NextRequest) {
  try {
    const ctx = await requireOrgScoped({}, req);

    if (!isGlobalAdmin(ctx.user)) {
      const [membership] = await db
        .select({ role: organizationMembers.role })
        .from(organizationMembers)
        .where(
          and(
            eq(organizationMembers.organizationId, ctx.orgId),
            eq(organizationMembers.userId, ctx.user.id)
          )
        )
        .limit(1);
      if (!membership || (membership.role !== "owner" && membership.role !== "admin")) {
        return NextResponse.json(
          { error: "Réservé aux administrateurs de l'organisation" },
          { status: 403 }
        );
      }
    }

    let body: unknown;
    try {
      body = await req.json();
    } catch {
      return NextResponse.json({ error: "Corps JSON invalide" }, { status: 400 });
    }
    const parsed = brandKitSchema.safeParse(body);
    if (!parsed.success) {
      return NextResponse.json({ error: "Données invalides" }, { status: 400 });
    }

    // Logos de la médiathèque : seuls les logos NOUVEAUX (identifiant absent du
    // kit enregistré) sont validés, un logo déjà en place passé en corbeille ne
    // doit pas bloquer la sauvegarde. Un nouveau logo doit être de l'organisation,
    // lisible par l'utilisateur ET par tous les membres (espace d'organisation,
    // voir `isOrgWideSpace`). Même réponse pour tout refus.
    const [stored] = await db
      .select({ logos: brandKits.logos })
      .from(brandKits)
      .where(eq(brandKits.organizationId, ctx.orgId))
      .limit(1);
    const known = new Set<string>();
    for (const logo of stored?.logos ?? []) {
      const id = logoMediaId(logo.url);
      if (id) known.add(id);
    }
    const mediaIds = new Set<string>();
    for (const logo of parsed.data.logos) {
      const id = logoMediaId(logo.url);
      if (id && !known.has(id)) mediaIds.add(id);
    }
    for (const id of mediaIds) {
      const row = await getMediaForAccess(id);
      const access =
        row && row.organizationId === ctx.orgId && !row.deletedAt
          ? await resolveMediaAccess(ctx.user, row, "read", { orgId: ctx.orgId })
          : null;
      if (!row || !access?.allowed || !(await isOrgWideSpace(row.spaceId, ctx.orgId))) {
        return NextResponse.json({ error: "Média introuvable" }, { status: 400 });
      }
    }

    await db
      .insert(brandKits)
      .values({ organizationId: ctx.orgId, ...parsed.data })
      .onConflictDoUpdate({
        target: brandKits.organizationId,
        set: { ...parsed.data, updatedAt: new Date() },
      });

    return NextResponse.json({ ok: true });
  } catch (e) {
    if (e instanceof OrgScopeError) return e.response;
    throw e;
  }
}
