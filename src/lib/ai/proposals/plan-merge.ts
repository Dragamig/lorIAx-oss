import { findDuplicateGroups, isEmptyValue, isMergeConflictColumn, MERGE_NOT_WRITTEN_TYPES } from "@/lib/ai/chat-tools/duplicates";
import { loadRowsWithGuard, loadRowTimestamps, type LoadedRow } from "@/lib/ai/chat-tools/rows-loader";
import { MAX_ATTACHMENTS_PER_CELL } from "@/lib/media/cell-values";
import { computeFingerprint } from "./freshness";
import { RepointLimitError, scanUnidirectionalRepoints, type RepointScan } from "./merge-repoint";
import { assertRowCount, finishPlan, loadTypes, type ProposalPlan } from "./plan-shared";
import { ProposalPlanError } from "./types";
import type { Freshness, MergeConflict, MergeGroup, ProposalPayload } from "./types";

// Décisions : égalité d'updatedAt = position la plus basse conservée ; colonnes clés jamais en conflit ; relations réunies (pas de conflit).

function relIds(value: unknown): string[] {
  return Array.isArray(value) ? value.filter((v): v is string => typeof v === "string" && v !== "") : [];
}

function attachmentKey(item: unknown): string {
  if (item && typeof item === "object") {
    const o = item as Record<string, unknown>;
    if (typeof o.mediaId === "string" && o.mediaId) return `m:${o.mediaId}`;
    if (typeof o.key === "string" && o.key) return `k:${o.key}`;
  }
  return `j:${JSON.stringify(item)}`;
}

function fingerprintOf(a: { id: string; cells: Record<string, unknown> }[], b: { id: string; cells: Record<string, unknown> }[]) {
  const byId = new Map<string, { id: string; cells: Record<string, unknown> }>();
  for (const r of [...a, ...b]) byId.set(r.id, r);
  return computeFingerprint([...byId.values()]);
}

type Ranked = LoadedRow & { updatedAt: number };

async function rankRows(databaseId: string, rows: LoadedRow[]): Promise<Ranked[]> {
  const ts = await loadRowTimestamps(databaseId, rows.map((r) => r.id));
  // Plus récent d'abord ; à égalité, la position la plus basse (ordre stable de la base).
  return rows
    .map((r) => ({ ...r, updatedAt: ts.get(r.id) ?? 0 }))
    .sort((a, b) => b.updatedAt - a.updatedAt || a.position - b.position);
}

type Scan = { all: LoadedRow[]; groups: ReturnType<typeof findDuplicateGroups> };

async function scan(databaseId: string, keyColumnIds: string[], types: Record<string, string>): Promise<Scan> {
  const all = await loadRowsWithGuard(databaseId);
  if (all === null) {
    throw new ProposalPlanError("scan_limit", "Base trop volumineuse pour rechercher des doublons");
  }
  return { all, groups: findDuplicateGroups(all, keyColumnIds, undefined, types) };
}

async function repoints(databaseId: string, removedToKeep: Map<string, string>): Promise<RepointScan> {
  try {
    return await scanUnidirectionalRepoints(databaseId, removedToKeep);
  } catch (e) {
    if (e instanceof RepointLimitError) throw new ProposalPlanError("too_many_rows", e.message);
    throw e;
  }
}

