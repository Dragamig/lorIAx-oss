import { NextRequest, NextResponse } from "next/server";
import { db } from "@/lib/db";
import { documents, spaces } from "@/lib/db/schema";
import { eq } from "drizzle-orm";
import { getSessionUser } from "@/lib/auth/get-user";
import {
  checkDocumentViewAccess,
  checkSpaceEditAccess,
} from "@/lib/auth/check-access";
import { enforceClassificationFloor } from "@/lib/auth/classification";
import { logActivity } from "@/lib/activity";
import { z } from "zod";
import type { ClassificationLevel } from "@/types";

const moveSchema = z
  .object({
    targetSpaceSlug: z.string().min(1).optional(),
    parentId: z.string().uuid().nullable().optional(),
  })
  .refine(
    (data) => data.targetSpaceSlug !== undefined || data.parentId !== undefined,
    { message: "targetSpaceSlug ou parentId requis" }
  );

export async function POST(
  request: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  const user = await getSessionUser();
  if (!user) return NextResponse.json({ error: "Non authentifié" }, { status: 401 });

  const { id } = await params;
  const body = await request.json();
  const parsed = moveSchema.safeParse(body);
  if (!parsed.success) {
    return NextResponse.json({ error: parsed.error.issues[0].message }, { status: 400 });
  }

  const [doc] = await db.select().from(documents).where(eq(documents.id, id)).limit(1);
  if (!doc) return NextResponse.json({ error: "Document introuvable" }, { status: 404 });

  // Deplacer un document `secret` vers un espace que l'on possede donne la lecture :
  // checkDocumentViewAccess court-circuite en `true` pour le proprietaire de l'espace.
  // Le droit de lecture sur le document deplace est donc exige, en plus du droit
  // d'ecriture sur l'espace source.
  const canViewSource = await checkDocumentViewAccess(user, doc.spaceId, doc.id);
  if (!canViewSource) {
    return NextResponse.json({ error: "Accès refusé (document source)" }, { status: 403 });
  }

  // Le droit d'ecriture reste evalue au niveau de l'espace source, comme avant : sortir
  // un document d'un espace engage l'espace, pas seulement le document.
  const canEditSource = await checkSpaceEditAccess(user, doc.spaceId);
  if (!canEditSource) {
    return NextResponse.json({ error: "Accès refusé (espace source)" }, { status: 403 });
  }

  // --- Déplacement vers un autre espace ---
  if (parsed.data.targetSpaceSlug !== undefined) {
    const [targetSpace] = await db
      .select()
      .from(spaces)
      .where(eq(spaces.slug, parsed.data.targetSpaceSlug))
      .limit(1);
    if (!targetSpace) return NextResponse.json({ error: "Espace cible introuvable" }, { status: 404 });

    // Check write permission on target space
    const canEditTarget = await checkSpaceEditAccess(user, targetSpace.id);
    if (!canEditTarget) {
      return NextResponse.json({ error: "Accès refusé (espace cible)" }, { status: 403 });
    }

    // La ligne deplacee ne peut pas atterrir sous le plancher de classification de
    // l'espace cible : deplacer n'est pas un moyen de declasser. Niveau propage et non
    // choisi par l'appelant, donc releve et non refuse (voir enforceClassificationFloor).
    //
    // Limite connue, heritee : seule la ligne du document deplace est mise a jour. Le
    // deplacement d'un DOSSIER laisse ses enfants avec l'ancien `spaceId` et l'ancienne
    // classification, ils restent donc rattachees a l'espace d'origine et gardent leur
    // niveau. Aucune declassification n'en resulte, mais l'arborescence devient
    // incoherente : a traiter avec le deplacement recursif, hors perimetre de ce lot.
    const docClassification = (doc.classification || "internal") as ClassificationLevel;
    const nextClassification = enforceClassificationFloor(
      docClassification,
      (targetSpace.classification || "internal") as ClassificationLevel
    );

    await db
      .update(documents)
      .set({
        spaceId: targetSpace.id,
        parentId: null,
        classification: nextClassification,
      })
      .where(eq(documents.id, id));

    // Une reclassification est un evenement d'audit, meme lorsqu'elle est automatique.
    logActivity({
      userId: user.id,
      action: "move",
      entityType: "document",
      entityId: id,
      metadata: {
        title: doc.title,
        spaceId: targetSpace.id,
        sourceSpaceId: doc.spaceId,
        targetSpaceSlug: targetSpace.slug,
        ...(nextClassification !== docClassification
          ? { classificationRaisedFrom: docClassification, classification: nextClassification }
          : {}),
      },
    });

    return NextResponse.json({ ok: true, spaceSlug: targetSpace.slug });
  }

  // --- Déplacement dans le même espace (changement de dossier parent) ---
  const newParentId = parsed.data.parentId ?? null;

  if (newParentId !== null) {
    // Valider que le parent existe, est un dossier, et appartient au même espace
    const [parentDoc] = await db
      .select()
      .from(documents)
      .where(eq(documents.id, newParentId))
      .limit(1);

    if (!parentDoc) {
      return NextResponse.json({ error: "Dossier parent introuvable" }, { status: 404 });
    }
    if (!parentDoc.isFolder) {
      return NextResponse.json({ error: "Le parent spécifié n'est pas un dossier" }, { status: 400 });
    }
    if (parentDoc.spaceId !== doc.spaceId) {
      return NextResponse.json({ error: "Le dossier parent n'appartient pas au même espace" }, { status: 400 });
    }
    // Empêcher de déplacer un dossier dans lui-même
    if (newParentId === id) {
      return NextResponse.json({ error: "Impossible de déplacer un dossier dans lui-même" }, { status: 400 });
    }
  }

  await db
    .update(documents)
    .set({ parentId: newParentId })
    .where(eq(documents.id, id));

  const [sourceSpace] = await db
    .select({ slug: spaces.slug })
    .from(spaces)
    .where(eq(spaces.id, doc.spaceId))
    .limit(1);

  return NextResponse.json({ ok: true, spaceSlug: sourceSpace?.slug ?? null });
}
