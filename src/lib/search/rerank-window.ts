/**
 * Fenetrage des candidats soumis au reclassement, et completion du resultat.
 *
 * Le reclassement ne rend que des elements pris parmi les candidats qu'on lui
 * donne, et il borne lui-meme le nombre de candidats reellement envoyes au
 * fournisseur. Deux precautions en decoulent, toutes deux pures et testables
 * hors base de donnees.
 */

/** Fenetre minimale de candidats fusionnes soumis au reclassement. */
export const MIN_RERANK_CANDIDATE_WINDOW = 30;

/**
 * Taille de la fenetre de candidats a soumettre au reclassement.
 *
 * Couper la liste fusionnee a 30 avant le reclassement ferait perdre
 * silencieusement des resultats des que l'appelant demande plus de 30 lignes
 * (la route accepte jusqu'a 100). On prend donc le maximum entre la fenetre
 * minimale et la limite demandee.
 */
export function rerankWindowSize(limit: number): number {
  return Math.max(MIN_RERANK_CANDIDATE_WINDOW, limit);
}

/**
 * Complete une liste reclassee avec la queue non reclassee de la liste
 * fusionnee, jusqu'a `limit`, sans doublon.
 *
 * Le module de reclassement plafonne les candidats envoyes au fournisseur :
 * au-dela de ce plafond, les elements ne reviennent jamais dans sa reponse. Ils
 * ne doivent pas disparaitre pour autant : on les reprend dans l'ordre de la
 * fusion, apres les elements reclasses.
 */
export function completeWithFusionTail<T>(
  reranked: T[],
  fused: T[],
  limit: number,
  getId: (item: T) => string
): T[] {
  if (limit <= 0) return [];

  const out = reranked.slice(0, limit);
  const seen = new Set(out.map(getId));

  for (const item of fused) {
    if (out.length >= limit) break;
    const id = getId(item);
    if (seen.has(id)) continue;
    seen.add(id);
    out.push(item);
  }

  return out;
}
