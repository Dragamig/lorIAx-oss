import { tool } from "ai";
import { z } from "zod";
import { sanitizeRagContent } from "@/lib/ai/sanitize-content";
import {
  listAccessibleDatabases,
  getDatabaseColumns,
  getDatabaseSummary,
} from "@/lib/databases/list-databases";
import { neutralizeUnreadableMediaCells } from "@/lib/databases/attachment-cell-guard";
import { normalizeAttachments } from "@/lib/media/cell-values";
import { filterRows } from "@/components/editor/extensions/database-block/filter-tree";
import type { DbColumn, DbRow } from "@/components/editor/extensions/database-block/types";
import { requireDatabaseAccess, type ChatToolContext } from "./context";
import {
  CELL_MAX_CHARS,
  DUPLICATE_SCAN_MAX_ROWS,
  QUERY_DEFAULT_LIMIT,
  QUERY_MAX_LIMIT,
  QUERY_MAX_RESULT_CHARS,
} from "./limits";
import { queryFilterSchema, toFilterGroup } from "./filter-schema";
import { withToolLog } from "./tool-log";
import { loadRowsWithGuard } from "./rows-loader";
import { findDuplicateGroups, DEFAULT_NORMALIZATION } from "./duplicates";

const DUPLICATE_MAX_GROUPS_RETURNED = 50;
const DUPLICATE_UNSUPPORTED_KEY_TYPES = new Set(["attachment", "image", "relation"]);

/**
 * Valeur de cellule destinée au modèle : texte neutralisé, pièce jointe ou
 * image réduite à `{ filename }`, jamais de contenu ni d'URL média.
 */
export function serializeCellForModel(value: unknown, columnType: string): unknown {
  if (value === null || value === undefined) return null;
  if (columnType === "attachment") {
    if (!Array.isArray(value)) return [];
    return normalizeAttachments(value).items.map((item) => ({
      filename: sanitizeRagContent(String(item.value.filename ?? ""), CELL_MAX_CHARS),
    }));
  }
  if (columnType === "image") {
    if (typeof value === "string" && value === "") return null;
    return { filename: "image" };
  }
  if (typeof value === "string") return sanitizeRagContent(value, CELL_MAX_CHARS);
  if (Array.isArray(value)) {
    return value.map((v) =>
      typeof v === "string" ? sanitizeRagContent(v, CELL_MAX_CHARS) : serializeCellForModel(v, "text"),
    );
  }
  if (typeof value === "number" || typeof value === "boolean") return value;
  return sanitizeRagContent(JSON.stringify(value) ?? "", CELL_MAX_CHARS);
}

