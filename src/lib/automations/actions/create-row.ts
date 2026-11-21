/**
 * Action « create_row » (C5.5) — crée une ligne dans la base de l'automatisation
 * à partir d'un mapping `{ [columnId]: gabarit }` interpolé depuis le contexte.
 *
 * Base cible : `cfg.databaseId` (interpolable) sinon `automation.databaseId`,
 * validée par `resolveTargetDatabaseId` (même organisation, droit d'écriture). N'émet AUCUN déclencheur (anti-boucle : la ligne créée
 * ne réactive pas les automations row_created de la base).
 */
import { z } from "zod";
import {
  createDatabaseRow,
  findRowByCellValue,
  fillEmptyRowCells,
  loadColumnTypes,
  mergeDatabaseRowCells,
  withMatchLock,
} from "@/lib/databases/row-writes";
import type { DbExecutor } from "@/lib/databases/row-writes";
import type { RowChangeContext } from "@/lib/databases/row-change-context";
import { cellsAlreadyMatch, columnsToFill } from "@/lib/databases/cell-compare";
import { interpolate, interpolateCells } from "@/lib/automations/interpolate";
import { coerceCellsByColumnType, appendRelationColumns } from "@/lib/automations/cell-coercion";
import { automationMediaGuard } from "@/lib/automations/media-guard";
import { resolveTargetDatabaseId } from "@/lib/automations/target-database";
import type { ActionDefinition, AutomationRow, ExecutionContext } from "./types";
import { simId } from "./simulation";

const configSchema = z.object({
  databaseId: z.string().optional(),
  // Dédoublonnage : si une ligne a déjà cette valeur dans la colonne, on la
  // met à jour (fusion) au lieu d'en créer une.
  match: z
    .object({ columnId: z.string().min(1), value: z.string() })
    .optional(),
  // Ligne trouvée : "overwrite" (défaut) remplace les valeurs, "fill_empty"
  // ne remplit que les cellules vides. Un doublon exact n'écrit jamais.
  onMatch: z.enum(["fill_empty", "overwrite"]).optional(),
  relationMode: z.enum(["replace", "append"]).optional(),
  relationModes: z.record(z.string(), z.enum(["replace", "append"])).optional(),
  cells: z
    .record(z.string(), z.unknown())
    .refine((c) => Object.keys(c).length > 0, {
      message: "Au moins une cellule à écrire est requise (cells)",
    }),
});

type CreateRowConfig = {
  databaseId?: string;
  match?: { columnId?: string; value?: string };
  onMatch?: string;
  relationMode?: string;
  relationModes?: Record<string, string>;
  cells?: Record<string, unknown>;
};

/** Validation, cible (contrôle d'accès compris), cellules coercées et recherche de `match` (lecture). */
async function prepare(
  actionConfig: Record<string, unknown>,
  automation: AutomationRow,
  ctx: ExecutionContext,
  opts: { lookup: boolean } = { lookup: true }
) {
  const cfg = (actionConfig ?? {}) as CreateRowConfig;
  if (!cfg.cells || typeof cfg.cells !== "object" || Object.keys(cfg.cells).length === 0) {
    throw new Error("Configuration create_row invalide : aucune cellule à écrire");
  }
  const databaseId = await resolveTargetDatabaseId({
    actionType: "create_row",
    configDatabaseId: cfg.databaseId,
    automation,
    ctx,
  });
  const columnTypes = await loadColumnTypes(databaseId);
  const cells = coerceCellsByColumnType(interpolateCells(cfg.cells, ctx), columnTypes);
  const appendColumns = appendRelationColumns(cfg, cells, columnTypes);
  const matchColumnId = cfg.match?.columnId || undefined;
  const needle = matchColumnId ? interpolate(String(cfg.match?.value ?? ""), ctx).trim() : "";
  let existing: { id: string; cells?: unknown } | undefined;
  if (opts.lookup && matchColumnId && needle) {
    existing = await findRowByCellValue(databaseId, matchColumnId, needle);
  }
  const onMatch: "fill_empty" | "overwrite" = cfg.onMatch === "fill_empty" ? "fill_empty" : "overwrite";
  return { databaseId, cells, existing, appendColumns, onMatch, matchColumnId, needle };
}

