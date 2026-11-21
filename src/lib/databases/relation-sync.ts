/**
 * Synchronisation de l'inverse des relations jumelées entre bases.
 *
 * Une colonne relation jumelée porte `config.inverseColumnId` (colonne jumelle
 * dans la base cible). Toute écriture de ses cellules est répercutée, dans la
 * MÊME transaction, sur les lignes partenaires. L'écriture inverse est purement
 * SQL : aucun déclencheur d'automatisme, aucun rappel récursif.
 */
import { and, eq, sql } from "drizzle-orm";
import { userDatabaseColumns } from "@/lib/db/schema";
import type { DbExecutor } from "./row-writes";
import { setRowChangeContext, type RowChangeContext } from "./row-change-context";

export interface PairedRelationColumn {
  columnId: string;
  targetDatabaseId: string;
  inverseColumnId: string;
}

const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

function toIds(value: unknown): string[] {
  if (!Array.isArray(value)) return [];
  const out: string[] = [];
  const seen = new Set<string>();
  for (const v of value) {
    if (typeof v !== "string" || v === "" || seen.has(v)) continue;
    seen.add(v);
    out.push(v);
  }
  return out;
}

/** Différence entre deux valeurs de cellule relation (tolère toute valeur). */
export function diffRelationIds(
  before: unknown,
  after: unknown
): { added: string[]; removed: string[] } {
  const b = toIds(before);
  const a = toIds(after);
  const bs = new Set(b);
  const as = new Set(a);
  return {
    added: a.filter((id) => !bs.has(id)),
    removed: b.filter((id) => !as.has(id)),
  };
}

/** Colonnes relation jumelées (cible et jumelle connues) parmi des colonnes. */
export function pairedRelationColumns(
  columns: ReadonlyArray<{ id: string; type: string; config: unknown }>
): PairedRelationColumn[] {
  const out: PairedRelationColumn[] = [];
  for (const c of columns) {
    if (c.type !== "relation") continue;
    const cfg = c.config as Record<string, unknown> | null;
    const target = cfg?.targetDatabaseId;
    const inverse = cfg?.inverseColumnId;
    if (typeof target === "string" && target && typeof inverse === "string" && inverse) {
      out.push({ columnId: c.id, targetDatabaseId: target, inverseColumnId: inverse });
    }
  }
  return out;
}

/**
 * Config d'une colonne clonée (duplication de base) : une relation copiée n'est
 * pas jumelée, `inverseColumnId` pointerait vers la colonne inverse d'origine.
 */
export function cloneColumnConfig(type: string, config: unknown): Record<string, unknown> {
  const cfg = { ...((config as Record<string, unknown> | null) ?? {}) };
  if (type === "relation") delete cfg.inverseColumnId;
  return cfg;
}

/**
 * Contrôle de réciprocité côté serveur : la config d'une colonne relation est
 * posée librement par le client, on ne lui fait donc pas confiance. Une paire
 * n'est retenue que si la colonne inverse existe dans la base cible, est de
 * type relation, pointe en retour vers (databaseId, columnId), et si les deux
 * bases sont dans la même organisation. Sinon elle est ignorée (avertissement).
 */
export async function validatedPairedColumns(
  tx: DbExecutor,
  databaseId: string,
  candidates: PairedRelationColumn[]
): Promise<PairedRelationColumn[]> {
  const out: PairedRelationColumn[] = [];
  for (const pc of candidates) {
    if (!UUID_RE.test(pc.targetDatabaseId) || !UUID_RE.test(pc.inverseColumnId)) {
      console.warn(`[relation-sync] paire ignorée (identifiants invalides) colonne ${pc.columnId}`);
      continue;
    }
    const res = await tx.execute(sql`
      SELECT 1 AS ok
      FROM user_database_columns ic
      JOIN user_databases tdb ON tdb.id = ic.database_id
      JOIN spaces ts ON ts.id = tdb.space_id
      JOIN user_databases sdb ON sdb.id = ${databaseId}::uuid
      JOIN spaces ss ON ss.id = sdb.space_id
      WHERE ic.id = ${pc.inverseColumnId}::uuid
        AND ic.database_id = ${pc.targetDatabaseId}::uuid
        AND ic.type = 'relation'
        AND ic.config ->> 'targetDatabaseId' = ${databaseId}::text
        AND ic.config ->> 'inverseColumnId' = ${pc.columnId}::text
        AND ts.organization_id = ss.organization_id
      LIMIT 1
    `);
    const rows = (Array.isArray(res) ? res : (res as { rows: unknown[] }).rows) as unknown[];
    if (rows.length > 0) out.push(pc);
    else {
      console.warn(
        `[relation-sync] paire ignorée (réciprocité non vérifiée) colonne ${pc.columnId} vers base ${pc.targetDatabaseId}`
      );
    }
  }
  return out;
}

interface InverseOp {
  partnerId: string;
  targetDatabaseId: string;
  inverseColumnId: string;
  kind: "add" | "remove";
}

/**
 * Répercute sur les lignes partenaires les ajouts et retraits d'une ligne.
 * `before` / `after` : cellules de la ligne avant et après écriture. Seules les
 * colonnes jumelées présentes dans `after` sont traitées. Opérations idempotentes,
 * lignes partenaires verrouillées dans l'ordre croissant de leur id ; une ligne
 * partenaire absente de la base cible est ignorée.
 */
