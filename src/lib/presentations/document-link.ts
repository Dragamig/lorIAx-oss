import { eq } from "drizzle-orm";
import { db } from "@/lib/db";
import { documents } from "@/lib/db/schema";
import { checkDocumentEditAccess } from "@/lib/auth/check-access";
import type { SessionUser } from "@/types";

/**
 * Le document porteur d'une présentation doit exister, appartenir au MÊME
 * espace (donc à la même organisation, l'espace ayant déjà été autorisé) et
 * être modifiable par l'appelant. Faux dans tous les autres cas : la route
 * répond 404 muet, sans distinguer inexistant et interdit.
 */
export async function canLinkDocument(
  user: SessionUser,
  documentId: string,
  spaceId: string
): Promise<boolean> {
  const [doc] = await db
    .select({ id: documents.id, spaceId: documents.spaceId })
    .from(documents)
    .where(eq(documents.id, documentId))
    .limit(1);
  if (!doc || doc.spaceId !== spaceId) return false;
  return checkDocumentEditAccess(user, spaceId, documentId);
}