type MatchPlan =
  | { outcome: "ignored" }
  | { outcome: "completed"; filledColumns: string[] }
  | { outcome: "updated" };

/** Décision commune à l'exécution et à la simulation pour une ligne trouvée. */
function planMatch(
  existingCells: Record<string, unknown> | null | undefined,
  cells: Record<string, unknown>,
  appendColumns: string[],
  onMatch: "fill_empty" | "overwrite"
): MatchPlan {
  if (cellsAlreadyMatch(existingCells, cells, appendColumns)) return { outcome: "ignored" };
  if (onMatch === "fill_empty") {
    const filledColumns = columnsToFill(existingCells, cells, appendColumns);
    return filledColumns.length === 0 ? { outcome: "ignored" } : { outcome: "completed", filledColumns };
  }
  return { outcome: "updated" };
}

export const createRowAction: ActionDefinition = {
  type: "create_row",
  configSchema,
  requiresDatabase: true,
  async execute(actionConfig, automation, ctx) {
    const { databaseId, cells, appendColumns, onMatch, matchColumnId, needle } = await prepare(
      actionConfig,
      automation,
      ctx,
      { lookup: false }
    );
    // Recherche puis création/fusion dans une même transaction, sérialisée par
    // (base, colonne, valeur normalisée) : deux exécutions simultanées sur la
    // même valeur ne créent pas deux lignes.
    const rowCtx: RowChangeContext = {
      source: "automation",
      automationId: automation.id,
      actorLabel: automation.name,
      mediaGuard: await automationMediaGuard(automation, ctx, cells),
    };
    const run = async (tx?: DbExecutor) => {
      const existing =
        matchColumnId && needle
          ? await (tx
              ? findRowByCellValue(databaseId, matchColumnId, needle, tx)
              : findRowByCellValue(databaseId, matchColumnId, needle))
          : undefined;
      if (existing) {
        const plan = planMatch(existing.cells as Record<string, unknown> | null | undefined, cells, appendColumns, onMatch);
        const rowOut = (extra: Record<string, unknown>) => ({
          createdRow: { id: existing.id },
          row: { id: existing.id, created: false, databaseId, ...extra },
          databaseId,
        });
        if (plan.outcome === "ignored") return rowOut({ outcome: "ignored" });
        if (plan.outcome === "completed") {
          const filled = await fillEmptyRowCells(databaseId, existing.id, cells, { appendColumns }, tx, rowCtx);
          if (filled) {
            return rowOut({
              outcome: filled.filledColumns.length > 0 ? "completed" : "ignored",
              ...(filled.filledColumns.length > 0 ? { filledColumns: filled.filledColumns } : {}),
            });
          }
        } else {
          const merged = await mergeDatabaseRowCells(databaseId, existing.id, cells, { appendColumns }, tx, rowCtx);
          if (merged) return rowOut({ outcome: "updated" });
        }
      }
      const created = await createDatabaseRow(databaseId, cells, tx, rowCtx);
      return {
        createdRow: { id: created.id },
        row: { id: created.id, created: true, outcome: "created", databaseId },
        databaseId,
      };
    };
    return matchColumnId && needle
      ? withMatchLock(databaseId, matchColumnId, needle, (tx) => run(tx))
      : run();
  },
  async simulate(actionConfig, automation, ctx) {
    // La recherche `match` est une lecture, faite réellement pour savoir si
    // l'exécution réelle mettrait à jour, compléterait, ignorerait ou créerait.
    const { databaseId, cells, existing, appendColumns, onMatch } = await prepare(actionConfig, automation, ctx);
    if (!existing) {
      const id = simId();
      return { createdRow: { id }, row: { id, created: true, outcome: "created", databaseId }, databaseId, simulated: true };
    }
    const plan = planMatch(existing.cells as Record<string, unknown> | null | undefined, cells, appendColumns, onMatch);
    return {
      createdRow: { id: existing.id },
      row: {
        id: existing.id,
        created: false,
        outcome: plan.outcome,
        ...(plan.outcome === "completed" ? { filledColumns: plan.filledColumns } : {}),
        databaseId,
      },
      databaseId,
      ...(plan.outcome !== "ignored" && appendColumns.length > 0 ? { appendedRelations: appendColumns } : {}),
      simulated: true,
    };
  },
};