function buildGroup(
  groupId: string,
  ranked: Ranked[],
  types: Record<string, string>,
  keyColumnIds: string[],
): MergeGroup {
  const [keep, ...others] = ranked;
  const columns = new Set<string>();
  for (const r of ranked) for (const c of Object.keys(r.cells)) columns.add(c);

  const mergedCells: Record<string, unknown> = {};
  const keepBefore: Record<string, unknown> = {};
  const conflicts: MergeConflict[] = [];
  let relationCells = 0;
  let attachments = 0;

  for (const col of columns) {
    const type = types[col];
    // Colonnes clés : égales après normalisation, la valeur de la conservée reste.
    if (type === undefined || MERGE_NOT_WRITTEN_TYPES.has(type) || keyColumnIds.includes(col)) continue;
    const keepValue = keep.cells[col];

    if (type === "relation") {
      // Union recalculée à l'apply (buildMergeWrites) : elle dépend des groupes retenus.
      for (const o of others) if (relIds(o.cells[col]).length > 0) relationCells++;
      continue;
    }

    if (type === "attachment") {
      const own = Array.isArray(keepValue) ? keepValue : [];
      const seen = new Set(own.map(attachmentKey));
      const merged = [...own];
      let added = 0;
      for (const o of others) {
        const list = Array.isArray(o.cells[col]) ? (o.cells[col] as unknown[]) : [];
        for (const item of list) {
          const k = attachmentKey(item);
          if (seen.has(k) || merged.length >= MAX_ATTACHMENTS_PER_CELL) continue;
          seen.add(k);
          merged.push(item);
          added++;
        }
      }
      if (added > 0) {
        attachments += added;
        mergedCells[col] = merged;
        keepBefore[col] = keepValue ?? null;
      }
      continue;
    }

    // Colonne scalaire (image comprise) : conservée si renseignée, sinon complétée dans l'ordre de récence.
    const present = ranked.filter((r) => !isEmptyValue(r.cells[col]));
    if (present.length === 0) continue;
    if (isEmptyValue(keepValue)) {
      mergedCells[col] = present[0].cells[col];
      keepBefore[col] = keepValue ?? null;
      if (type === "image") attachments++;
      continue;
    }
    const distinct = new Set(present.map((r) => JSON.stringify(r.cells[col])));
    if (distinct.size > 1 && isMergeConflictColumn(type, col, keyColumnIds)) {
      conflicts.push({
        columnId: col,
        chosenFrom: keep.id,
        candidates: present.map((r) => ({ rowId: r.id, value: r.cells[col] })),
      });
    }
  }

  return {
    groupId,
    keepRowId: keep.id,
    removeRowIds: others.map((o) => o.id),
    mergedCells,
    keepBefore,
    keepRow: { id: keep.id, cells: keep.cells, position: keep.position },
    removedRows: others.map((o) => ({ id: o.id, cells: o.cells, position: o.position })),
    conflicts,
    repatriation: { relationCells, attachments, repointed: [] },
  };
}

/**
 * Planifie la fusion de groupes de doublons. Les groupes sont toujours recalculés côté serveur ; `groupIds`
 * (facultatif) sélectionne parmi eux. Conservée = ligne la plus récente (updatedAt, puis position la plus basse).
 */
export async function planMergeDuplicates(
  databaseId: string,
  keyColumnIds: string[],
  groupIds?: string[],
): Promise<ProposalPlan> {
  if (keyColumnIds.length === 0) throw new ProposalPlanError("empty", "Aucune colonne clé fournie");
  const types = await loadTypes(databaseId);
  for (const c of keyColumnIds) {
    if (types[c] === undefined) throw new ProposalPlanError("unknown_column", `Colonne inconnue : ${c}`);
  }
  const { all, groups } = await scan(databaseId, keyColumnIds, types);
  const byGroup = new Map(groups.map((g) => [g.groupId, g]));
  let selected = groups;
  if (groupIds !== undefined) {
    const wanted = [...new Set(groupIds)];
    if (wanted.some((id) => !byGroup.has(id))) {
      throw new ProposalPlanError("unknown_row", "Un ou plusieurs groupes de doublons sont introuvables : relancer la recherche");
    }
    selected = wanted.map((id) => byGroup.get(id)!);
  }
  if (selected.length === 0) throw new ProposalPlanError("empty", "Aucun groupe de doublons à fusionner");

  const touched = selected.reduce((s, g) => s + g.rowIds.length, 0);
  assertRowCount(touched);

  const rowsById = new Map(all.map((r) => [r.id, r]));
  const rankedByGroup = new Map<string, Ranked[]>();
  const removedToKeep = new Map<string, string>();
  for (const g of selected) {
    const ranked = await rankRows(databaseId, g.rowIds.map((id) => rowsById.get(id)!));
    rankedByGroup.set(g.groupId, ranked);
    for (const r of ranked.slice(1)) removedToKeep.set(r.id, ranked[0].id);
  }

  const mergeGroups = selected.map((g) => buildGroup(g.groupId, rankedByGroup.get(g.groupId)!, types, keyColumnIds));
  const groupRowIds = new Set(selected.flatMap((g) => g.rowIds));
  const rep = await repoints(databaseId, removedToKeep);
  for (const mg of mergeGroups) {
    const mine = new Set(mg.removeRowIds);
    mg.repatriation.repointed = rep.repoints.filter((p) => p.before.some((id) => mine.has(id)));
  }

  const relationColumnIds = Object.keys(types).filter((c) => types[c] === "relation");
  const payload: ProposalPayload = { type: "merge_duplicates", keyColumnIds, relationColumnIds, groups: mergeGroups };
  const members = [...groupRowIds].map((id) => rowsById.get(id)!);
  const freshness: Freshness = {
    rows: fingerprintOf(members, rep.holderRows),
    databaseRowCountForKey: members.length,
  };
  return finishPlan(payload, freshness);
}

/**
 * Empreinte actuelle d'une fusion déjà planifiée, à comparer à `freshness` stockée (apply).
 * Mêmes lignes de groupes, mêmes lignes repointées, même compte de lignes partageant la clé.
 * Un groupe devenu introuvable donne une empreinte incomparable (proposition périmée).
 */
