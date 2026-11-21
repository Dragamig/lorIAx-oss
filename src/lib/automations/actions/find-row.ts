/**
 * Action « find_row » : cherche dans une base la plus ancienne ligne dont une
 * cellule égale une valeur (sans casse ni espaces de bord), ou, en mode
 * identifiant (`rowId`, interpolable), la ligne de cet identifiant dans la
 * base cible (un tableau JSON, ex. cellule relation, donne son premier
 * identifiant ; `rowId` présent exclut tout repli sur colonne/valeur). Expose
 * le contenu aux étapes suivantes (`storeAs` puis `{{variables.<nom>.foundRow...}}`).
 *
 * Base cible : `cfg.databaseId` (interpolable) sinon celle de l'automatisation,
 * validée par `resolveTargetDatabaseId` en mode lecture (même organisation,
 * droit de lecture de l'auteur). N'écrit rien.
 */
import { z } from "zod";
import { findRowByCellValue, findRowById } from "@/lib/databases/row-writes";
import { interpolate } from "@/lib/automations/interpolate";
import { resolveTargetDatabaseId } from "@/lib/automations/target-database";
import type { ActionDefinition } from "./types";

const configSchema = z
  .object({
    databaseId: z.string().optional(),
    columnId: z.string().optional(),
    value: z.string().optional(),
    rowId: z.string().optional(),
  })
  .superRefine((cfg, issue) => {
    if (cfg.rowId !== undefined) return;
    if (!cfg.columnId) {
      issue.addIssue({
        code: "custom",
        message: "La colonne à comparer est requise (columnId) ou l'identifiant de ligne (rowId)",
        path: ["columnId"],
      });
    } else if (cfg.value === undefined) {
      issue.addIssue({ code: "custom", message: "La valeur à comparer est requise (value)", path: ["value"] });
    }
  });

/**
 * Premier identifiant d'une valeur interpolée : chaîne simple telle quelle,
 * tableau JSON (cellule relation) réduit à son premier élément texte.
 * Renvoie "" si rien d'exploitable.
 */
export function extractRowId(raw: string): string {
  const text = raw.trim();
  if (!text.startsWith("[")) return text;
  try {
    const parsed: unknown = JSON.parse(text);
    if (Array.isArray(parsed)) {
      const first = parsed[0];
      return typeof first === "string" ? first.trim() : "";
    }
  } catch {
    // pas du JSON : la validation uuid de findRowById écartera la valeur
  }
  return text;
}

export const findRowAction: ActionDefinition = {
  type: "find_row",
  configSchema,
  requiresDatabase: true,
  readOnly: true,
  async simulate(actionConfig, automation, ctx) {
    // Lecture pure : même comportement dans les deux modes.
    return findRowAction.execute(actionConfig, automation, ctx);
  },
  async execute(actionConfig, automation, ctx) {
    const cfg = configSchema.safeParse(actionConfig ?? {});
    if (!cfg.success) {
      throw new Error(`Configuration find_row invalide : ${cfg.error.issues[0].message}`);
    }
    const databaseId = await resolveTargetDatabaseId({
      actionType: "find_row",
      configDatabaseId: cfg.data.databaseId,
      automation,
      ctx,
      access: "read",
    });
    let found;
    if (cfg.data.rowId !== undefined) {
      const rowId = extractRowId(interpolate(cfg.data.rowId, ctx));
      found = rowId ? await findRowById(databaseId, rowId) : undefined;
    } else {
      const needle = interpolate(cfg.data.value ?? "", ctx).trim();
      found = needle
        ? await findRowByCellValue(databaseId, cfg.data.columnId ?? "", needle)
        : undefined;
    }
    return {
      foundRow: found
        ? { id: found.id, cells: (found.cells ?? {}) as Record<string, unknown> }
        : null,
      databaseId,
    };
  },
};
