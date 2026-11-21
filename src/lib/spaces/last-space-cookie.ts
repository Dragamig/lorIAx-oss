import { LAST_SPACE_COOKIE } from "./resolve-current-space";

/** Valeur du cookie du dernier espace consulté (1 an, lue côté serveur par /bases). */
export function buildLastSpaceCookie(id: string): string {
  return `${LAST_SPACE_COOKIE}=${encodeURIComponent(id)}; path=/; max-age=31536000; samesite=lax`;
}

/** Mémorise le dernier espace consulté (client uniquement). */
export function setLastSpaceCookie(id: string): void {
  if (typeof document === "undefined") return;
  document.cookie = buildLastSpaceCookie(id);
}

/** Résout un slug d'espace vers son id, null si inconnu. */
export function findSpaceIdBySlug(
  spaces: ReadonlyArray<{ id: string; slug: string }>,
  slug: string | null
): string | null {
  if (!slug) return null;
  return spaces.find((s) => s.slug === slug)?.id ?? null;
}
