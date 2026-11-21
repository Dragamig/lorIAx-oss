/**
 * Opérations de lignes en lot (suppression, restauration, duplication,
 * réordonnancement) d'une base utilisateur.
 *
 * Comme `row-writes.ts`, ces helpers n'émettent AUCUN déclencheur
 * d'automatisation : le dispatch reste à la charge de l'appelant HTTP.
 * Ordre de verrous commun : verrou advisory de la base, puis relpair, puis lignes.
 */
import { randomUUID } from "crypto";
import { and, asc, desc, eq, inArray, sql } from "drizzle-orm";
import { db } from "@/lib/db";
import {
  externalDatabaseMappings,
  externalRowTracking,
  userDatabaseColumns,
  userDatabaseRows,
} from "@/lib/db/schema";
import { databaseRowChanges } from "@/lib/db/schema-row-activity";
import { lockRelationPairs, syncRelationInverses } from "./relation-sync";
import { enforceMediaGuard, type DbExecutor } from "./row-writes";
import { setRowChangeContext, type RowChangeContext } from "./row-change-context";

/** Suivi de synchro externe d'une ligne (colonnes nécessaires à la réinsertion). */
export type TrackingSnapshot = {
  mappingId: string;
  externalRowId: string;
  contentHash: string | null;
  lastExternalChangeAt: string | null;
};
export type RowSnapshot = {
  id: string;
  cells: Record<string, unknown>;
  position: number;
  tracking?: TrackingSnapshot[];
};
export type RestoreResult = { rows: RowPosition[]; alreadyRestored: boolean };
export type RestoreOptions = {
  /** Accès de l'utilisateur à une base cible de relation. Absent : aucune cible n'est conservée. */
  canAccessRelationTarget?: (targetDatabaseId: string) => Promise<boolean>;
};
export type RowPosition = { id: string; position: number };
export type DuplicatedRow = RowSnapshot & { sourceId: string };

export type RowBatchErrorCode = "not_found" | "conflict" | "invalid";

export class RowBatchError extends Error {
  constructor(
    public readonly code: RowBatchErrorCode,
    message: string
  ) {
    super(message);
    this.name = "RowBatchError";
  }
}

/** Types de colonnes dont la valeur n'est pas recopiée à la duplication. */
const NON_COPIED_TYPES = new Set(["autonumber", "formula"]);
const POSITION_CHUNK = 5000;

const asCells = (v: unknown): Record<string, unknown> => (v as Record<string, unknown> | null) ?? {};

/** Ordre commun à toutes les opérations : verrou de base, couples de relations, puis lignes. */
async function lockDatabase(tx: DbExecutor, databaseId: string): Promise<void> {
  await tx.execute(sql`SELECT pg_advisory_xact_lock(hashtextextended(${databaseId}, 0))`);
  await lockRelationPairs(tx, databaseId);
}

/** Toutes les lignes de la base, dans l'ordre d'affichage. */
async function loadOrdered(tx: DbExecutor, databaseId: string) {
  return tx
    .select({ id: userDatabaseRows.id, cells: userDatabaseRows.cells, position: userDatabaseRows.position })
    .from(userDatabaseRows)
    .where(eq(userDatabaseRows.databaseId, databaseId))
    .orderBy(asc(userDatabaseRows.position), asc(userDatabaseRows.createdAt));
}

/** Écrit des positions en masse (une requête par paquet). */
async function applyPositions(tx: DbExecutor, databaseId: string, entries: RowPosition[]): Promise<void> {
  // Tri par id : ordre de verrou de lignes stable entre transactions concurrentes.
  const sorted = [...entries].sort((a, b) => (a.id < b.id ? -1 : a.id > b.id ? 1 : 0));
  for (let i = 0; i < sorted.length; i += POSITION_CHUNK) {
    const chunk = sorted.slice(i, i + POSITION_CHUNK);
    const values = sql.join(
      chunk.map((e) => sql`(${e.id}::uuid, ${e.position}::int)`),
      sql`, `
    );
    await tx.execute(sql`
      UPDATE user_database_rows AS r SET position = v.pos
      FROM (VALUES ${values}) AS v(id, pos)
      WHERE r.id = v.id AND r.database_id = ${databaseId}
    `);
  }
}