export async function syncRelationInverses(
  tx: DbExecutor,
  args: {
    databaseId: string;
    rowId: string;
    before: Record<string, unknown> | null | undefined;
    after: Record<string, unknown> | null | undefined;
    /** Origin write context: partner updates are recorded as `relation_sync` with the same actor and batch. */
    ctx?: RowChangeContext;
  }
): Promise<void> {
  const { databaseId, rowId } = args;
  const before = args.before ?? {};
  const after = args.after ?? {};

  const cols = await tx
    .select({
      id: userDatabaseColumns.id,
      type: userDatabaseColumns.type,
      config: userDatabaseColumns.config,
    })
    .from(userDatabaseColumns)
    .where(and(eq(userDatabaseColumns.databaseId, databaseId), eq(userDatabaseColumns.type, "relation")));

  const ops: InverseOp[] = [];
  const candidates = pairedRelationColumns(cols).filter((pc) => pc.columnId in after);
  for (const pc of await validatedPairedColumns(tx, databaseId, candidates)) {
    const { added, removed } = diffRelationIds(before[pc.columnId], after[pc.columnId]);
    for (const id of added) {
      if (UUID_RE.test(id)) ops.push({ partnerId: id, ...pc, kind: "add" });
    }
    for (const id of removed) {
      if (UUID_RE.test(id)) ops.push({ partnerId: id, ...pc, kind: "remove" });
    }
  }
  // Ordre de verrou stable entre écritures concurrentes.
  ops.sort((x, y) =>
    x.partnerId < y.partnerId ? -1 : x.partnerId > y.partnerId ? 1 : x.kind < y.kind ? -1 : 1
  );

  // No operation: leave the transaction context untouched.
  if (ops.length === 0) return;
  const { ctx } = args;
  await setRowChangeContext(tx, { ...ctx, source: "relation_sync" });

  for (const op of ops) {
    if (op.kind === "add") {
      await tx.execute(sql`
        UPDATE user_database_rows
        SET cells = jsonb_set(
              COALESCE(cells, '{}'::jsonb),
              ARRAY[${op.inverseColumnId}::text],
              (CASE WHEN jsonb_typeof(cells -> ${op.inverseColumnId}::text) = 'array'
                    THEN cells -> ${op.inverseColumnId}::text ELSE '[]'::jsonb END)
                || to_jsonb(${rowId}::text)
            ),
            updated_at = now()
        WHERE id = ${op.partnerId}::uuid
          AND database_id = ${op.targetDatabaseId}::uuid
          AND COALESCE(jsonb_typeof(cells -> ${op.inverseColumnId}::text), 'array') IN ('array', 'null')
          AND NOT COALESCE(
            jsonb_typeof(cells -> ${op.inverseColumnId}::text) = 'array'
            AND (cells -> ${op.inverseColumnId}::text) ? ${rowId}::text,
            false
          )
      `);
    } else {
      await tx.execute(sql`
        UPDATE user_database_rows
        SET cells = jsonb_set(
              cells,
              ARRAY[${op.inverseColumnId}::text],
              COALESCE((
                SELECT jsonb_agg(e.v ORDER BY e.ord)
                FROM jsonb_array_elements(cells -> ${op.inverseColumnId}::text) WITH ORDINALITY AS e(v, ord)
                WHERE e.v <> to_jsonb(${rowId}::text)
              ), '[]'::jsonb)
            ),
            updated_at = now()
        WHERE id = ${op.partnerId}::uuid
          AND database_id = ${op.targetDatabaseId}::uuid
          AND jsonb_typeof(cells -> ${op.inverseColumnId}::text) = 'array'
          AND (cells -> ${op.inverseColumnId}::text) ? ${rowId}::text
      `);
    }
  }

  // Restore the origin context (absent when the caller gave none).
  if (ctx) await setRowChangeContext(tx, ctx);
  else await tx.execute(sql`select set_config('loriax.row_ctx', '', true)`);
}

/**
 * Prend, dans la transaction, un verrou advisory par couple de bases jumelées
 * (clé triée, acquisition dans l'ordre) AVANT tout verrou de ligne. Deux
 * écritures croisées (A vers B et B vers A) sont ainsi sérialisées au lieu de
 * s'interbloquer sur les lignes. Sans colonne jumelée : aucun verrou.
 */
export async function lockRelationPairs(tx: DbExecutor, databaseId: string): Promise<void> {
  const cols = await tx
    .select({
      id: userDatabaseColumns.id,
      type: userDatabaseColumns.type,
      config: userDatabaseColumns.config,
    })
    .from(userDatabaseColumns)
    .where(and(eq(userDatabaseColumns.databaseId, databaseId), eq(userDatabaseColumns.type, "relation")));
  const keys = new Set<string>();
  for (const pc of await validatedPairedColumns(tx, databaseId, pairedRelationColumns(cols))) {
    const [lo, hi] = [databaseId, pc.targetDatabaseId].sort();
    keys.add(`relpair:${lo}:${hi}`);
  }
  for (const key of [...keys].sort()) {
    await tx.execute(sql`SELECT pg_advisory_xact_lock(hashtextextended(${key}, 0))`);
  }
}
