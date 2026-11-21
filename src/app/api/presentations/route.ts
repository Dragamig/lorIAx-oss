/**
 * Collection des présentations d'un espace.
 *
 * La ligne en base ne porte que les métadonnées : la charge utile du
 * diaporama vit dans S3, sous `presentations/{id}.json`, comme le studio
 * design le fait pour ses canevas.
 */
import { NextRequest, NextResponse } from "next/server";
import { db } from "@/lib/db";
import { presentations } from "@/lib/db/schema";
import { and, desc, eq } from "drizzle-orm";
import { requireOrgScoped, OrgScopeError } from "@/lib/auth/require-org-scoped";
import { uploadFile } from "@/lib/storage/s3";
import { createEmptyDeck, countSlides } from "@/lib/presentations/deck";
import { guardPresentationsModule } from "@/lib/presentations/guards";
import { canLinkDocument } from "@/lib/presentations/document-link";
import { requireTemplateReader, assertTemplateInOrg, canSeeTemplateRow } from "@/lib/presentations/template-access";
import { cloneTemplatePayload } from "@/lib/presentations/templates";
import { randomUUID } from "node:crypto";
import { recordIfRealSpace } from "@/lib/onboarding/progress";
import { z } from "zod";

export async function GET(request: NextRequest) {
  const spaceId = request.nextUrl.searchParams.get("spaceId");
  if (!spaceId) return NextResponse.json({ error: "spaceId requis" }, { status: 400 });
  if (!z.string().uuid().safeParse(spaceId).success) {
    return NextResponse.json({ error: "Introuvable" }, { status: 404 });
  }
  let ctx;
  try {
    ctx = await requireOrgScoped({
      resource: { type: "space", id: spaceId },
      minPermission: "viewer",
    });
  } catch (e) {
    if (e instanceof OrgScopeError) return e.response;
    throw e;
  }

  // Module coupé : la route disparaît, elle ne refuse pas.
  const blocked = await guardPresentationsModule(ctx.user);
  if (blocked) return blocked;
  try {
    const result = await db
      .select()
      .from(presentations)
      .where(and(eq(presentations.spaceId, spaceId), eq(presentations.isTemplate, false)))
      .orderBy(desc(presentations.updatedAt));
    return NextResponse.json(result);
  } catch {
    return NextResponse.json({ error: "Erreur accès présentations" }, { status: 500 });
  }
}

const createSchema = z.object({
  spaceId: z.string().uuid(),
  title: z.string().min(1).optional(),
  documentId: z.string().uuid().optional(),
  templateId: z.string().uuid().optional(),
});

export async function POST(request: NextRequest) {
  let body: unknown;
  try {
    body = await request.json();
  } catch {
    return NextResponse.json({ error: "Corps JSON invalide" }, { status: 400 });
  }
  const parsed = createSchema.safeParse(body);
  if (!parsed.success)
    return NextResponse.json({ error: parsed.error.issues[0].message }, { status: 400 });
  const { spaceId, documentId, templateId } = parsed.data;
  const title = parsed.data.title ?? "Nouvelle présentation";

  let ctx;
  try {
    ctx = await requireOrgScoped({
      resource: { type: "space", id: spaceId },
      minPermission: "editor",
    });
  } catch (e) {
    if (e instanceof OrgScopeError) return e.response;
    throw e;
  }

  const blocked = await guardPresentationsModule(ctx.user);
  if (blocked) return blocked;

  // Document porteur : même espace, modifiable par l'appelant, sinon 404 muet.
  if (documentId && !(await canLinkDocument(ctx.user, documentId, spaceId))) {
    return NextResponse.json({ error: "Introuvable" }, { status: 404 });
  }

  if (templateId) return createFromTemplate({ templateId, spaceId, documentId, title: parsed.data.title, ctx, request });

  const deck = createEmptyDeck(title);

  // La ligne est écrite AVANT l'objet S3, comme dans designs/[id] : un objet
  // sans ligne serait une charge utile orpheline, invisible et jamais purgée,
  // alors qu'une ligne sans objet se rattrape toute seule (la lecture rend un
  // document vide reconstruit à la volée).
  const [created] = await db
    .insert(presentations)
    .values({
      title,
      spaceId,
      documentId: documentId ?? null,
      createdBy: ctx.user.id,
      slideCount: countSlides(deck),
    })
    .returning();

  try {
    await uploadFile(
      `presentations/${created.id}.json`,
      Buffer.from(JSON.stringify(deck)),
      "application/json"
    );
  } catch (err) {
    console.error("[presentations/POST] Erreur S3 :", err);
    return NextResponse.json({ error: "Erreur serveur" }, { status: 500 });
  }

  // Badge d'onboarding posé côté serveur, au moment de la création réelle.
  // L'espace démo du tuto est exclu, comme pour les documents et les bases.
  recordIfRealSpace(ctx.user.id, "presentation", spaceId).catch(() => {});

  return NextResponse.json(created, { status: 201 });
}

/**
 * Nouvelle présentation à partir d'un modèle : la charge utile est DUPLIQUÉE
 * vers un nouvel id (version 1, aucune révision copiée), le modèle n'est
 * jamais écrit. Modèle caché ou d'une autre organisation : 404 muet.
 *
 * Ordre inverse de la création vierge : l'objet S3 est écrit AVANT la ligne
 * (id généré ici). Une ligne sans objet serait une présentation vide listée
 * alors que l'utilisateur a demandé une copie, et on ne peut ni la supprimer
 * ni la masquer (une présentation ordinaire n'a pas de masquage). En cas
 * d'échec S3, rien n'existe donc, et si l'insertion échoue après l'écriture,
 * il ne reste qu'un objet inerte, comme pour toute charge utile orpheline.
 */
async function createFromTemplate({
  templateId,
  spaceId,
  documentId,
  title,
  ctx,
  request,
}: {
  templateId: string;
  spaceId: string;
  documentId: string | undefined;
  title: string | undefined;
  ctx: { user: { id: string } };
  request: NextRequest;
}) {
  const reader = await requireTemplateReader(request);
  if (reader instanceof NextResponse) return reader;

  const notFound = () => NextResponse.json({ error: "Introuvable" }, { status: 404 });
  const [template] = await db
    .select()
    .from(presentations)
    .where(and(eq(presentations.id, templateId), eq(presentations.isTemplate, true)))
    .limit(1);
  if (!template) return notFound();
  const outside = assertTemplateInOrg(template, reader.orgId);
  if (outside) return outside;
  // Utiliser un modèle : un non-membre n'a que les modèles LorIAx, jamais ceux
  // de l'organisation ; un modèle masqué est invisible pour tous.
  if (template.templateHiddenAt || !canSeeTemplateRow(reader, template)) return notFound();

  const newId = randomUUID();
  const newTitle = title ?? template.title;
  let slideCount: number;
  try {
    ({ slideCount } = await cloneTemplatePayload(template, newId, newTitle));
  } catch (err) {
    console.error("[presentations/POST] Erreur S3 (modèle) :", err);
    return NextResponse.json({ error: "Erreur serveur" }, { status: 500 });
  }

  const [created] = await db
    .insert(presentations)
    .values({
      id: newId,
      title: newTitle,
      spaceId,
      documentId: documentId ?? null,
      createdBy: ctx.user.id,
      slideCount,
    })
    .returning();

  recordIfRealSpace(ctx.user.id, "presentation", spaceId).catch(() => {});
  return NextResponse.json(created, { status: 201 });
}
