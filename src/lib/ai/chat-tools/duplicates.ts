import { createHash } from "node:crypto";

export type Normalization = {
  caseInsensitive: boolean;
  trim: boolean;
  collapseSpaces: boolean;
};

export type DuplicateGroup = {
  /** Hash court déterministe de la clé normalisée, stable entre appels. */
  groupId: string;
  key: string;
  rowIds: string[];
  conflictColumnIds: string[];
};

export const DEFAULT_NORMALIZATION: Normalization = {
  caseInsensitive: true,
  trim: true,
  collapseSpaces: true,
};

/** Types dont la valeur n'est jamais écrite par une fusion (calculés) : jamais en conflit. */
export const MERGE_NOT_WRITTEN_TYPES: ReadonlySet<string> = new Set(["formula", "autonumber"]);
/** Types réunis sans conflit par la fusion (union de relations, pièces jointes cumulées). */
export const MERGE_UNITED_TYPES: ReadonlySet<string> = new Set(["relation", "attachment"]);

/**
 * Règle unique des colonnes pouvant produire un conflit de valeurs lors d'une fusion, partagée par
 * `find_duplicates` et le planificateur : colonne existante (type connu), non clé, ni calculée, ni auto-numérotée,
 * ni relation, ni pièces jointes.
 */
export function isMergeConflictColumn(type: string | undefined, columnId: string, keyColumnIds: readonly string[]): boolean {
  if (type === undefined) return false;
  if (MERGE_NOT_WRITTEN_TYPES.has(type) || MERGE_UNITED_TYPES.has(type)) return false;
  return !keyColumnIds.includes(columnId);
}

type DupRow = { id: string; cells: Record<string, unknown>; position: number };

const SEP = "\u0001";

function toText(value: unknown): string {
  if (value === null || value === undefined) return "";
  if (typeof value === "string") return value;
  if (typeof value === "number" || typeof value === "boolean") return String(value);
  if (Array.isArray(value)) return value.map(toText).join(",");
  return JSON.stringify(value) ?? "";
}

function normalize(value: unknown, norm: Normalization): string {
  let s = toText(value);
  // Une valeur faite uniquement d'espaces est vide, quelle que soit la normalisation.
  if (s.trim() === "") return "";
  if (norm.collapseSpaces) s = s.replace(/\s+/g, " ");
  if (norm.trim) s = s.trim();
  if (norm.caseInsensitive) s = s.toLowerCase();
  return s;
}

export function isEmptyValue(value: unknown): boolean {
  if (value === null || value === undefined) return true;
  if (typeof value === "string") return value.trim() === "";
  if (Array.isArray(value)) return value.length === 0;
  return false;
}

/**
 * Regroupe les lignes dont la clé (colonnes `keyColumnIds`) est égale après
 * normalisation. Une ligne dont toute la clé est vide n'entre dans aucun groupe.
 */
export function findDuplicateGroups(
  rows: DupRow[],
  keyColumnIds: string[],
  norm: Normalization = DEFAULT_NORMALIZATION,
  /** Types des colonnes de la base (id vers type). Fournis : seuls les conflits de la règle de fusion sont comptés. */
  types?: Record<string, string>,
): DuplicateGroup[] {
  const buckets = new Map<string, DupRow[]>();
  for (const r of [...rows].sort((a, b) => a.position - b.position)) {
    const parts = keyColumnIds.map((id) => normalize(r.cells[id], norm));
    if (parts.every((p) => p === "")) continue;
    const key = parts.join(SEP);
    const bucket = buckets.get(key);
    if (bucket) bucket.push(r);
    else buckets.set(key, [r]);
  }

  const keySet = new Set(keyColumnIds);
  const groups: DuplicateGroup[] = [];
  for (const [key, members] of buckets) {
    if (members.length < 2) continue;
    const otherCols = new Set<string>();
    for (const m of members) {
      for (const c of Object.keys(m.cells)) {
        if (keySet.has(c)) continue;
        if (types && !isMergeConflictColumn(types[c], c, keyColumnIds)) continue;
        otherCols.add(c);
      }
    }
    const conflictColumnIds: string[] = [];
    for (const col of otherCols) {
      const seen = new Set<string>();
      for (const m of members) {
        const v = m.cells[col];
        if (!isEmptyValue(v)) seen.add(JSON.stringify(v));
      }
      if (seen.size > 1) conflictColumnIds.push(col);
    }
    groups.push({
      groupId: createHash("sha256").update(key).digest("hex").slice(0, 12),
      key: key.split(SEP).join(" | "),
      rowIds: members.map((m) => m.id),
      conflictColumnIds,
    });
  }
  return groups;
}
