import type { AutomationGraph } from "@/lib/automations/automation-graph";

/** Libellés utilisateur (fr) des déclencheurs et actions — source unique (page + admin). */
export const TRIGGER_LABELS: Record<string, string> = {
  row_created: "Ligne créée",
  row_updated: "Ligne modifiée",
  row_deleted: "Ligne supprimée",
  cron: "Planifié",
  date_reached: "Date atteinte",
  value_changed: "Changement de valeur",
  manual: "Manuel (bouton)",
  webhook_inbound: "Webhook entrant",
  media_uploaded: "Média ajouté",
};

export const ACTION_LABELS: Record<string, string> = {
  webhook: "Webhook",
  notify_user: "Notification utilisateur",
  create_row: "Créer une ligne",
  update_row: "Modifier une ligne",
  find_row: "Chercher une ligne",
  send_email: "Envoyer un email",
  ai: "IA + génération de document",
  create_document: "Créer un document",
  create_task: "Créer une tâche",
  create_design: "Générer un design",
};

/**
 * Résumé d'action d'une automatisation. Le graphe fait foi : la colonne
 * action_type est dénormalisée et peut être périmée après édition du graphe.
 */
export function deriveActionLabel(
  actionType: string,
  graph: AutomationGraph | null | undefined,
): string {
  const label = (t: string) => ACTION_LABELS[t] ?? t;
  const actions = (graph?.nodes ?? []).filter((n) => n.kind === "action" && n.actionType);
  if (actions.length === 0) return label(actionType);
  const first = label(actions[0].actionType as string);
  return actions.length > 1 ? `${first} + ${actions.length - 1}` : first;
}
