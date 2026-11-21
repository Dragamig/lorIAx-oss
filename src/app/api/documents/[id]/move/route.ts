import { NextRequest, NextResponse } from "next/server";
import { db } from "@/lib/db";
import { documents, spaces } from "@/lib/db/schema";
import { eq } from "drizzle-orm";
import { getSessionUser } from "@/lib/auth/get-user";
import { checkDocumentEditAccess, checkSpaceWriteAccess } from "@/lib/auth/check-access";
import { enforceClassificationFloor } from "@/lib/auth/classification";
import type { ClassificationLevel } from "@/types";
import { z } from "zod";

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
  let body;
  try {
    body = await request.json();
  } catch {
    return NextResponse.json({ error: "JSON invalide" }, { status: 400 });
  }
  const parsed = moveSchema.safeParse(body);
  if (!parsed.success) {
    return NextResponse.json({ error: parsed.error.issues[0].message }, { status: 400 });
  }

  const [doc] = await db.select().from(documents).where(eq(documents.id, id)).limit(1);
  if (!doc) return NextResponse.json({ error: "Document introuvable" }, { status: 404 });

  // Permission d'écriture sur le document source (inclut le cloisonnement d'org)
  const canEditSource = await checkDocumentEditAccess(user, doc.spaceId, doc.id);
  if (!canEditSource) {
    return NextResponse.json({ error: "Accès refusé" }, { status: 403 });
  }

  // --- Déplacement vers un autre espace ---
  if (parsed.data.targetSpaceSlug !== undefined) {
    const [targetSpace] = await db
      .select()
      .from(spaces)
      .where(eq(spaces.slug, parsed.data.targetSpaceSlug))
      .limit(1);
    if (!targetSpace) return NextResponse.json({ error: "Espace cible introuvable" }, { status: 404 });

    // Permission d'écriture sur l'espace cible (+ appartenance à l'org courante)
    const canWriteTarget = await checkSpaceWriteAccess(user, targetSpace.id);
    if (!canWriteTarget) {
      return NextResponse.json({ error: "Accès refusé" }, { status: 403 });
    }

    await db
      .update(documents)
      .set({
        spaceId: targetSpace.id,
        parentId: null,
        // Le document ne descend jamais sous le plancher de l'espace cible.
        classification: enforceClassificationFloor(
          (doc.classification || "internal") as ClassificationLevel,
          (targetSpace.classification || "internal") as ClassificationLevel
        ),
      })
      .where(eq(documents.id, id));

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
