/**
 * Intégrité de la copie attachments / studio_images vers media (décision 4 de B123), partagée par
 * `count-legacy-refs.ts` (mesure en lecture seule) et `retire-attachments.ts` (garde avant retrait).
 * Une ligne est copiée par id si une ligne media de même id existe (soft-supprimée comprise),
 * copiée par clé si une ligne media de la même organisation porte la même clé (attachments seulement :
 * la clé de studio n'est pas servie par l'alias), copiée par clé hors organisation si seule une autre
 * organisation la porte (non bloquant, compté à part), sinon orpheline inaccessible. Les fragments ne contiennent aucune
 * entrée utilisateur.
 */

export type LegacyKind = "attachments" | "studio_images";

/** Colonne de clé de stockage de chaque ancienne table. */
export const LEGACY_KEY_COLUMN: Record<LegacyKind, string> = {
  attachments: "storage_key",
  studio_images: "s3_key",
};

/** Vrai si une ligne media a le même identifiant que la ligne `alias`. */
export const idMatchSql = (alias: string): string => `EXISTS (SELECT 1 FROM media m WHERE m.id = ${alias}.id)`;

/**
 * Vrai si une ligne media de la même organisation porte la même clé de stockage (attachments seulement,
 * l'organisation est celle de l'espace de la ligne ; toujours faux pour studio_images). Un média d'une
 * autre organisation ne rend pas l'alias atteignable depuis le document.
 */
export const keyMatchSql = (kind: LegacyKind, alias: string): string =>
  kind === "attachments"
    ? `EXISTS (SELECT 1 FROM media m JOIN spaces sp ON sp.id = ${alias}.space_id WHERE m.storage_key = ${alias}.storage_key AND m.organization_id = sp.organization_id)`
    : "false";

/** Vrai si un média porte la même clé mais hors de l'organisation de la ligne (objet conservé, alias non résolu). */
export const keyOtherOrgSql = (kind: LegacyKind, alias: string): string =>
  kind === "attachments"
    ? `(EXISTS (SELECT 1 FROM media m WHERE m.storage_key = ${alias}.storage_key) AND NOT ${keyMatchSql(kind, alias)})`
    : "false";

/**
 * Prédicat SQL d'une ligne orpheline inaccessible de `alias` : ni id ni clé. Une clé portée par une autre
 * organisation n'est pas une perte d'objet : elle n'est pas bloquante, mais comptée à part.
 */
export const orphanSql = (kind: LegacyKind, alias: string): string =>
  `NOT ${idMatchSql(alias)} AND NOT ${keyMatchSql(kind, alias)} AND NOT ${keyOtherOrgSql(kind, alias)}`;