/**
 * Supprime des lignes (toutes doivent appartenir à la base) en une transaction
 * et nettoie les inverses de relations. Renvoie l'état AVANT suppression.
 * Lève `not_found` si une ligne n'appartient pas à la base (rien n'est supprimé).
 */
export async function deleteDatabaseRows(
  databaseId: string,
  rowIds: string[],
  executor: DbExecutor = db,
  ctx?: RowChangeContext
): Promise<RowSnapshot[]> {
  const ids = [...new Set(rowIds)];
  return executor.transaction(async (tx) => {
    if (ctx) await setRowChangeContext(tx, ctx);
    await lockDatabase(tx, databaseId);
    const found = await tx
      .select({ id: userDatabaseRows.id, cells: userDatabaseRows.cells, position: userDatabaseRows.position })
      .from(userDatabaseRows)
      .where(and(eq(userDatabaseRows.databaseId, databaseId), inArray(userDatabaseRows.id, ids)))
      .orderBy(asc(userDatabaseRows.id))
      .for("update");
    if (found.length !== ids.length) throw new RowBatchError("not_found", "Introuvable");
    for (const r of found) {
      const before = asCells(r.cells);
      const after = Object.fromEntries(Object.keys(before).map((k) => [k, []]));
      await syncRelationInverses(tx, { databaseId, rowId: r.id, before, after, ctx });
    }
    const trackingRows = await tx
      .select({
        loriaxRowId: externalRowTracking.loriaxRowId,
        mappingId: externalRowTracking.mappingId,
        externalRowId: externalRowTracking.externalRowId,
        contentHash: externalRowTracking.contentHash,
        lastExternalChangeAt: externalRowTracking.lastExternalChangeAt,
      })
      .from(externalRowTracking)
      .where(inArray(externalRowTracking.loriaxRowId, ids));
    const trackingByRow = new Map<string, TrackingSnapshot[]>();
    for (const t of trackingRows) {
      const list = trackingByRow.get(t.loriaxRowId) ?? [];
      list.push({
        mappingId: t.mappingId,
        externalRowId: t.externalRowId,
        contentHash: t.contentHash,
        lastExternalChangeAt: t.lastExternalChangeAt ? t.lastExternalChangeAt.toISOString() : null,
      });
      trackingByRow.set(t.loriaxRowId, list);
    }
    await tx
      .delete(userDatabaseRows)
      .where(and(eq(userDatabaseRows.databaseId, databaseId), inArray(userDatabaseRows.id, ids)));
    const byId = new Map(found.map((r) => [r.id, r]));
    return ids.map((id) => {
      const r = byId.get(id)!;
      return {
        id: r.id,
        cells: asCells(r.cells),
        position: r.position,
        tracking: trackingByRow.get(id) ?? [],
      };
    });
  });
}

/** Dernières cellules connues de lignes supprimées (entrée « deleted » de l'historique). */
async function loadDeletedRowCells(
  databaseId: string,
  rowIds: string[]
): Promise<Map<string, Record<string, unknown>>> {
  const found = await db
    .select({ rowId: databaseRowChanges.rowId, changes: databaseRowChanges.changes })
    .from(databaseRowChanges)
    .where(
      and(
        eq(databaseRowChanges.databaseId, databaseId),
        eq(databaseRowChanges.kind, "deleted"),
        inArray(databaseRowChanges.rowId, rowIds)
      )
    )
    .orderBy(desc(databaseRowChanges.createdAt));
  const out = new Map<string, Record<string, unknown>>();
  for (const f of found) {
    if (out.has(f.rowId)) continue;
    const cells: Record<string, unknown> = {};
    for (const c of f.changes) cells[c.columnId] = c.before;
    out.set(f.rowId, cells);
  }
  return out;
}

const RESTORE_REFUSED = "Restauration impossible";

