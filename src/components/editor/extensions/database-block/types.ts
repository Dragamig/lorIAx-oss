// ─── Types ───────────────────────────────────────────────────────────────────

import type { ColumnMapping } from "@/lib/integrations/base";

export type ColumnType = "text" | "number" | "date" | "select" | "checkbox" | "relation" | "image" | "formula" | "url" | "email" | "attachment" | "time" | "autonumber" | "person" | "document_link";

// ARCH-03 — Types stricts pour les configurations de colonnes
export interface ColumnConfig {
  options?: string[];
  targetDatabaseId?: string;
  /** Colonne jumelle dans la base cible (posée par le serveur uniquement). */
  inverseColumnId?: string;
  unit?: string;
  formula?: string;
  multiple?: boolean;
  width?: number;
  /** Retour à la ligne du contenu de la cellule (désactivé par défaut). */
  wrap?: boolean;
  // Autonumber
  startNumber?: number;
  padding?: number;
  prefix?: string;
  suffix?: string;
  [key: string]: unknown;
}

// ARCH-03 — Types stricts pour les cellules
export type CellValue = string | number | boolean | string[] | null;

export interface DbColumn {
  id: string;
  databaseId: string;
  name: string;
  type: ColumnType;
  position: number;
  config: ColumnConfig;
  createdAt: string;
}

export interface DbRow {
  id: string;
  databaseId: string;
  cells: Record<string, CellValue>;
  position: number;
  createdAt: string;
  updatedAt: string;
}

export interface DbData {
  id: string;
  spaceId: string;
  name: string;
  description: string | null;
  columns: DbColumn[];
  rows: DbRow[];
}

export interface DbListItem {
  id: string;
  name: string;
  spaceId: string;
}

export type ViewMode = "table" | "kanban" | "gallery";

export interface SortConfig {
  columnId: string;
  direction: "asc" | "desc";
}

export type FilterOperator =
  // text / url / email / formula
  | "contains" | "not_contains" | "is" | "is_not" | "is_empty" | "is_not_empty"
  // number / autonumber
  | "eq" | "neq" | "lt" | "gt" | "lte" | "gte"
  // checkbox
  | "is_checked" | "is_not_checked"
  // date / time
  | "is_before" | "is_after" | "is_on_or_before" | "is_on_or_after"
  | "is_today" | "is_this_week" | "is_this_month" | "is_this_year"
  | "is_within_days" | "is_this_quarter"
  // person
  | "is_me";

export interface FilterConfig {
  columnId: string;
  operator: FilterOperator;
  value: string;
}

// ─── Arbre de filtres récursif (style Airtable) ─────────────────────────────────
// Un groupe contient des conditions et/ou des sous-groupes, joints par "and"/"or".

export type FilterConjunction = "and" | "or";

export interface FilterCondition {
  id: string;
  columnId: string;
  operator: FilterOperator;
  value: string;
}

export interface FilterGroup {
  id: string;
  type: "group";
  conjunction: FilterConjunction;
  children: FilterNode[];
}

export type FilterNode = FilterCondition | FilterGroup;

export interface SyncMapping {
  id: string;
  provider: string;
  externalId: string;
  syncMode: string;
  syncIntervalMin: number | null;
  isSyncing: boolean;
  syncError: string | null;
  lastSyncAt: string | null;
  lastSyncDirection: string | null;
  columnMapping: ColumnMapping[];
  logs: { id: string; direction: string; status: string; rowsCreated: number; rowsUpdated: number; rowsDeleted: number; startedAt: string }[];
}
