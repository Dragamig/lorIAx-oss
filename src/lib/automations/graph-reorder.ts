/**
 * Réordonnancement pur de la chaîne linéaire principale d'un graphe
 * d'automatisation (arêtes sans `branch`). Les branches de condition et leurs
 * arêtes sont préservées telles quelles. Utilisé par le glisser-déposer du builder.
 */
import type { AutomationGraph, GraphEdge } from "@/lib/automations/automation-graph";

/**
 * Ids des nœuds de la chaîne principale (entrée → suivi des arêtes sans
 * `branch`). La marche s'arrête dès qu'il n'y a plus d'arête sortante sans
 * branche — ce qui inclut le nœud condition terminal (ses arêtes sortantes
 * portent toutes `true`/`false`) mais pas les nœuds au-delà.
 */
export function linearizeMainChain(graph: AutomationGraph): string[] {
  const hasIncoming = new Set(graph.edges.map((e) => e.to));
  const entry = graph.nodes.find((n) => !hasIncoming.has(n.id));
  if (!entry) return [];
  const order: string[] = [];
  const seen = new Set<string>();
  let current: string | undefined = entry.id;
  while (current && !seen.has(current)) {
    order.push(current);
    seen.add(current);
    current = graph.edges.find((e) => e.from === current && !e.branch)?.to;
  }
  return order;
}

/**
 * Reconstruit les arêtes après déplacement de `activeId` à la place de `overId`
 * dans `orderedIds` (chaîne principale). Les arêtes de branche (avec `branch`)
 * sont conservées ; seules les arêtes linéaires internes à la chaîne sont
 * recâblées. `orderedIds` désigne toujours la chaîne depuis l'entrée réelle du
 * graphe, donc aucune arête externe n'entre par sa tête ni ne sort de sa queue
 * autrement qu'en `branch` (cf. `linearizeMainChain`).
 */
export function reorderMainChain(
  edges: GraphEdge[],
  orderedIds: string[],
  activeId: string,
  overId: string
): GraphEdge[] {
  const from = orderedIds.indexOf(activeId);
  const to = orderedIds.indexOf(overId);
  if (from === -1 || to === -1 || from === to) return edges;

  const next = [...orderedIds];
  next.splice(from, 1);
  next.splice(to, 0, activeId);

  // Arêtes de branche + arêtes ne concernant PAS la chaîne principale préservées.
  const chainSet = new Set(orderedIds);
  const preserved = edges.filter(
    (e) => e.branch || !chainSet.has(e.from) || !chainSet.has(e.to)
  );
  // Nouvelles arêtes linéaires selon `next`.
  const rebuilt: GraphEdge[] = [];
  for (let i = 0; i < next.length - 1; i++) {
    rebuilt.push({ from: next[i], to: next[i + 1] });
  }
  return [...preserved, ...rebuilt];
}
