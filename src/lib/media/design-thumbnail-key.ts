import { sql, type SQL } from "drizzle-orm";
import { media } from "@/lib/db/schema-media";

export const DESIGN_THUMBNAIL_NAME = "Miniature de design";
/** Chemin de clé propre aux miniatures de design (posé à l'envoi, non modifiable ensuite). */
export const DESIGN_THUMBNAIL_KEY_PATTERN = "studio/%/design-thumbnails/%";

/**
 * Exclut les miniatures techniques de design des listes, compteurs, recherches
 * et sélecteurs. Pas de valeur d'origine dédiée (`origin` vaut `studio`) : le
 * critère est la clé de stockage, seule propriété non modifiable. Service et
 * comptage au quota ne passent pas par cette condition.
 */
export function notDesignThumbnail(): SQL {
  return sql`${media.storageKey} not like ${DESIGN_THUMBNAIL_KEY_PATTERN}`;
}