export function buildReadTools(ctx: ChatToolContext) {
  const list_databases = tool({
    description:
      "Liste les bases de données accessibles à l'utilisateur (id, nom, espace, nombre de lignes).",
    inputSchema: z.object({}),
    execute: withToolLog(ctx, "list_databases", async () => {
      const dbs = await listAccessibleDatabases({ orgId: ctx.orgId, spaceIds: ctx.spaceIds });
      return {
        databases: dbs.map((d) => ({
          id: d.id,
          name: sanitizeRagContent(d.name, 200),
          space: sanitizeRagContent(d.spaceName, 200),
          rowCount: d.rowCount,
        })),
      };
    }),
  });

  const describe_database = tool({
    description: "Décrit une base : nom, nombre de lignes et colonnes (id, nom, type).",
    inputSchema: z.object({ databaseId: z.string().describe("Identifiant de la base") }),
    execute: withToolLog(ctx, "describe_database", async ({ databaseId }) => {
      await requireDatabaseAccess(ctx, databaseId, "viewer");
      const [summary, columns] = await Promise.all([
        getDatabaseSummary(databaseId),
        getDatabaseColumns(databaseId),
      ]);
      return {
        id: databaseId,
        name: sanitizeRagContent(summary?.name ?? "", 200),
        rowCount: summary?.rowCount ?? 0,
        columns: columns.map((c) => ({
          id: c.id,
          name: sanitizeRagContent(c.name, 200),
          type: c.type,
        })),
      };
    }),
  });

  const query_rows = tool({
    description:
      "Lit les lignes d'une base, avec filtre optionnel, colonnes choisies (ids) et limite (50 par défaut, 200 max).",
    inputSchema: z.object({
      databaseId: z.string().describe("Identifiant de la base"),
      filter: queryFilterSchema.optional(),
      columns: z.array(z.string()).optional().describe("Ids des colonnes à rendre"),
      limit: z.number().int().min(1).optional(),
    }),
    execute: withToolLog(ctx, "query_rows", async ({ databaseId, filter, columns, limit }) => {
      await requireDatabaseAccess(ctx, databaseId, "viewer");
      const cols = await getDatabaseColumns(databaseId);
      const types = Object.fromEntries(cols.map((c) => [c.id, c.type]));

      const loaded = await loadRowsWithGuard(databaseId);
      if (!loaded) {
        return {
          error: `Base trop volumineuse pour une requête (plus de ${DUPLICATE_SCAN_MAX_ROWS} lignes). Demandez à l'utilisateur d'utiliser une vue filtrée.`,
        };
      }

      const safeCells = await neutralizeUnreadableMediaCells(
        types,
        loaded.map((r) => r.cells),
        ctx.user,
        ctx.orgId,
      );
      let rows = loaded.map(
        (r, i) =>
          ({
            id: r.id,
            databaseId,
            cells: safeCells[i],
            position: r.position,
            createdAt: "",
            updatedAt: "",
          }) as unknown as DbRow,
      );

      if (filter && filter.conditions.length > 0) {
        rows = filterRows(rows, toFilterGroup(filter), cols as unknown as DbColumn[], {
          userId: ctx.user.id,
        });
      }

      const effective = Math.min(limit ?? QUERY_DEFAULT_LIMIT, QUERY_MAX_LIMIT);
      const total = rows.length;
      const wanted = columns && columns.length > 0 ? new Set(columns) : null;
      const outCols = cols.filter((c) => !wanted || wanted.has(c.id));

      // Budget global de taille du résultat sérialisé (spec 5.7) : les lignes au-delà sont coupées.
      const out: { id: string; cells: Record<string, unknown> }[] = [];
      let size = 0;
      let cutBySize = false;
      for (const r of rows.slice(0, effective)) {
        const item = {
          id: r.id,
          cells: Object.fromEntries(
            outCols.map((c) => [c.id, serializeCellForModel(r.cells[c.id], c.type)]),
          ),
        };
        const itemSize = JSON.stringify(item).length;
        if (size + itemSize > QUERY_MAX_RESULT_CHARS) {
          cutBySize = true;
          break;
        }
        size += itemSize;
        out.push(item);
      }
      return {
        rows: out,
        total,
        truncated: total > out.length,
        ...(cutBySize
          ? {
              note: `Résultat réduit à ${out.length} ligne(s) pour tenir dans la taille maximale. Demander moins de colonnes, un filtre plus précis ou une limite plus basse.`,
            }
          : {}),
      };
    }),
  });

  const find_duplicates = tool({
    description:
      "Détecte les doublons d'une base selon 1 à 5 colonnes clés (ids). Lecture seule : ne modifie rien. Renvoie des groupes de lignes (rowIds), avec les colonnes en conflit.",
    inputSchema: z.object({
      databaseId: z.string().describe("Identifiant de la base"),
      keyColumnIds: z.array(z.string()).min(1).max(5).describe("Ids des colonnes formant la clé"),
      normalization: z
        .object({
          caseInsensitive: z.boolean().optional(),
          trim: z.boolean().optional(),
          collapseSpaces: z.boolean().optional(),
        })
        .optional(),
    }),
    execute: withToolLog(ctx, "find_duplicates", async ({ databaseId, keyColumnIds, normalization }) => {
      await requireDatabaseAccess(ctx, databaseId, "viewer");
      const cols = await getDatabaseColumns(databaseId);
      const keyColumns = keyColumnIds.map((id) => cols.find((c) => c.id === id));
      const missing = keyColumnIds.filter((_, i) => !keyColumns[i]);
      if (missing.length > 0) {
        return { error: `Colonne(s) de clé introuvable(s) : ${missing.join(", ")}.` };
      }
      const bad = keyColumns.find((c) => c && DUPLICATE_UNSUPPORTED_KEY_TYPES.has(c.type));
      if (bad) {
        return { error: `La colonne « ${sanitizeRagContent(bad.name, 200)} » (type ${bad.type}) ne peut pas servir de clé.` };
      }

      const loaded = await loadRowsWithGuard(databaseId);
      if (!loaded) {
        return {
          error: `Base trop volumineuse pour la détection de doublons (plus de ${DUPLICATE_SCAN_MAX_ROWS} lignes). Aucun résultat partiel n'est fourni.`,
        };
      }

      const groups = findDuplicateGroups(
        loaded,
        keyColumnIds,
        { ...DEFAULT_NORMALIZATION, ...normalization },
        Object.fromEntries(cols.map((c) => [c.id, c.type])),
      );

      return {
        keyColumns: keyColumns.map((c) => ({
          id: c!.id,
          name: sanitizeRagContent(c!.name, 200),
          type: c!.type,
        })),
        groups: groups.slice(0, DUPLICATE_MAX_GROUPS_RETURNED).map((g) => ({
          ...g,
          key: sanitizeRagContent(g.key, CELL_MAX_CHARS),
        })),
        truncated: groups.length > DUPLICATE_MAX_GROUPS_RETURNED,
      };
    }),
  });

  return { list_databases, describe_database, query_rows, find_duplicates };
}
