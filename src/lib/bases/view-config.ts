import { z } from "zod";

export const ROW_HEIGHTS = ["compact", "normal", "tall"] as const;
export type RowHeight = (typeof ROW_HEIGHTS)[number];

/** Totaux du kanban : colonne de montant, voies closes, poids (0 à 100) par voie. */
export const kanbanTotalsSchema = z.object({
  amountColumnId: z.string().min(1),
  closedLanes: z.array(z.string()).default([]),
  weights: z.record(z.string(), z.number().int().min(0).max(100)).default({}),
  currency: z.string().regex(/^[A-Z]{3}$/).optional(),
  showWeighted: z.boolean(),
});

export type KanbanTotalsConfig = z.infer<typeof kanbanTotalsSchema>;

/**
 * Schéma partagé de la config d'une vue. Seules les nouvelles clés sont
 * validées ; les clés historiques (sorts, filters, groupByColumnId,
 * dateColumnId, titleColumnId, widgets...) passent telles quelles.
 */
export const viewConfigSchema = z
  .object({
    visibleColumns: z.union([z.literal("*"), z.array(z.string())]).optional(),
    // null = ordre par défaut (valeur explicite, car le PATCH serveur fusionne en surface).
    columnOrder: z.array(z.string()).nullable().optional(),
    rowHeight: z.enum(ROW_HEIGHTS).optional(),
    // null = totaux désactivés (valeur explicite, car le PATCH serveur fusionne en surface).
    kanbanTotals: kanbanTotalsSchema.nullable().optional(),
  })
  .passthrough();

export type ViewConfig = z.infer<typeof viewConfigSchema>;

type ColumnLike = { id: string };

/**
 * Colonnes visibles, dans l'ordre d'affichage.
 * - La colonne primaire (titre) est la première de `columns` (tri par position)
 *   et reste toujours visible et en tête, quel que soit `columnOrder`.
 * - `columnOrder` est appliqué ; ids obsolètes ignorés ; colonnes absentes de
 *   l'ordre ajoutées à la fin dans leur ordre d'origine.
 */
export function resolveVisibleColumns<T extends ColumnLike>(
  columns: T[],
  config: ViewConfig | null | undefined,
): T[] {
  if (columns.length === 0) return [];
  const primary = columns[0];
  const byId = new Map(columns.map((c) => [c.id, c]));

  const ordered: T[] = [];
  const seen = new Set<string>();
  for (const id of config?.columnOrder ?? []) {
    const col = byId.get(id);
    if (col && !seen.has(id)) {
      ordered.push(col);
      seen.add(id);
    }
  }
  for (const col of columns) {
    if (!seen.has(col.id)) {
      ordered.push(col);
      seen.add(col.id);
    }
  }

  const visible = config?.visibleColumns;
  const filtered =
    visible === undefined || visible === "*"
      ? ordered
      : ordered.filter((c) => c.id === primary.id || visible.includes(c.id));

  // Primaire toujours présente et toujours en tête.
  return [primary, ...filtered.filter((c) => c.id !== primary.id)];
}

export function resolveRowHeight(config: ViewConfig | null | undefined): RowHeight {
  const parsed = z.enum(ROW_HEIGHTS).safeParse(config?.rowHeight);
  return parsed.success ? parsed.data : "normal";
}

// ─── Mutations pures de la config d'affichage (menu Colonnes) ────────────────

export type DisplayConfig = Pick<ViewConfig, "visibleColumns" | "columnOrder" | "rowHeight">;

/** Ids des colonnes dans l'ordre d'affichage complet (visibles ou non), titre en tête. */
export function orderedColumnIds<T extends ColumnLike>(columns: T[], config: ViewConfig | null | undefined): string[] {
  return resolveVisibleColumns(columns, { columnOrder: config?.columnOrder }).map((c) => c.id);
}

/** Ids des colonnes actuellement visibles. */
export function visibleColumnIds<T extends ColumnLike>(columns: T[], config: ViewConfig | null | undefined): string[] {
  return resolveVisibleColumns(columns, config).map((c) => c.id);
}

/** Bascule la visibilité d'une colonne. La colonne titre est inchangée. */
export function toggleColumnVisibility<T extends ColumnLike>(
  columns: T[],
  config: DisplayConfig,
  columnId: string,
): DisplayConfig {
  if (columns.length === 0 || columns[0].id === columnId) return config;
  const visible = new Set(visibleColumnIds(columns, config));
  if (visible.has(columnId)) visible.delete(columnId);
  else visible.add(columnId);
  const ids = columns.map((c) => c.id).filter((id) => visible.has(id));
  return { ...config, visibleColumns: ids.length === columns.length ? "*" : ids };
}

/** Affiche toutes les colonnes, ou masque toutes sauf le titre. */
export function setAllColumnsVisible<T extends ColumnLike>(
  columns: T[],
  config: DisplayConfig,
  visible: boolean,
): DisplayConfig {
  if (columns.length === 0) return config;
  return { ...config, visibleColumns: visible ? "*" : [columns[0].id] };
}

/** Déplace `columnId` juste avant `beforeId` (ou en fin si null). Le titre reste en tête. */
export function moveColumn<T extends ColumnLike>(
  columns: T[],
  config: DisplayConfig,
  columnId: string,
  beforeId: string | null,
): DisplayConfig {
  if (columns.length === 0 || columns[0].id === columnId || columnId === beforeId) return config;
  if (beforeId === columns[0].id) return config;
  const order = orderedColumnIds(columns, config).filter((id) => id !== columnId);
  const idx = beforeId === null ? order.length : order.indexOf(beforeId);
  order.splice(idx < 0 ? order.length : idx, 0, columnId);
  return { ...config, columnOrder: order };
}

/** Décale une colonne d'un cran (-1 haut, +1 bas). Renvoie null si impossible. */
export function shiftColumn<T extends ColumnLike>(
  columns: T[],
  config: DisplayConfig,
  columnId: string,
  delta: -1 | 1,
): DisplayConfig | null {
  const order = orderedColumnIds(columns, config);
  const i = order.indexOf(columnId);
  const j = i + delta;
  if (i < 1 || j < 1 || j >= order.length) return null;
  const next = [...order];
  next.splice(i, 1);
  next.splice(j, 0, columnId);
  return { ...config, columnOrder: next };
}

/** Extrait et valide les clés d'affichage d'une config de vue brute (toute vue). */
export function pickDisplayConfig(raw: unknown): DisplayConfig {
  const parsed = viewConfigSchema.safeParse(raw ?? {});
  if (!parsed.success) return {};
  const { visibleColumns, columnOrder, rowHeight } = parsed.data;
  const out: DisplayConfig = {};
  if (visibleColumns !== undefined) out.visibleColumns = visibleColumns;
  if (columnOrder !== undefined && columnOrder !== null) out.columnOrder = columnOrder;
  if (rowHeight !== undefined) out.rowHeight = rowHeight;
  return out;
}

/**
 * Les trois clés d'affichage, toujours explicites : le PATCH des vues fusionne
 * la config en surface, une clé absente garderait donc l'ancienne valeur côté
 * serveur (retour arrière « Annuler » non persisté).
 */
export function toDisplayPatch(display: DisplayConfig): {
  visibleColumns: "*" | string[];
  columnOrder: string[] | null;
  rowHeight: RowHeight;
} {
  return {
    visibleColumns: display.visibleColumns ?? "*",
    columnOrder: display.columnOrder ?? null,
    rowHeight: display.rowHeight ?? "normal",
  };
}
