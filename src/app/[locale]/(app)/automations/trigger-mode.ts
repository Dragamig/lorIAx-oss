export type TriggerMode = "webhook" | "tally";

export interface TriggerModeInput {
  /** null tant que l'état de la connexion Tally n'est pas connu. */
  tallyConnected: boolean | null;
  /** Un corps a déjà été reçu sur l'URL du webhook. */
  hasReceived: boolean;
  /** Au moins un import Tally existe pour cet automatisme (webhook Tally branché). */
  hasTallyImports?: boolean;
}

/**
 * Mode initial du déclencheur webhook entrant, déduit de l'état existant :
 * Tally branché ou clé connectée = "tally", sinon "choose" si rien n'est
 * configuré (aucun corps reçu), sinon "webhook". "pending" = état inconnu.
 */
export function deduceTriggerMode(i: TriggerModeInput): TriggerMode | "choose" | "pending" {
  if (i.tallyConnected === null) return "pending";
  if (i.tallyConnected || i.hasTallyImports) return "tally";
  return i.hasReceived ? "webhook" : "choose";
}
