/**
 * Numérotation des requêtes par clé : seule la dernière requête émise pour une
 * clé a le droit de restaurer un état après un échec.
 */
export function createLatestGate() {
  const last = new Map<string, number>();
  let counter = 0;
  return {
    next(key: string): number {
      counter += 1;
      last.set(key, counter);
      return counter;
    },
    isLatest(key: string, token: number): boolean {
      return last.get(key) === token;
    },
    reset() {
      last.clear();
    },
  };
}
