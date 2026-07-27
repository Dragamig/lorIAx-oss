import { documents } from "@/lib/db/schema";

/**
 * Colonnes de metadonnees d'un document exposables dans une reponse d'API.
 *
 * `contentText` en est volontairement absent : c'est la seule colonne dont la lecture
 * est soumise a la classification du document. Un `.returning()` ou un `select()` nu
 * la renverrait a un utilisateur autorise a ecrire mais pas a lire (document `secret`
 * dont il n'est ni auteur ni administrateur d'espace), ce qui contourne
 * `checkDocumentViewAccess`.
 *
 * Toute route qui doit renvoyer le contenu ajoute explicitement `contentText` a cette
 * projection, apres un controle de lecture. Centraliser la liste evite qu'une colonne
 * ajoutee plus tard n'apparaisse que dans une partie des reponses.
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
