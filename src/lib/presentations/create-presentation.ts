/**
 * Création d'une présentation vierge à partir d'un diaporama déjà construit.
 *
 * Extrait de `POST /api/presentations` : la garde du module et le contrôle
 * d'accès restent à la charge de l'appelant.
 *
 * La ligne est écrite AVANT l'objet S3 : un objet sans ligne serait une
 * charge utile orpheline, invisible et jamais purgée, alors qu'une ligne sans
 * objet se rattrape toute seule (la lecture rend un document vide).
 */
import { db } from "@/lib/db";
import { presentations } from "@/lib/db/schema";
import { uploadFile } from "@/lib/storage/s3";
import { countSlides, type Deck } from "@/lib/presentations/deck";
import { recordIfRealSpace } from "@/lib/onboarding/progress";

/** L'écriture de l'objet S3 a échoué (la ligne existe déjà). */
export class PresentationStorageError extends Error {
  constructor(
    public readonly cause: unknown,
    /** Ligne déjà insérée, que l'appelant peut nettoyer. */
    public readonly presentationId?: string,
  ) {
    super("Erreur d'écriture S3 de la présentation");
  }
}

export async function createPresentation(input: {
  spaceId: string;
  title: string;
  deck: Deck;
  createdBy: string;
  documentId?: string | null;
}) {
  const { spaceId, title, deck, createdBy, documentId } = input;
  const [created] = await db
    .insert(presentations)
    .values({
      title,
      spaceId,
      documentId: documentId ?? null,
      createdBy,
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
    throw new PresentationStorageError(err, created.id);
  }

  // Badge d'onboarding posé côté serveur, au moment de la création réelle.
  // L'espace démo du tuto est exclu, comme pour les documents et les bases.
  recordIfRealSpace(createdBy, "presentation", spaceId).catch(() => {});

  return created;
}
