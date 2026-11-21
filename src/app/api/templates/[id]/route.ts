import { NextRequest, NextResponse } from "next/server";
import { db } from "@/lib/db";
import { templates } from "@/lib/db/schema";
import { eq } from "drizzle-orm";
import { getSessionUser } from "@/lib/auth/get-user";
import { getAccessibleSpaceIds } from "@/lib/auth/check-access";
import { canManageTemplateCategory } from "@/lib/auth/rbac";
import { z } from "zod";
import { getBuiltinTemplateById } from "@/lib/templates/builtin";
import { deriveTemplateVariables } from "@/lib/automations/template-variables";
import type { SessionUser } from "@/types";

/**
 * Cloisonnement multi-tenant des modèles DB : un modèle est accessible dans
 * l'org courante s'il est global (instance-wide, cf. route liste) ou attaché à
 * un espace accessible dans cette org. Un modèle greffé sur l'espace d'un autre
 * tenant ne résout jamais → l'appelant renvoie 404 (fail-closed). Mirroir de
 * la logique de visibilité de `GET /api/templates`.
 */
async function isTemplateAccessible(
  user: SessionUser,
  template: { isGlobal: boolean; spaceId: string | null }
): Promise<boolean> {
  if (template.isGlobal) return true;
  if (!template.spaceId) return false;
  const accessibleIds = await getAccessibleSpaceIds(user);
  return accessibleIds.includes(template.spaceId);
}

const updateTemplateSchema = z.object({
  name: z.string().min(1).optional(),
  description: z.string().optional(),
  content: z.any().optional(),
  icon: z.string().optional(),
  category: z.string().optional(),
  isGlobal: z.boolean().optional(),
});

export async function GET(
  _request: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  const user = await getSessionUser();
  if (!user) return NextResponse.json({ error: "Non authentifié" }, { status: 401 });

  const { id } = await params;

  if (id.startsWith("builtin_")) {
    const builtin = getBuiltinTemplateById(id);
    if (!builtin) return NextResponse.json({ error: "Template introuvable" }, { status: 404 });
    return NextResponse.json(builtin);
  }

  const [template] = await db
    .select()
    .from(templates)
    .where(eq(templates.id, id))
    .limit(1);

  if (!template) {
    return NextResponse.json({ error: "Template introuvable" }, { status: 404 });
  }

  if (!(await isTemplateAccessible(user, template))) {
    return NextResponse.json({ error: "Template introuvable" }, { status: 404 });
  }

  return NextResponse.json(template);
}

export async function PATCH(
  request: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  const user = await getSessionUser();
  if (!user) return NextResponse.json({ error: "Non authentifié" }, { status: 401 });

  const { id } = await params;
  const body = await request.json();
  const parsed = updateTemplateSchema.safeParse(body);
  if (!parsed.success) {
    return NextResponse.json({ error: parsed.error.issues[0].message }, { status: 400 });
  }

  const [existing] = await db
    .select()
    .from(templates)
    .where(eq(templates.id, id))
    .limit(1);
  if (!existing) {
    return NextResponse.json({ error: "Template introuvable" }, { status: 404 });
  }

  // Cloisonnement multi-tenant : ne jamais exposer/modifier un modèle d'une
  // autre org (fail-closed 404 avant même la vérif RBAC catégorie).
  if (!(await isTemplateAccessible(user, existing))) {
    return NextResponse.json({ error: "Template introuvable" }, { status: 404 });
  }

  // Droits sur la catégorie actuelle ET, si elle change, sur la nouvelle catégorie.
  if (
    !canManageTemplateCategory(user.globalRole, user.capabilities, existing.category) ||
    (parsed.data.category !== undefined &&
      !canManageTemplateCategory(user.globalRole, user.capabilities, parsed.data.category))
  ) {
    return NextResponse.json({ error: "Droits insuffisants sur ce modèle" }, { status: 403 });
  }

  const updates: Record<string, unknown> = { updatedAt: new Date() };
  for (const [key, value] of Object.entries(parsed.data)) {
    if (value !== undefined) updates[key] = value;
  }
  if (parsed.data.content !== undefined) {
    updates.variables = deriveTemplateVariables(parsed.data.content);
  }

  const [updated] = await db
    .update(templates)
    .set(updates)
    .where(eq(templates.id, id))
    .returning();

  if (!updated) {
    return NextResponse.json({ error: "Template introuvable" }, { status: 404 });
  }

  return NextResponse.json(updated);
}

export async function DELETE(
  _request: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  const user = await getSessionUser();
  if (!user) return NextResponse.json({ error: "Non authentifié" }, { status: 401 });

  const { id } = await params;

  const [existing] = await db
    .select()
    .from(templates)
    .where(eq(templates.id, id))
    .limit(1);
  if (!existing) {
    return NextResponse.json({ error: "Template introuvable" }, { status: 404 });
  }

  // Cloisonnement multi-tenant (fail-closed 404 avant la vérif RBAC catégorie).
  if (!(await isTemplateAccessible(user, existing))) {
    return NextResponse.json({ error: "Template introuvable" }, { status: 404 });
  }

  if (!canManageTemplateCategory(user.globalRole, user.capabilities, existing.category)) {
    return NextResponse.json({ error: "Droits insuffisants sur ce modèle" }, { status: 403 });
  }

  const [deleted] = await db
    .delete(templates)
    .where(eq(templates.id, id))
    .returning();

  if (!deleted) {
    return NextResponse.json({ error: "Template introuvable" }, { status: 404 });
  }

  return NextResponse.json({ success: true });
}
