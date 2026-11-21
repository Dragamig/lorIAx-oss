/**
 * Un tableau de bord est évalué côté serveur sans utilisateur courant :
 * `is_me` ne correspondrait à aucune ligne. Il est refusé à l'enregistrement
 * plutôt que de désactiver silencieusement la condition.
 */
export const DASHBOARD_IS_ME_REJECTED_MESSAGE =
  "L'opérateur « est moi » n'est pas disponible dans un tableau de bord";

/** Vrai si un nœud de l'arbre de filtres (groupe ou condition, profondeur quelconque) utilise `is_me`. */
export function filterUsesIsMe(node: unknown, depth = 0): boolean {
  if (depth > 20 || node === null || typeof node !== "object") return false;
  if (Array.isArray(node)) return node.some((n) => filterUsesIsMe(n, depth + 1));
  const o = node as Record<string, unknown>;
  if (o.operator === "is_me") return true;
  return Object.values(o).some((v) => filterUsesIsMe(v, depth + 1));
}
