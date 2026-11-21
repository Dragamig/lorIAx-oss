import { NextRequest, NextResponse } from "next/server";
import { db } from "@/lib/db";
import { templates } from "@/lib/db/schema";
import { eq, or } from "drizzle-orm";
import { getSessionUser } from "@/lib/auth/get-user";
import { getAccessibleSpaceIds } from "@/lib/auth/check-access";
import { canManageTemplateCategory } from "@/lib/auth/rbac";
import { z } from "zod";
import { BUILTIN_TEMPLATES } from "@/lib/templates/builtin";
import { deriveTemplateVariables } from "@/lib/automations/template-variables";

export async function GET(request: NextRequest) {
  const user = await getSessionUser();
  if (!user) return NextResponse.json([], { status: 401 });

  const spaceId = request.nextUrl.searchParams.get("spaceId");

  // Cloisonnement multi-tenant : on n'honore un `spaceId` que si l'espace est
  // accessible dans l'org courante. Sinon, on ne retourne que les modèles globaux.
  let scopedSpaceId: string | null = null;
  if (spaceId) {
    const accessibleIds = await getAccessibleSpaceIds(user);
    if (accessibleIds.includes(spaceId)) scopedSpaceId = spaceId;
  }

  const dbTemplates = await db
    .select()
    .from(templates)
    .where(
      scopedSpaceId
        ? or(eq(templates.isGlobal, true), eq(templates.spaceId, scopedSpaceId))
        : eq(templates.isGlobal, true)
    )
    .orderBy(templates.category, templates.name);

  // Merge builtins (non surchargés par un enregistrement DB du même nom)
  const dbNames = new Set(dbTemplates.map((t) => t.name));
  const builtins = BUILTIN_TEMPLATES.filter((t) => !dbNames.has(t.name));

  const all = [...builtins, ...dbTemplates].sort((a, b) => {
    const catCmp = (a.category ?? "").localeCompare(b.category ?? "", "fr");
    if (catCmp !== 0) return catCmp;
    return a.name.localeCompare(b.name, "fr");
  });

  return NextResponse.json(all);
}

const createTemplateSchema = z.object({
  name: z.string().min(1),
  description: z.string().optional(),
  content: z.any(),
  icon: z.string().optional(),
  category: z.string().optional(),
  isGlobal: z.boolean().optional(),
  spaceId: z.string().uuid().optional(),
});

export async function POST(request: Request) {
  const user = await getSessionUser();
  if (!user) return NextResponse.json({ error: "Non authentifié" }, { status: 401 });

  const body = await request.json();
  const parsed = createTemplateSchema.safeParse(body);
  if (!parsed.success) {
    return NextResponse.json({ error: parsed.error.issues[0].message }, { status: 400 });
  }

  // Si isGlobal: true, vérifier les droits selon la catégorie du modèle
  // (admin/super_admin partout, sinon l'éditeur de modèles dédié à la catégorie).
  if (parsed.data.isGlobal) {
    if (!canManageTemplateCategory(user.globalRole, user.capabilities, parsed.data.category)) {
      return NextResponse.json(
        { error: "Droits insuffisants pour créer ce modèle global" },
        { status: 403 }
      );
    }
  }

  // Modèle attaché à un espace : l'espace doit être accessible dans l'org
  // courante (anti-fuite cross-tenant : pas de modèle greffé sur l'espace d'un autre tenant).
  if (parsed.data.spaceId) {
    const accessibleIds = await getAccessibleSpaceIds(user);
    if (!accessibleIds.includes(parsed.data.spaceId)) {
      return NextResponse.json({ error: "Espace introuvable" }, { status: 404 });
    }
  }

  const variables = deriveTemplateVariables(parsed.data.content);

  const [template] = await db
    .insert(templates)
    .values({
      ...parsed.data,
      variables,
      createdBy: user.id,
    })
    .returning();

  return NextResponse.json(template, { status: 201 });
}
