/**
 * Anciennes références `/api/studio/images/<uuid>` : la route unitaire est supprimée,
 * les identifiants sont ceux de la table `media`. Redirection définitive tant que
 * `scripts/rewrite-studio-image-refs.ts` n'a pas réécrit toutes les références.
 * Ne vise que le segment UUID : la collection `/api/studio/images` (POST) reste servie.
 * Passe par `redirects()` de next.config (une redirection rendue depuis une page n'aboutit pas).
 */
export const legacyStudioImageRedirect = {
  source: "/api/studio/images/:id([0-9a-fA-F]{8}-[0-9a-fA-F]{4}-[0-9a-fA-F]{4}-[0-9a-fA-F]{4}-[0-9a-fA-F]{12})",
  destination: "/api/media/:id",
  permanent: true,
} as const;
