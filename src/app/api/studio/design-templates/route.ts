import { NextRequest, NextResponse } from "next/server";
import { db } from "@/lib/db";
import { designTemplates } from "@/lib/db/schema";
import { eq, or, inArray } from "drizzle-orm";
import { requireOrgScoped, OrgScopeError } from "@/lib/auth/require-org-scoped";
import { getAccessibleSpaceIds } from "@/lib/auth/check-access";
import { canManageTemplateCategory, DESIGN_TEMPLATE_CATEGORY } from "@/lib/auth/rbac";
import { z } from "zod";
import type { DesignDocument } from "@/components/editor/extensions/design-constants";

// GET /api/studio/design-templates — liste des modèles de design accessibles
// (globaux + ceux des espaces accessibles à l'utilisateur dans l'org courante).
// N'inclut PAS le `content` volumineux — juste de quoi alimenter le builder (T6).
export async function GET(req: NextRequest) {
  try {
    const ctx = await requireOrgScoped({}, req);
    const accessibleIds = await getAccessibleSpaceIds(ctx.user);

    const rows = await db
      .select({
        id: designTemplates.id,
        name: designTemplates.name,
        category: designTemplates.category,
        variables: designTemplates.variables,
        isGlobal: designTemplates.isGlobal,
        spaceId: designTemplates.spaceId,
      })
      .from(designTemplates)
      .where(
        accessibleIds.length > 0
          ? or(
              eq(designTemplates.isGlobal, true),
              inArray(designTemplates.spaceId, accessibleIds)
            )
          : eq(designTemplates.isGlobal, true)
      )
      .orderBy(designTemplates.name);

    return NextResponse.json(rows);
  } catch (e) {
    if (e instanceof OrgScopeError) return e.response;
    throw e;
  }
}

const designVariableSchema = z.object({
  key: z.string().min(1),
  label: z.string().min(1),
  layerId: z.string().min(1),
});

const createDesignTemplateSchema = z.object({
  name: z.string().min(1),
  category: z.string().max(100).optional(),
  isGlobal: z.boolean().optional(),
  // DesignDocument ({ version:2, title, pages:[...] }) — validation légère puis cast.
  content: z.object({}).passthrough(),
  variables: z.array(designVariableSchema).default([]),
  spaceId: z.string().uuid().optional(),
});

// POST /api/studio/design-templates — crée un modèle de design.
// - isGlobal: true → un template GLOBAL est système (pas d'organization_id) : sa
//   création exige un rôle GLOBAL, pas un simple admin d'org (sinon un admin
//   pourrait publier un modèle visible/instanciable dans TOUTES les orgs). On
//   gate donc comme la route sœur POST /api/templates, via
//   canManageTemplateCategory sur la catégorie « design » (Studio).
// - sinon → un spaceId VALIDE (membre, permission éditeur) est requis, car le
//   siloing de instantiateDesignTemplate rend inaccessible un template d'espace
//   sans spaceId cohérent.
export async function POST(req: NextRequest) {
  try {
    const ctx = await requireOrgScoped({}, req);

    let body: unknown;
    try {
      body = await req.json();
    } catch {
      return NextResponse.json({ error: "Corps JSON invalide" }, { status: 400 });
    }

    const parsed = createDesignTemplateSchema.safeParse(body);
    if (!parsed.success) {
      return NextResponse.json(
        { error: parsed.error.issues[0]?.message ?? "Données invalides" },
        { status: 400 }
      );
    }
    const { name, category, isGlobal, content, variables, spaceId } = parsed.data;

    let scopedSpaceId: string | null = null;

    if (isGlobal) {
      // Modèle GLOBAL (système, cross-org) : rôle global requis. Un template de
      // design relève de la catégorie « design » → super_admin/admin OU badge
      // template_graphic_editor (cf. canManageTemplateCategory). Un simple
      // admin d'org NE suffit PAS.
      if (
        !canManageTemplateCategory(
          ctx.user.globalRole,
          ctx.user.capabilities,
          DESIGN_TEMPLATE_CATEGORY
        )
      ) {
        return NextResponse.json(
          { error: "Droits insuffisants pour créer ce modèle global" },
          { status: 403 }
        );
      }
    } else {
      // Modèle d'espace : le spaceId est obligatoire et doit être un espace de
      // l'org courante sur lequel l'utilisateur a au moins la permission éditeur.
      if (!spaceId) {
        return NextResponse.json(
          { error: "Un espace est requis pour un modèle non global" },
          { status: 400 }
        );
      }
      // requireOrgScoped(resource:space) : 404 si l'espace n'est pas dans l'org,
      // 403 si permission insuffisante — renvoyés tels quels via OrgScopeError.
      const spaceCtx = await requireOrgScoped(
        { resource: { type: "space", id: spaceId }, minPermission: "editor" },
        req
      );
      scopedSpaceId = spaceCtx.spaceId ?? spaceId;
    }

    const [row] = await db
      .insert(designTemplates)
      .values({
        name,
        category: category ?? null,
        content: content as unknown as DesignDocument,
        variables,
        isGlobal: isGlobal ?? false,
        spaceId: scopedSpaceId,
        createdBy: ctx.user.id,
      })
      .returning({ id: designTemplates.id });

    return NextResponse.json({ id: row.id }, { status: 201 });
  } catch (e) {
    if (e instanceof OrgScopeError) return e.response;
    throw e;
  }
}
