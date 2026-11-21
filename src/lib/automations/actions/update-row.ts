/**
 * Action « update_row » (C5.5) — met à jour les cellules d'une ligne via merge
 * atomique. La cible est `cfg.rowId` (interpolé) si fourni, sinon la ligne
 * déclencheuse `ctx.rowId`. Base cible : `cfg.databaseId` (interpolable) sinon celle de
 * l'automatisation, validée par `resolveTargetDatabaseId`. N'émet AUCUN déclencheur (anti-boucle).
 */
import { z } from "zod";
import { mergeDatabaseRowCells, loadColumnTypes } from "@/lib/databases/row-writes";
import type { RowChangeContext } from "@/lib/databases/row-change-context";
import { interpolate, interpolateCells } from "@/lib/automations/interpolate";
import { coerceCellsByColumnType, appendRelationColumns } from "@/lib/automations/cell-coercion";
import { automationMediaGuard } from "@/lib/automations/media-guard";
import { resolveTargetDatabaseId } from "@/lib/automations/target-database";
import type { ActionDefinition, AutomationRow, ExecutionContext } from "./types";

const configSchema = z.object({
  databaseId: z.string().optional(),
  rowId: z.string().optional(),
  relationMode: z.enum(["replace", "append"]).optional(),
  relationModes: z.record(z.string(), z.enum(["replace", "append"])).optional(),
  cells: z
    .record(z.string(), z.unknown())
    .refine((c) => Object.keys(c).length > 0, {
      message: "Au moins une cellule à écrire est requise (cells)",
    }),
});

async function prepare(
  actionConfig: Record<string, unknown>,
  automation: AutomationRow,
  ctx: ExecutionContext
) {
  const cfg = (actionConfig ?? {}) as {
    databaseId?: string;
    rowId?: string;
    relationMode?: string;
    relationModes?: Record<string, string>;
    cells?: Record<string, unknown>;
  };
  if (!cfg.cells || typeof cfg.cells !== "object" || Object.keys(cfg.cells).length === 0) {
    throw new Error("Configuration update_row invalide : aucune cellule à écrire");
  }
  const databaseId = await resolveTargetDatabaseId({
    actionType: "update_row",
    configDatabaseId: cfg.databaseId,
    automation,
    ctx,
  });
  const targetRowId = cfg.rowId ? interpolate(cfg.rowId, ctx) : ctx.rowId;
  if (!targetRowId) {
    throw new Error("update_row : aucune ligne cible (ni rowId configuré, ni ligne déclencheuse)");
  }
  const columnTypes = await loadColumnTypes(databaseId);
  const cells = coerceCellsByColumnType(interpolateCells(cfg.cells, ctx), columnTypes);
  const appendColumns = appendRelationColumns(cfg, cells, columnTypes);
  return { databaseId, targetRowId, cells, appendColumns };
}

export const updateRowAction: ActionDefinition = {
  type: "update_row",
  configSchema,
  requiresDatabase: true,
  async execute(actionConfig, automation, ctx) {
    const { databaseId, targetRowId, cells, appendColumns } = await prepare(actionConfig, automation, ctx);
    const rowCtx: RowChangeContext = {
      source: "automation",
      automationId: automation.id,
      actorLabel: automation.name,
      mediaGuard: await automationMediaGuard(automation, ctx, cells),
    };
    const updated = await mergeDatabaseRowCells(
      databaseId,
      targetRowId,
      cells,
      appendColumns.length > 0 ? { appendColumns } : {},
      undefined,
      rowCtx
    );
    if (!updated) {
      throw new Error("update_row : ligne cible introuvable dans la base");
    }
    return { updatedRow: { id: updated.id }, databaseId };
  },
  async simulate(actionConfig, automation, ctx) {
    const { databaseId, targetRowId, appendColumns } = await prepare(actionConfig, automation, ctx);
    return {
      updatedRow: { id: targetRowId },
      databaseId,
      ...(appendColumns.length > 0 ? { appendedRelations: appendColumns } : {}),
      simulated: true,
    };
  },
};
