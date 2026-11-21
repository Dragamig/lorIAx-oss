/**
 * Fusion des valeurs `system_settings`.
 *
 * Plusieurs écrans d'administration écrivent la MEME clé (`rolePermissions` est
 * écrite par /admin/system et par /admin/ai/settings, `whisper` par /admin/system
 * et /admin/ai/settings, etc.). Chaque page reconstruit l'objet complet depuis
 * ses propres valeurs par défaut : un enregistrement en remplacement intégral
 * efface donc les champs gérés par l'autre page. Ce module fournit la fusion
 * appliquée par les routes PUT avant écriture.
 */

/** Objet JSON simple (ni null, ni tableau, ni scalaire). */
export function isPlainObject(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

/**
 * Fusion de NIVEAU 1 entre la valeur déjà en base et la valeur reçue.
 *
 * Règles :
 *  - clé absente du corps reçu   → la valeur en base est conservée telle quelle ;
 *  - clé présente                → elle écrase la valeur en base, EN BLOC ;
 *  - clé reçue à `null`          → le champ est SUPPRIMÉ de la valeur stockée.
 *    C'est la seule façon de vider un réglage : comme une clé absente est
 *    conservée, un client qui veut retirer un champ doit l'envoyer à `null` ;
 *  - si l'une des deux valeurs n'est pas un objet simple (tableau, scalaire,
 *    null), la valeur reçue remplace intégralement la valeur en base.
 *
 * Volontairement bornée en profondeur, jamais récursive à l'infini : une fusion
 * profonde générale rendrait impossible de vider une valeur composite, puisque
 * l'ancien contenu ressurgirait de la base à chaque enregistrement.
 *
 * @param depth 1 par défaut. Passer 2 pour les clés dont la collision se joue au
 *   niveau des sous-objets, voir `DEEP_MERGE_KEYS`.
 */
export function mergeSettingValue(
  existing: unknown,
  incoming: unknown,
  depth: 1 | 2 = 1
): unknown {
  if (!isPlainObject(existing) || !isPlainObject(incoming)) return incoming;

  const merged: Record<string, unknown> = { ...existing };
  for (const [field, value] of Object.entries(incoming)) {
    if (value === null) {
      delete merged[field];
      continue;
    }
    merged[field] =
      depth === 2 ? mergeSettingValue(merged[field], value, 1) : value;
  }
  return merged;
}

/**
 * Clés fusionnées au niveau 2.
 *
 * `rolePermissions` est une ligne unique partagée par deux écrans qui gèrent des
 * familles de permissions DISJOINTES pour les MEMES rôles : /admin/system pose
 * `canCreateSpaces`, `canInviteMembers`… et /admin/ai/settings pose `canUseAI`,
 * `canUsePlayground`… Une fusion de niveau 1 remplacerait l'objet `viewer` en
 * bloc, donc la collision d'origine subsisterait : le résultat ne dépendrait
 * que de la discipline du client à réémettre les champs qu'il ne gère pas. Au
 * niveau 2, chaque écran n'écrit que ses propres booléens.
 */
export const DEEP_MERGE_KEYS = new Set<string>(["rolePermissions"]);

/** Profondeur de fusion à appliquer pour une clé `system_settings` donnée. */
export function mergeDepthForKey(key: string): 1 | 2 {
  return DEEP_MERGE_KEYS.has(key) ? 2 : 1;
}