/**
 * Réinsère des lignes avec leur id et leur position d'origine. Si une position
 * est déjà occupée, les lignes à partir de cette position sont décalées de 1.
 * Reconstitue les inverses de relations et le suivi de synchro externe.
 *
 * Nettoyage : seules les cellules de colonnes existantes sont rétablies, les
 * formules sont écartées, un autonumber déjà pris reçoit max+1, et les cibles
 * de relation hors base cible ou inaccessibles sont écartées en silence.
 * Si toutes les lignes existent déjà dans CETTE base à la même position
 * (double annulation), renvoie `alreadyRestored: true`. Toute autre collision
 * d'id (n'importe quelle base) lève `invalid` générique, sans révéler l'existence.
 */
export async function restoreDatabaseRows(
  databaseId: string,
  rows: RowSnapshot[],
  executor: DbExecutor = db,
  options: RestoreOptions = {},
  ctx?: RowChangeContext
): Promise<RestoreResult> {
  const ids = rows.map((r) => r.id);
  if (new Set(ids).size !== ids.length) throw new RowBatchError("invalid", RESTORE_REFUSED);
  // Un instantané forgé ne doit pas rattacher un média illisible à la ligne.
  // Valeur de référence : cellules de la ligne au moment de sa suppression (historique).
  const deletedCells = ctx?.mediaGuard ? await loadDeletedRowCells(databaseId, ids) : new Map();
  for (const r of rows) await enforceMediaGuard(databaseId, r.cells, ctx, deletedCells.get(r.id));
  return executor.transaction(async (tx) => {
    if (ctx) await setRowChangeContext(tx, ctx);
    await lockDatabase(tx, databaseId);
    const existing = await tx
      .select({
        id: userDatabaseRows.id,
        databaseId: userDatabaseRows.databaseId,
        position: userDatabaseRows.position,
      })
      .from(userDatabaseRows)
      .where(inArray(userDatabaseRows.id, ids));
    if (existing.length > 0) {
      const wantedPos = new Map(rows.map((r) => [r.id, r.position]));
      const same =
        existing.length === rows.length &&
        existing.every((e) => e.databaseId === databaseId && wantedPos.get(e.id) === e.position);
      if (!same) throw new RowBatchError("invalid", RESTORE_REFUSED);
      return {
        rows: [...rows].sort((a, b) => a.position - b.position).map((r) => ({ id: r.id, position: r.position })),
        alreadyRestored: true,
      };
    }

    const columns = await tx
      .select({ id: userDatabaseColumns.id, type: userDatabaseColumns.type, config: userDatabaseColumns.config })
      .from(userDatabaseColumns)
      .where(eq(userDatabaseColumns.databaseId, databaseId));
    const colById = new Map(columns.map((c) => [c.id, c]));

    // Clés connues uniquement, formules écartées.
    const cleaned = new Map<string, Record<string, unknown>>();
    for (const r of rows) {
      const cells: Record<string, unknown> = {};
      for (const [k, v] of Object.entries(r.cells)) {
        const col = colById.get(k);
        if (!col || col.type === "formula") continue;
        cells[k] = v;
      }
      cleaned.set(r.id, cells);
    }

    // Relations : cibles de la bonne base et accessibles.
    const relCols = columns.filter((c) => c.type === "relation");
    const restoredIds = new Set(ids);
    for (const col of relCols) {
      const target = (col.config as Record<string, unknown> | null)?.targetDatabaseId;
      const candidates = new Set<string>();
      for (const cells of cleaned.values()) {
        const v = cells[col.id];
        if (Array.isArray(v)) for (const x of v) if (typeof x === "string") candidates.add(x);
      }
      let valid = new Set<string>();
      if (
        typeof target === "string" &&
        candidates.size > 0 &&
        options.canAccessRelationTarget &&
        (await options.canAccessRelationTarget(target))
      ) {
        const found = await tx
          .select({ id: userDatabaseRows.id })
          .from(userDatabaseRows)
          .where(and(eq(userDatabaseRows.databaseId, target), inArray(userDatabaseRows.id, [...candidates])));
        valid = new Set(found.map((f) => f.id));
        if (target === databaseId) for (const id of restoredIds) valid.add(id);
      }
      for (const cells of cleaned.values()) {
        if (!(col.id in cells)) continue;
        const v = cells[col.id];
        cells[col.id] = Array.isArray(v) ? v.filter((x) => typeof x === "string" && valid.has(x)) : [];
      }
    }

    // Autonumber : réattribuer max+1 si la valeur est déjà prise.
    for (const col of columns.filter((c) => c.type === "autonumber")) {
      const res = await tx.execute(sql`
        SELECT cells ->> ${col.id}::text AS v FROM user_database_rows
        WHERE database_id = ${databaseId}::uuid AND cells ? ${col.id}::text
      `);
      const list = (Array.isArray(res) ? res : (res as { rows: unknown[] }).rows) as { v: string | null }[];
      const used = new Set<number>();
      let max = 0;
      for (const x of list) {
        const n = x.v == null ? NaN : Number(x.v);
        if (Number.isFinite(n)) {
          used.add(n);
          max = Math.max(max, n);
        }
      }
      for (const r of [...rows].sort((a, b) => a.position - b.position)) {
        const cells = cleaned.get(r.id)!;
        const v = cells[col.id];
        if (typeof v !== "number" || !Number.isFinite(v)) continue;
        if (used.has(v)) {
          max += 1;
          while (used.has(max)) max += 1;
          cells[col.id] = max;
          used.add(max);
        } else {
          used.add(v);
          max = Math.max(max, v);
        }
      }
    }

    // Suivi externe : uniquement des mappings de cette base.
    const mappingIds = [...new Set(rows.flatMap((r) => (r.tracking ?? []).map((t) => t.mappingId)))];
    const okMappings = new Set<string>();
    if (mappingIds.length > 0) {
      const found = await tx
        .select({ id: externalDatabaseMappings.id })
        .from(externalDatabaseMappings)
        .where(
          and(
            inArray(externalDatabaseMappings.id, mappingIds),
            eq(externalDatabaseMappings.userDatabaseId, databaseId)
          )
        );
      for (const f of found) okMappings.add(f.id);
    }

    const result: RowPosition[] = [];
    for (const r of [...rows].sort((a, b) => a.position - b.position)) {
      const [occupied] = await tx
        .select({ id: userDatabaseRows.id })
        .from(userDatabaseRows)
        .where(and(eq(userDatabaseRows.databaseId, databaseId), eq(userDatabaseRows.position, r.position)))
        .limit(1);
      if (occupied) {
        await tx.execute(sql`
          UPDATE user_database_rows SET position = position + 1
          WHERE database_id = ${databaseId} AND position >= ${r.position}
        `);
      }
      const cells = cleaned.get(r.id)!;
      await tx.insert(userDatabaseRows).values({ id: r.id, databaseId, cells, position: r.position });
      await syncRelationInverses(tx, { databaseId, rowId: r.id, before: {}, after: cells, ctx });
      const tracking = (r.tracking ?? []).filter((t) => okMappings.has(t.mappingId));
      if (tracking.length > 0) {
        await tx
          .insert(externalRowTracking)
          .values(
            tracking.map((t) => ({
              mappingId: t.mappingId,
              loriaxRowId: r.id,
              externalRowId: t.externalRowId,
              contentHash: t.contentHash,
              lastExternalChangeAt: t.lastExternalChangeAt ? new Date(t.lastExternalChangeAt) : null,
            }))
          )
          .onConflictDoNothing();
      }
      result.push({ id: r.id, position: r.position });
    }
    return { rows: result, alreadyRestored: false };
  });
}

