/**
 * Types partagés du registre d'actions d'automatisation (W1).
 *
 * Isolés ici (sans dépendance vers executor.ts) pour casser le cycle
 * executor → registry → actions → types. Chaque action vit dans son fichier et
 * expose une `ActionDefinition` ; l'executor ne fait plus qu'un lookup.
 */
import type { z } from "zod";

/** Événements déclencheurs reconnus (base-liés + manuel autonome). */
export type AutomationEvent =
  | "row_created"
  | "row_updated"
  | "row_deleted"
  | "cron"
  | "date_reached"
  | "value_changed"
  | "manual"
  | "webhook_inbound";

/**
 * Contexte d'exécution générique d'un workflow. Sur-ensemble de l'ancien
 * `ExecutionPayload` : champs base-liés (databaseId/rowId/cells) ET autonomes
 * (spaceId/documentId/user) optionnels. L'invariant databaseId OU spaceId est
 * porté par l'automation, pas par le contexte.
 */
export interface ExecutionContext {
  event?: AutomationEvent;
  // Contexte base-lié (déclencheurs row_*/cron/date/value).
  databaseId?: string;
  rowId?: string;
  cells?: Record<string, unknown>;
  // Contexte workflow autonome (déclencheur manuel : bouton dans un document).
  spaceId?: string;
  documentId?: string;
  user?: { id?: string; email?: string; name?: string };
  // Variables accumulées entre nœuds d'un graphe : résultat d'une action
  // précédente stocké via `GraphNode.storeAs`, réutilisable dans les étapes
  // suivantes via `{{variables.<nom>...}}`.
  variables?: Record<string, unknown>;
}

/** Ligne d'automation telle que manipulée par l'executor et les actions. */
export interface AutomationRow {
  id: string;
  // Découplage W1 : databaseId optionnel (workflows autonomes liés à spaceId).
  databaseId: string | null;
  spaceId?: string | null;
  name: string;
  triggerType: string;
  triggerConfig: unknown;
  actionType: string;
  actionConfig: unknown;
  graph?: unknown;
  enabled: boolean;
  lastRunAt: Date | null;
  createdBy?: string | null;
}

/**
 * Exécute une action avec une config explicite. Partagé entre l'automatisation
 * linéaire (config = automation.actionConfig) et chaque nœud action d'un graphe
 * (config = node.actionConfig). Retourne un objet fusionné dans le payload du
 * run, ou void.
 */
export type ActionExecute = (
  config: Record<string, unknown>,
  automation: AutomationRow,
  ctx: ExecutionContext
) => Promise<Record<string, unknown> | void>;

/**
 * Définition d'une action du registre.
 *
 * - `configSchema` : validation structurelle Zod de la config, mutualisable
 *   entre les routes (à la création/màj) et l'executor.
 * - `validate` : validation impérative complémentaire non exprimable en Zod
 *   (ex. anti-SSRF d'une URL webhook). Retourne un message d'erreur ou null.
 * - `execute` : exécution effective de l'action.
 */
export interface ActionDefinition {
  type: string;
  configSchema: z.ZodType;
  validate?: (config: Record<string, unknown>) => string | null;
  execute: ActionExecute;
  /**
   * Comportement en mode « simulé » (test dans le builder) : valide la config,
   * résout les entrées, applique le contrôle d'accès, puis rend une sortie de
   * même forme que `execute` avec des identifiants `sim_…` et `simulated: true`,
   * SANS écriture ni appel externe. Obligatoire : chaque action du registre doit
   * dire ce qu'elle fait en simulation (verrouillé par un test).
   */
  simulate: ActionExecute;
  /**
   * Action de pure lecture : exécutée réellement dans les deux modes (sa
   * `simulate` peut alors être `execute`) et tracée « success », pas « simulated ».
   */
  readOnly?: boolean;
  /**
   * Action bornée à une base de données (create_row/update_row). Interdite dans
   * un workflow autonome (déclencheur bouton sans base) : sans `databaseId`, elle
   * n'a pas de cible et pourrait servir d'escalade cross-org. Les routes
   * `/api/automations` la rejettent à la création.
   */
  requiresDatabase?: boolean;
}
