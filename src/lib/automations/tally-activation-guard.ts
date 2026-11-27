/**
 * Garde d'activation des automatismes Tally sans formulaire (CRM lot 8).
 *
 * Un automatisme Tally se reconnaît à son déclencheur `webhook_inbound` dont
 * `trigger_config` déclare la clé `tallyFormId` (null ou vide tant que le
 * formulaire n'est pas choisi). Un webhook sans cette clé (générique, ou Tally
 * déjà branché avant la clé) n'est jamais bloqué. Fonctions pures : les routes
 * d'écriture des automatismes les appellent au point où `enabled` peut passer
 * à true (PATCH et POST, base-liés et autonomes). Module sans import serveur :
 * importé aussi par la liste côté navigateur. La réponse 422 vit dans
 * `tally-activation-response.ts` (serveur).
 */
export const TALLY_FORM_KEY = "tallyFormId";
export const TALLY_FORM_REQUIRED_CODE = "tally_form_required";

const hasMarker = (config: unknown): boolean =>
  !!config && typeof config === "object" && Object.prototype.hasOwnProperty.call(config, TALLY_FORM_KEY);

const hasForm = (config: unknown): boolean => {
  const v = (config as Record<string, unknown> | null | undefined)?.[TALLY_FORM_KEY];
  return typeof v === "string" && v.trim() !== "";
};

/** Vrai pour un webhook entrant qui déclare un formulaire Tally encore non choisi. */
export function tallyFormMissing(triggerType: string | null | undefined, triggerConfig: unknown): boolean {
  return triggerType === "webhook_inbound" && hasMarker(triggerConfig) && !hasForm(triggerConfig);
}

interface StoredAutomation {
  enabled: boolean;
  triggerType: string;
  triggerConfig: unknown;
}

interface AutomationChange {
  enabled?: boolean;
  triggerType?: string;
  triggerConfig?: Record<string, unknown>;
}

/**
 * Vrai si l'état résultant (courant + changement) est activé avec un formulaire
 * Tally manquant. `current` est null à la création. Une `triggerConfig` envoyée
 * remplace la précédente : une clé omise vaut « formulaire effacé ».
 */
export function activationRequiresTallyForm(current: StoredAutomation | null, change: AutomationChange): boolean {
  const enabled = change.enabled ?? current?.enabled ?? false;
  if (!enabled) return false;
  const triggerType = change.triggerType ?? current?.triggerType;
  if (triggerType !== "webhook_inbound") return false;
  if (change.triggerConfig === undefined) return tallyFormMissing(triggerType, current?.triggerConfig);
  const declared = hasMarker(current?.triggerConfig) || hasMarker(change.triggerConfig);
  return declared && !hasForm(change.triggerConfig);
}
