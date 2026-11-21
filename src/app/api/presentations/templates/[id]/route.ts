/**
 * Fiche d'un modèle : lecture (membre), modification et retrait (admin).
 *
 * Ordre des gardes : module et rôle, puis chargement de la ligne, puis
 * `assertTemplateInOrg` (404 muet), jamais l'inverse pour le rôle d'écriture
 * d'un membre : 403 explicite. Retirer un modèle, c'est le masquer : rien
 * n'est supprimé, ni en base ni en S3.
 */
import { NextRequest, NextResponse } from "next/server";
import { and, eq } from "drizzle-orm";
import { z } from "zod";
import { db } from "@/lib/db";
import { presentations } from "@/lib/db/schema-presentations";
import {
  assertTemplateInOrg,
  canSeeTemplateRow,
  requireTemplateAdmin,
  requireTemplateReader,
} from "@/lib/presentations/template-access";
import { readTemplateDeck } from "@/lib/presentations/templates";

type Ctx = { params: Promise<{ id: string }> };

const notFound = () => NextResponse.json({ error: "Introuvable" }, { status: 404 });

async function loadTemplate(id: string) {
  if (!z.string().uuid().safeParse(id).success) return null;
  const [row] = await db
    .select()
    .from(presentations)
    .where(and(eq(presentations.id, id), eq(presentations.isTemplate, true)))
    .limit(1);
  return row ?? null;
}

export async function GET(req: NextRequest, { params }: Ctx) {
  const { id } = await params;
  const ctx = await requireTemplateReader(req);
  if (ctx instanceof NextResponse) return ctx;

  const row = await loadTemplate(id);
  if (!row) return notFound();
  const outside = assertTemplateInOrg(row, ctx.orgId);
  if (outside) return outside;

  // Masqué : réservé à qui gère les modèles. Non-membre : modèles LorIAx seuls.
  if (!canSeeTemplateRow(ctx, row)) return notFound();

  try {
    const deck = await readTemplateDeck(row);
    return NextResponse.json({ template: row, deck });
  } catch (err) {
    console.error("[presentations/templates/GET] Erreur S3 :", err);
    return NextResponse.json({ error: "Erreur serveur" }, { status: 500 });
  }
}

const patchSchema = z
  .object({
    name: z.string().trim().min(1).max(200).optional(),
    description: z.string().max(2000).optional(),
    hidden: z.boolean().optional(),
  })
  .refine((v) => v.name !== undefined || v.description !== undefined || v.hidden !== undefined, {
    message: "Aucune modification",
  });

export async function PATCH(req: NextRequest, { params }: Ctx) {
  const { id } = await params;
  const ctx = await requireTemplateAdmin(req);
  if (ctx instanceof NextResponse) return ctx;

  const row = await loadTemplate(id);
  if (!row) return notFound();
  const outside = assertTemplateInOrg(row, ctx.orgId);
  if (outside) return outside;

  let body: unknown;
  try {
    body = await req.json();
  } catch {
    return NextResponse.json({ error: "Corps invalide" }, { status: 400 });
  }
  const parsed = patchSchema.safeParse(body);
  if (!parsed.success) {
    return NextResponse.json({ error: "Données invalides" }, { status: 400 });
  }
  const { name, description, hidden } = parsed.data;

  const patch: Partial<typeof presentations.$inferInsert> = { updatedAt: new Date() };
  if (name !== undefined) patch.title = name;
  if (description !== undefined) patch.templateDescription = description;
  if (hidden !== undefined) patch.templateHiddenAt = hidden ? new Date() : null;

  try {
    const [updated] = await db
      .update(presentations)
      .set(patch)
      .where(and(eq(presentations.id, row.id), eq(presentations.organizationId, ctx.orgId)))
      .returning();
    if (!updated) return notFound();
    return NextResponse.json({ template: updated });
  } catch (err) {
    console.error("[presentations/templates/PATCH] Erreur :", err);
    return NextResponse.json({ error: "Erreur serveur" }, { status: 500 });
  }
}

/** Retrait = masquage : la ligne et la charge utile S3 sont conservées. */
export async function DELETE(req: NextRequest, { params }: Ctx) {
  const { id } = await params;
  const ctx = await requireTemplateAdmin(req);
  if (ctx instanceof NextResponse) return ctx;

  const row = await loadTemplate(id);
  if (!row) return notFound();
  const outside = assertTemplateInOrg(row, ctx.orgId);
  if (outside) return outside;

  try {
    const [updated] = await db
      .update(presentations)
      .set({ templateHiddenAt: new Date(), updatedAt: new Date() })
      .where(and(eq(presentations.id, row.id), eq(presentations.organizationId, ctx.orgId)))
      .returning();
    if (!updated) return notFound();
    return NextResponse.json({ template: updated });
  } catch (err) {
    console.error("[presentations/templates/DELETE] Erreur :", err);
    return NextResponse.json({ error: "Erreur serveur" }, { status: 500 });
  }
}
