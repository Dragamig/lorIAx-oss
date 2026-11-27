/**
 * Déplace l'élément d'indice `index` de `delta` positions (−1 = avant,
 * +1 = après). Rend une nouvelle liste, ou `null` si le déplacement sort des
 * bornes (rien à envoyer à l'API).
 */
export function moveItem<T>(items: readonly T[], index: number, delta: number): T[] | null {
  const target = index + delta;
  if (index < 0 || index >= items.length || target < 0 || target >= items.length || delta === 0) {
    return null;
  }
  const next = items.slice();
  const [moved] = next.splice(index, 1);
  next.splice(target, 0, moved);
  return next;
}
