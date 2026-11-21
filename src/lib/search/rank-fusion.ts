/**
 * Fusion de rangs reciproques (RRF).
 *
 * Chaque source de recherche produit une liste ordonnee. Comparer leurs scores
 * bruts n'a pas de sens : un `ts_rank` vaut quelques centiemes la ou un cosinus
 * vaut entre 0 et 1, et certaines sources n'ont pas de score du tout. On ne
 * compare donc que des rangs : un element gagne 1 / (k + rang) par liste ou il
 * apparait, et les contributions s'additionnent. Un element trouve par
 * plusieurs sources remonte naturellement.
 *
 * La constante d'amortissement k = 60 est la valeur usuelle : elle empeche la
 * premiere place d'une seule liste d'ecraser deux bonnes places ailleurs.
 */
export function fuseByRank<T>(
  lists: T[][],
  getId: (item: T) => string,
  k = 60
): T[] {
  const scores = new Map<string, number>();
  const items = new Map<string, T>();

  for (const list of lists) {
    for (let rank = 0; rank < list.length; rank++) {
      const item = list[rank];
      const id = getId(item);
      scores.set(id, (scores.get(id) ?? 0) + 1 / (k + rank + 1));
      if (!items.has(id)) items.set(id, item);
    }
  }

  return [...scores.entries()]
    .sort((a, b) => b[1] - a[1])
    .map(([id]) => items.get(id) as T);
}
