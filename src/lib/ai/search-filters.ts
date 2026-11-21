import { sql, type SQL } from "drizzle-orm";

export interface ViewerContext {
  /** Utilisateur au nom duquel la recherche est faite. */
  viewerId?: string;
  /** Administrateur global : voit toutes les classifications. */
  isGlobalAdmin?: boolean;
}

/**
 * Clause SQL ecartant les documents classes « secret » dont le lecteur n'est
 * pas l'auteur. Rend null quand aucun filtrage n'est necessaire (administrateur
 * global, ou contexte deja cloisonne en amont sans lecteur fourni).
 *
 * Ce filtre doit s'appliquer DANS la requete, pas apres : le reclassement
 * envoie les extraits candidats a un fournisseur externe, un post-filtrage
 * laisserait sortir des extraits secrets.
 */
export function buildClassificationFilterSql(
  viewer: ViewerContext
): SQL | null {
  if (!viewer.viewerId) return null;
  if (viewer.isGlobalAdmin) return null;
  return sql`AND (d.classification IS DISTINCT FROM 'secret' OR d.created_by = ${viewer.viewerId})`;
}
