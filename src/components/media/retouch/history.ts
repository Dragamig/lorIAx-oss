import { HISTORY_LIMIT, HISTORY_MERGE_MS } from "./limits";

export type History<T> = {
  readonly present: T;
  readonly canUndo: boolean;
  readonly canRedo: boolean;
  /** Ajoute un état. Même `mergeKey` dans les 500 ms : remplace l'état courant au lieu d'empiler. */
  push(state: T, mergeKey?: string): void;
  undo(): T;
  redo(): T;
};

/** Historique annuler/rétablir borné à 50 états, sans dépendance au DOM. `now` est injectable pour les tests. */
export function createHistory<T>(initial: T, now: () => number = Date.now): History<T> {
  let past: T[] = [];
  let current = initial;
  let future: T[] = [];
  let lastKey: string | undefined;
  let lastAt = 0;

  return {
    get present() {
      return current;
    },
    get canUndo() {
      return past.length > 0;
    },
    get canRedo() {
      return future.length > 0;
    },
    push(state, mergeKey) {
      const t = now();
      const merge = mergeKey !== undefined && mergeKey === lastKey && t - lastAt <= HISTORY_MERGE_MS && past.length > 0;
      if (!merge) {
        past.push(current);
        // `present` compte pour un état : au plus HISTORY_LIMIT - 1 états passés
        if (past.length > HISTORY_LIMIT - 1) past = past.slice(past.length - (HISTORY_LIMIT - 1));
      }
      current = state;
      future = [];
      lastKey = mergeKey;
      lastAt = t;
    },
    undo() {
      const prev = past.pop();
      if (prev !== undefined) {
        future.push(current);
        current = prev;
      }
      lastKey = undefined;
      return current;
    },
    redo() {
      const next = future.pop();
      if (next !== undefined) {
        past.push(current);
        current = next;
      }
      lastKey = undefined;
      return current;
    },
  };
}