export async function computeMergeFreshness(
  databaseId: string,
  payload: Extract<ProposalPayload, { type: "merge_duplicates" }>,
): Promise<Freshness> {
  const { all, groups } = await scan(databaseId, payload.keyColumnIds, await loadTypes(databaseId));
  const byGroup = new Map(groups.map((g) => [g.groupId, g]));
  const rowsById = new Map(all.map((r) => [r.id, r]));
  const memberIds = new Set<string>();
  let count = 0;
  for (const pg of payload.groups) {
    const g = byGroup.get(pg.groupId);
    if (!g) return { rows: [], databaseRowCountForKey: -1 };
    count += g.rowIds.length;
    for (const id of [pg.keepRowId, ...pg.removeRowIds]) memberIds.add(id);
  }
  const members = [...memberIds].map((id) => rowsById.get(id)).filter((r): r is LoadedRow => !!r);
  const removedToKeep = new Map<string, string>();
  for (const pg of payload.groups) for (const id of pg.removeRowIds) removedToKeep.set(id, pg.keepRowId);
  const rep = await repoints(databaseId, removedToKeep);
  return { rows: fingerprintOf(members, rep.holderRows), databaseRowCountForKey: count };
}

/**
 * Cellules à écrire sur la ligne conservée : `mergedCells`, plus, pour chaque conflit, la valeur de la ligne
 * choisie par `overrides[columnId]` (un rowId), seulement s'il figure parmi les candidats. Pure.
 */
export function resolveMergeChoices(group: MergeGroup, overrides?: Record<string, string>): Record<string, unknown> {
  const out: Record<string, unknown> = { ...group.mergedCells };
  for (const c of group.conflicts) {
    const chosen = overrides?.[c.columnId] ?? c.chosenFrom;
    const cand = c.candidates.find((k) => k.rowId === chosen);
    if (!cand || chosen === group.keepRowId) continue;
    out[c.columnId] = cand.value;
  }
  return out;
}

export type MergeWrites = {
  keeps: { rowId: string; before: Record<string, unknown>; after: Record<string, unknown> }[];
  removeRowIds: string[];
  repoints: { rowId: string; databaseId: string; columnId: string; before: string[]; after: string[] }[];
};

type MergePayload = Extract<ProposalPayload, { type: "merge_duplicates" }>;

/**
 * Écritures d'un apply, dérivées des SEULS groupes non exclus (pure) : cellules finales des conservées
 * (choix de conflits compris), relations réunies, lignes à retirer et relations unidirectionnelles à repointer.
 * Un groupe exclu garde ses lignes et toute relation qui les vise. `overrides[groupId][columnId]` = rowId retenu.
 * Les `after` stockés dans le payload ne sont jamais à appliquer tels quels : seul cet appel fait foi.
 */
export function buildMergeWrites(
  payload: MergePayload,
  overrides?: Record<string, Record<string, string>>,
): MergeWrites {
  const included = payload.groups.filter((g) => !g.excluded);
  const removedToKeep = new Map<string, string>();
  const includedRowIds = new Set<string>();
  for (const g of included) {
    includedRowIds.add(g.keepRowId);
    for (const id of g.removeRowIds) {
      removedToKeep.set(id, g.keepRowId);
      includedRowIds.add(id);
    }
  }
  const mapIds = (ids: string[]): string[] => {
    const out: string[] = [];
    for (const id of ids) {
      const m = removedToKeep.get(id) ?? id;
      if (!out.includes(m)) out.push(m);
    }
    return out;
  };

  const keeps = included.map((g) => {
    const after = resolveMergeChoices(g, overrides?.[g.groupId]);
    for (const col of payload.relationColumnIds) {
      const union = mapIds([g.keepRow, ...g.removedRows].flatMap((r) => relIds(r.cells[col])));
      if (JSON.stringify(union) !== JSON.stringify(relIds(g.keepRow.cells[col]))) after[col] = union;
    }
    const before: Record<string, unknown> = {};
    for (const col of Object.keys(after)) before[col] = g.keepRow.cells[col] ?? null;
    return { rowId: g.keepRowId, before, after };
  });

  const seen = new Set<string>();
  const repoints: MergeWrites["repoints"] = [];
  for (const g of payload.groups) {
    for (const r of g.repatriation.repointed) {
      const key = `${r.rowId}:${r.columnId}`;
      if (seen.has(key)) continue;
      seen.add(key);
      if (includedRowIds.has(r.rowId)) continue; // retirée, ou conservée dont la relation est réunie ci-dessus
      const after = mapIds(r.before);
      if (JSON.stringify(after) !== JSON.stringify(r.before)) repoints.push({ ...r, after });
    }
  }
  return { keeps, removeRowIds: [...removedToKeep.keys()], repoints };
}
