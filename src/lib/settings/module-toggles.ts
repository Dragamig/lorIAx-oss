import { getModuleManifests } from "@/lib/modules/registry";
import { resolveToggleKey } from "@/lib/modules/toggle";
import { isPlainObject } from "./merge";

/**
 * Garde-fou : l'activation d'un module ne s'écrit QUE par
 * `PATCH /api/admin/modules/[id]` (qui vérifie licence, dépendances et rôle).
 *
 * Les écrans de réglages historiques renvoient l'objet de configuration complet,
 * interrupteur compris : sans ce filtre, enregistrer une page de config
 * ré-activerait ou désactiverait silencieusement un module, en contournant
 * toutes ces vérifications.
 */

export type ToggleStripResult =
  /** La clé entière porte un interrupteur : ne rien écrire. */
  | { skip: true }
  /** Valeur à écrire, débarrassée des sous-champs d'interrupteur. */
  | { skip: false; value: unknown };

/** Sous-champs d'interrupteur déclarés par les manifestes pour cette clé. */
function toggleFieldsForKey(key: string): string[] {
  return getModuleManifests()
    .filter((manifest) => resolveToggleKey(manifest) === key)
    .map((manifest) => manifest.toggleField ?? "enabled");
}

/**
 * Retire du corps reçu les sous-champs d'interrupteur de tout manifeste dont la
 * `toggleKey` correspond à la clé écrite.
 *
 * Deux formes de stockage :
 *  - objet de configuration (`whisper`, `ai_global`, …) : seul le sous-champ de
 *    toggle est retiré, le reste de la config est écrit normalement ;
 *  - toggle porté à la racine de la clé (`meeting_rooms_enabled`, valeur
 *    booléenne nue ou `{enabled}`) : la clé entière est ignorée, il n'y a rien
 *    d'autre à y écrire. Une valeur non-objet sur une clé de toggle, comme un
 *    objet réduit au seul sous-champ de toggle, relèvent de ce cas.
 */
export function stripModuleToggleFields(key: string, value: unknown): ToggleStripResult {
  const fields = toggleFieldsForKey(key);
  if (fields.length === 0) return { skip: false, value };

  // Booléen nu, tableau, scalaire : rien d'autre que l'interrupteur.
  if (!isPlainObject(value)) return { skip: true };

  const cleaned: Record<string, unknown> = { ...value };
  for (const field of fields) delete cleaned[field];

  if (Object.keys(cleaned).length === 0) return { skip: true };
  return { skip: false, value: cleaned };
}