/**
 * Duplique des lignes : chaque copie est insérée juste après son original.
 * Les colonnes autonumber reçoivent un nouveau numéro, les colonnes formula ne
 * sont pas recopiées. Lève `not_found` si une ligne n'appartient pas à la base.
 */
export async function duplicateDatabaseRows(
  databaseId: string,
  rowIds: string[],
  executor: DbExecutor = db,
  ctx?: RowChangeContext
): Promise<DuplicatedRow[]> {
  const wanted = new Set(rowIds);
  return executor.transaction(async (tx) => {
    if (ctx) await setRowChangeContext(tx, ctx);
    await lockDatabase(tx, databaseId);
    const all = await loadOrdered(tx, databaseId);
    const present = new Set(all.map((r) => r.id));
    for (const id of wanted) if (!present.has(id)) throw new RowBatchError("not_found", "Introuvable");

    const columns = await tx
      .select({ id: userDatabaseColumns.id, type: userDatabaseColumns.type, config: userDatabaseColumns.config })
      .from(userDatabaseColumns)
      .where(eq(userDatabaseColumns.databaseId, databaseId));
    const skipped = columns.filter((c) => NON_COPIED_TYPES.has(c.type)).map((c) => c.id);
    const autoCols = columns.filter((c) => c.type === "autonumber");

    const nextNumber = new Map<string, number>();
    for (const col of autoCols) {
      const cfg = (col.config as Record<string, unknown> | null) ?? {};
      const start = typeof cfg.startNumber === "number" ? cfg.startNumber : 1;
      let max: number | null = null;
      for (const r of all) {
        const v = asCells(r.cells)[col.id];
        if (typeof v === "number" && Number.isFinite(v)) max = max == null ? v : Math.max(max, v);
      }
      nextNumber.set(col.id, max != null ? max + 1 : start);
    }

    const copies: DuplicatedRow[] = [];
    const order: RowPosition[] = [];
    let pos = 0;
    for (const r of all) {
      order.push({ id: r.id, position: pos++ });
      if (!wanted.has(r.id)) continue;
      const cells = { ...asCells(r.cells) };
      for (const c of skipped) delete cells[c];
      for (const col of autoCols) {
        const n = nextNumber.get(col.id)!;
        cells[col.id] = n;
        nextNumber.set(col.id, n + 1);
      }
      copies.push({ id: randomUUID(), cells, position: pos++, sourceId: r.id });
    }

    const changed = order.filter((o, i) => all[i].position !== o.position || all[i].id !== o.id);
    // Les positions réelles des originaux sont celles de `order` (renumérotation dense).
    const newPos = new Map(order.map((o) => [o.id, o.position]));
    await applyPositions(
      tx,
      databaseId,
      changed.map((o) => ({ id: o.id, position: newPos.get(o.id)! }))
    );

    if (copies.length > 0) {
      await tx.insert(userDatabaseRows).values(
        copies.map((c) => ({ id: c.id, databaseId, cells: c.cells, position: c.position }))
      );
      for (const c of copies) {
        await syncRelationInverses(tx, { databaseId, rowId: c.id, before: {}, after: c.cells, ctx });
      }
    }
    return copies;
  });
}

