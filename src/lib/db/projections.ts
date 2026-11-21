import { documents } from "@/lib/db/schema";

/**
 * Colonnes de métadonnées d'un document exposables dans une réponse d'API.
 *
 * `contentText` en est volontairement absent : c'est la seule colonne dont la lecture
 * dépend de la classification du document. Un `.returning()` nu la renverrait à un
 * utilisateur autorisé à écrire mais pas à lire, ce qui contourne
 * `checkDocumentViewAccess`. Toute route qui doit renvoyer le contenu l'ajoute
 * explicitement, après un contrôle de lecture.
 */
export const documentMetadataColumns = {
  id: documents.id,
  spaceId: documents.spaceId,
  parentId: documents.parentId,
  title: documents.title,
  slug: documents.slug,
  filePath: documents.filePath,
  visibility: documents.visibility,
  classification: documents.classification,
  isFolder: documents.isFolder,
  templateId: documents.templateId,
  createdBy: documents.createdBy,
  lockedBy: documents.lockedBy,
  lockedAt: documents.lockedAt,
  icon: documents.icon,
  position: documents.position,
  properties: documents.properties,
  createdAt: documents.createdAt,
  updatedAt: documents.updatedAt,
} as const;
