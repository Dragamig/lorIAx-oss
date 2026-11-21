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