/**
 * Déplace `rowIds` (dans l'ordre donné) juste avant `beforeRowId` (null = fin)
 * et renumérote les positions de la base de 0 à n-1.
 */
export async function reorderDatabaseRows(
  databaseId: string,
  rowIds: string[],
  beforeRowId: string | null,
  executor: DbExecutor = db
): Promise<RowPosition[]> {
  if (new Set(rowIds).size !== rowIds.length) throw new RowBatchError("invalid", "Identifiants en double");
  if (beforeRowId !== null && rowIds.includes(beforeRowId)) {
    throw new RowBatchError("invalid", "beforeRowId ne peut pas faire partie des lignes déplacées");
  }
  return executor.transaction(async (tx) => {
    await lockDatabase(tx, databaseId);
    const all = await loadOrdered(tx, databaseId);
    const present = new Set(all.map((r) => r.id));
    for (const id of rowIds) if (!present.has(id)) throw new RowBatchError("not_found", "Introuvable");
    if (beforeRowId !== null && !present.has(beforeRowId)) throw new RowBatchError("not_found", "Introuvable");

    const moved = new Set(rowIds);
    const rest = all.filter((r) => !moved.has(r.id)).map((r) => r.id);
    const at = beforeRowId === null ? rest.length : rest.indexOf(beforeRowId);
    const finalOrder = [...rest.slice(0, at), ...rowIds, ...rest.slice(at)];
    const result = finalOrder.map((id, position) => ({ id, position }));

    const current = new Map(all.map((r) => [r.id, r.position]));
    await applyPositions(
      tx,
      databaseId,
      result.filter((r) => current.get(r.id) !== r.position)
    );
    return result;
  });
}
