/**
 * Enregistrer une présentation comme modèle d'organisation (admin).
 *
 * Crée une COPIE : nouvelle ligne `is_template`, sans espace, charge utile
 * dupliquée sous un nouvel id. La source n'est jamais modifiée.
 *
 * Ordre des gardes : rôle admin (403 explicite pour un membre), puis
 * chargement de la source, puis cloisonnement par l'espace de la source (une
 * source d'une autre organisation est un 404 muet).
 */
import { NextRequest, NextResponse } from "next/server";
import { eq } from "drizzle-orm";
import { z } from "zod";
import { db } from "@/lib/db";
import { presentations } from "@/lib/db/schema-presentations";
import { requireOrgScoped, OrgScopeError } from "@/lib/auth/require-org-scoped";
import { requireTemplateAdmin } from "@/lib/presentations/template-access";
import {
  copyPresentationAsTemplate,
  SourceDeckMissingError,
} from "@/lib/presentations/templates";

const bodySchema = z.object({
  name: z.string().trim().min(1).max(200),
  description: z.string().max(2000).optional(),
});

export async function POST(req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const ctx = await requireTemplateAdmin(req);
  if (ctx instanceof NextResponse) return ctx;

  if (!z.string().uuid().safeParse(id).success) {
    return NextResponse.json({ error: "Introuvable" }, { status: 404 });
  }
  const [source] = await db.select().from(presentations).where(eq(presentations.id, id)).limit(1);
  // Un modèle n'a pas d'espace : on ne l'enregistre pas comme modèle une 2e fois.
  if (!source || source.isTemplate || !source.spaceId) {
    return NextResponse.json({ error: "Introuvable" }, { status: 404 });
  }
  try {
    await requireOrgScoped({
      resource: { type: "space", id: source.spaceId },
      minPermission: "viewer",
    }, req);
  } catch (e) {
    if (e instanceof OrgScopeError) return e.response;
    throw e;
  }

  let body: unknown;
  try {
    body = await req.json();
  } catch {
    return NextResponse.json({ error: "Corps JSON invalide" }, { status: 400 });
  }
  const parsed = bodySchema.safeParse(body);
  if (!parsed.success) {
    return NextResponse.json({ error: parsed.error.issues[0].message }, { status: 400 });
  }

  try {
    const template = await copyPresentationAsTemplate(source, ctx.orgId, {
      name: parsed.data.name,
      description: parsed.data.description,
      createdBy: ctx.user.id,
    });
    return NextResponse.json({ template }, { status: 201 });
  } catch (err) {
    // 409 : la source existe mais n'a jamais été enregistrée, il n'y a rien à
    // copier ; réessayer est possible une fois la présentation ouverte et
    // enregistrée. Ce n'est ni une absence de ressource ni une panne.
    if (err instanceof SourceDeckMissingError) {
      return NextResponse.json(
        { error: "La présentation n'a pas encore de contenu enregistré" },
        { status: 409 }
      );
    }
    console.error("[presentations/template/POST] Erreur S3 :", err);
    return NextResponse.json({ error: "Erreur serveur" }, { status: 500 });
  }
}
