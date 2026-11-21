/**
 * Registre d'actions d'automatisation (W1).
 *
 * Source unique de vérité du dispatch : l'executor fait un simple lookup
 * `getAction(type)?.execute(...)` au lieu d'un switch, et les routes mutualisent
 * `configSchema`/`validate` pour valider la config à la création/màj. Ajouter une
 * action = ajouter un fichier + une entrée ici (rien d'autre à toucher).
 */
import type { ActionDefinition } from "./types";
import { webhookAction } from "./webhook";
import { sendEmailAction } from "./send-email";
import { notifyUserAction } from "./notify-user";
import { aiAction } from "./ai";
import { createRowAction } from "./create-row";
import { updateRowAction } from "./update-row";
import { findRowAction } from "./find-row";
import { createDocumentAction } from "./create-document";
import { createDesignAction } from "./create-design";
import { createTaskAction } from "./create-task";

const DEFINITIONS: ActionDefinition[] = [
  webhookAction,
  sendEmailAction,
  notifyUserAction,
  aiAction,
  createRowAction,
  updateRowAction,
  findRowAction,
  createDocumentAction,
  createDesignAction,
  createTaskAction,
];

export const ACTION_REGISTRY: Record<string, ActionDefinition> = Object.fromEntries(
  DEFINITIONS.map((d) => [d.type, d])
);

/** Récupère la définition d'une action, ou undefined si le type est inconnu. */
export function getAction(type: string): ActionDefinition | undefined {
  return ACTION_REGISTRY[type];
}

/**
 * Valide une config d'action via le registre (mutualisé routes ↔ executor) :
 * type connu → `configSchema` Zod → `validate` impérative (SSRF, etc.). En
 * contexte autonome (`opts.autonomous`), rejette aussi les actions
 * `requiresDatabase` (create_row/update_row), sans cible hors base.
 * Retourne un message d'erreur, ou null si la config est valide.
 */
export function validateActionConfig(
  type: string,
  config: Record<string, unknown>,
  opts: { autonomous?: boolean } = {}
): string | null {
  const def = getAction(type);
  if (!def) return `Type d'action inconnu : ${type}`;
  if (opts.autonomous && def.requiresDatabase) {
    return `L'action « ${type} » nécessite une base de données et ne peut pas être utilisée dans un workflow autonome`;
  }
  const parsed = def.configSchema.safeParse(config);
  if (!parsed.success) {
    return `Config ${type} invalide : ${parsed.error.issues[0].message}`;
  }
  if (def.validate) {
    const err = def.validate(config);
    if (err) return err;
  }
  return null;
}
