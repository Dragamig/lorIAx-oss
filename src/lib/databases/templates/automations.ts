/**
 * Écritures neutres de modèle : insertion d'automatismes désactivés sur une base, et ajout d'options à une
 * colonne select. Le module CRM n'écrit jamais lui-même dans les tables de données des Bases.
 */
import { and, eq } from "drizzle-orm";
import { automations, userDatabaseColumns, type automationActionEnum } from "@/lib/db/schema";
import type { DbExecutor } from "../row-writes";

export interface TemplateAutomation {
  name: string;
  triggerType: "value_changed" | "date_reached" | "webhook_inbound";
  triggerConfig: Record<string, unknown>;
  actionType: string;
  actionConfig: Record<string, unknown>;
  graph: unknown;
}

/** Insère les automatismes sur la base, toujours désactivés. */
export async function insertDisabledAutomations(
  tx: DbExecutor,
  databaseId: string,
  createdBy: string,
  items: TemplateAutomation[],
): Promise<void> {
  for (const a of items) {
    await tx.insert(automations).values({
      databaseId,
      spaceId: null,
      name: a.name,
      triggerType: a.triggerType,
      triggerConfig: a.triggerConfig,
      actionType: a.actionType as (typeof automationActionEnum.enumValues)[number],
      actionConfig: a.actionConfig,
      graph: a.graph,
      enabled: false,
      createdBy,
    });
  }
}

/** Ajoute des libellés à la fin des options d'une colonne select, sans toucher aux options existantes. */
export async function appendSelectOptions(
  tx: DbExecutor,
  databaseId: string,
  columnId: string,
  labels: string[],
): Promise<void> {
  const [col] = await tx
    .select({ config: userDatabaseColumns.config })
    .from(userDatabaseColumns)
    .where(and(eq(userDatabaseColumns.id, columnId), eq(userDatabaseColumns.databaseId, databaseId)))
    .limit(1);
  if (!col) return;
  const cfg = (col.config ?? {}) as Record<string, unknown>;
  const options = Array.isArray(cfg.options) ? cfg.options : [];
  await tx
    .update(userDatabaseColumns)
    .set({ config: { ...cfg, options: [...options, ...labels] } })
    .where(and(eq(userDatabaseColumns.id, columnId), eq(userDatabaseColumns.databaseId, databaseId)));
}
