/**
 * Graines d'ETag des médias. Elles dépendent de la version courante ET de
 * `updatedAt` : un remplacement, une restauration ou la promotion d'une
 * version précédente (suppression de la courante, qui réutilise un numéro)
 * changent toujours l'ETag, donc un `If-None-Match` ancien ne donne jamais 304.
 */
type EtagRow = { id: string; currentVersion: number; updatedAt: Date };

export const contentEtagSeed = (row: EtagRow): string =>
  `${row.id}-v${row.currentVersion}-${row.updatedAt.getTime()}`;

export const thumbnailEtagSeed = (row: EtagRow): string =>
  `${row.id}-thumb-v${row.currentVersion}-${row.updatedAt.getTime()}`;

/** Contenu d'une version précise : l'identifiant de ligne distingue un numéro réutilisé. */
export const versionEtagSeed = (mediaId: string, v: { id: string; version: number }): string =>
  `${mediaId}-ver${v.version}-${v.id}`;
