/** Nom du cookie de préférence : dernier espace choisi (simple repli, jamais une autorisation). */
export const LAST_SPACE_COOKIE = "loriax-space";

export interface ResolveCurrentSpaceInput {
  /** Espaces accessibles à l'utilisateur (liste autoritative, ordre de repli). */
  accessibleIds: string[];
  /** Valeur de `?spaceId=` dans l'URL. */
  requested?: string | null;
  /** Espace de la base ouverte (`/bases/[databaseId]`). */
  databaseSpaceId?: string | null;
  /** Valeur du cookie du dernier espace choisi. */
  lastSpaceId?: string | null;
}

/**
 * Résout l'espace courant. Priorités : espace de la base ouverte, paramètre d'URL,
 * dernier espace choisi, premier espace accessible. Toute valeur qui
 * ne figure pas dans `accessibleIds` est ignorée. Retourne null s'il n'y a
 * aucun espace accessible.
 */
export function resolveCurrentSpaceId(input: ResolveCurrentSpaceInput): string | null {
  const { accessibleIds, requested, databaseSpaceId, lastSpaceId } = input;
  for (const candidate of [databaseSpaceId, requested, lastSpaceId]) {
    if (candidate && accessibleIds.includes(candidate)) return candidate;
  }
  return accessibleIds[0] ?? null;
}
