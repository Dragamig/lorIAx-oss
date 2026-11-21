/**
 * Declencheurs d'historique de ligne (migration 0054). Requiert
 * RELATIONS_TEST_DATABASE_URL ; ignore sinon. Schema dedie rh_trigger.
 */
import { describe, it, expect, beforeAll, afterAll, beforeEach } from "vitest";
import { randomUUID } from "crypto";
import type { Pool } from "pg";
import { getTableColumns } from "drizzle-orm";
import { databaseRowChanges } from "@/lib/db/schema-row-activity";
import { isEmptyCell } from "@/lib/databases/cell-compare";
import { setupRowHistoryFixture } from "./row-history-fixture";
import { ensureRowHistoryTriggers } from "../../../../scripts/migrate-row-history";

const URL = process.env.RELATIONS_TEST_DATABASE_URL;
const DB_NAME = URL ? new globalThis.URL(URL).pathname.replace(/^\//, "") : "";
if (URL && !DB_NAME.includes("test")) {
  throw new Error(`RELATIONS_TEST_DATABASE_URL doit viser une base de test, reçu "${DB_NAME}"`);
}

describe.skipIf(!URL)("row history triggers", () => {
  let pool: Pool;
  let teardown: () => Promise<void>;
  let schemaName: string;
  const DB = randomUUID();
  const SPACE = randomUUID();
  const USER = randomUUID();
  const COL_A = randomUUID();
  const COL_B = randomUUID();
  const COL_F = randomUUID();
  const COL_N = randomUUID();
  const ORPHAN = randomUUID();

  beforeAll(async () => {
    const f = await setupRowHistoryFixture(URL!, "rh_trigger");
    pool = f.pool;
    teardown = f.teardown;
    schemaName = f.schema;
  });
  afterAll(async () => {
    await teardown();
  });
  beforeEach(async () => {
    await pool.query(
      "TRUNCATE activity_log, database_row_changes, external_row_tracking, external_database_mappings, user_database_rows, user_database_columns, user_databases, users"
    );
    await pool.query("INSERT INTO users (id) VALUES ($1)", [USER]);
    await pool.query("INSERT INTO user_databases (id, space_id) VALUES ($1, $2)", [DB, SPACE]);
    await pool.query(
      `INSERT INTO user_database_columns (id, database_id, name, type, position) VALUES
        ($1, $5, 'Nom', 'text', 0), ($2, $5, 'Montant', 'number', 1),
        ($3, $5, 'Calc', 'formula', 2), ($4, $5, 'N', 'autonumber', 3)`,
      [COL_A, COL_B, COL_F, COL_N, DB]
    );
  });

  const ctx = (o: Record<string, unknown>) => JSON.stringify(o);

  /** Runs statements in one transaction with an optional row context. */
  async function tx(context: string | null, fn: (q: Pool["query"]) => Promise<void>) {
    const c = await pool.connect();
    try {
      await c.query("BEGIN");
      if (context !== null) await c.query("select set_config('loriax.row_ctx', $1, true)", [context]);
      await fn(c.query.bind(c) as Pool["query"]);
      await c.query("COMMIT");
    } catch (e) {
      await c.query("ROLLBACK");
      throw e;
    } finally {
      c.release();
    }
  }
  const changes = async () =>
    (await pool.query("SELECT * FROM database_row_changes ORDER BY created_at, id")).rows;
  const insertRow = (q: Pool["query"], cells: Record<string, unknown>, id = randomUUID()) =>
    q("INSERT INTO user_database_rows (id, database_id, cells) VALUES ($1, $2, $3)", [
      id,
      DB,
      JSON.stringify(cells),
    ]).then(() => id);
  const updateCells = (q: Pool["query"], id: string, cells: Record<string, unknown>) =>
    q("UPDATE user_database_rows SET cells = $2 WHERE id = $1", [id, JSON.stringify(cells)]);

  it("insert ui : une entrée created, source ui, acteur, changes limités aux cellules non vides", async () => {
    const batch = randomUUID();
    let id = "";
    await tx(ctx({ source: "ui", actorUserId: USER, batchId: batch }), async (q) => {
      id = await insertRow(q, { [COL_A]: "Acme", [COL_B]: 0, [ORPHAN]: "" });
    });
    const rows = await changes();
    expect(rows).toHaveLength(1);
    expect(rows[0]).toMatchObject({
      kind: "created",
      source: "ui",
      actor_user_id: USER,
      batch_id: batch,
      row_id: id,
      database_id: DB,
    });
    expect(rows[0].changes).toEqual([
      { columnId: COL_A, columnName: "Nom", columnType: "text", before: null, after: "Acme" },
      { columnId: COL_B, columnName: "Montant", columnType: "number", before: null, after: 0 },
    ]);
  });

  it("insert import : created avec changes vide", async () => {
    await tx(ctx({ source: "import" }), async (q) => {
      await insertRow(q, { [COL_A]: "Acme" });
    });
    const rows = await changes();
    expect(rows[0]).toMatchObject({ kind: "created", source: "import", changes: [] });
  });

  it("update : seules les clés qui diffèrent, clé absente = before null", async () => {
    let id = "";
    await tx(ctx({ source: "system" }), async (q) => {
      id = await insertRow(q, { [COL_A]: "Acme" });
    });
    await pool.query("TRUNCATE database_row_changes");
    await tx(ctx({ source: "ui", actorUserId: USER }), async (q) => {
      await updateCells(q, id, { [COL_A]: "Acme", [COL_B]: 5 });
    });
    const rows = await changes();
    expect(rows).toHaveLength(1);
    expect(rows[0].kind).toBe("updated");
    expect(rows[0].changes).toEqual([
      { columnId: COL_B, columnName: "Montant", columnType: "number", before: null, after: 5 },
    ]);
  });

  it("update : colonnes formula et autonumber et clés orphelines ignorées", async () => {
    let id = "";
    await tx(ctx({ skip: true }), async (q) => {
      id = await insertRow(q, { [COL_A]: "a" });
    });
    await tx(ctx({ source: "ui" }), async (q) => {
      await updateCells(q, id, { [COL_A]: "a", [COL_F]: 1, [COL_N]: 2, [ORPHAN]: "x" });
    });
    expect(await changes()).toHaveLength(0);
  });

  it("update : chaîne de 3000 caractères coupée à 2000 avec truncated true", async () => {
    let id = "";
    await tx(ctx({ skip: true }), async (q) => {
      id = await insertRow(q, {});
    });
    await tx(ctx({ source: "ui" }), async (q) => {
      await updateCells(q, id, { [COL_A]: "x".repeat(3000) });
    });
    const [row] = await changes();
    expect(row.changes).toHaveLength(1);
    expect(row.changes[0].after).toHaveLength(2000);
    expect(row.changes[0].truncated).toBe(true);
  });

  it("update de position seule ou de updated_at seul : aucune entrée", async () => {
    let id = "";
    await tx(ctx({ skip: true }), async (q) => {
      id = await insertRow(q, { [COL_A]: "a" });
    });
    await pool.query("UPDATE user_database_rows SET position = 9 WHERE id = $1", [id]);
    await pool.query("UPDATE user_database_rows SET updated_at = now() WHERE id = $1", [id]);
    expect(await changes()).toHaveLength(0);
  });

  it("update vers cellules identiques : aucune entrée", async () => {
    let id = "";
    await tx(ctx({ skip: true }), async (q) => {
      id = await insertRow(q, { [COL_A]: "a" });
    });
    await tx(ctx({ source: "ui" }), async (q) => {
      await updateCells(q, id, { [COL_A]: "a" });
      await updateCells(q, id, { [COL_A]: "a", [COL_B]: null });
    });
    expect(await changes()).toHaveLength(0);
  });

  it("delete : kind deleted, toutes les cellules en before", async () => {
    let id = "";
    await tx(ctx({ skip: true }), async (q) => {
      id = await insertRow(q, { [COL_A]: "a", [COL_B]: "" });
    });
    await tx(ctx({ source: "ui", actorUserId: USER }), async (q) => {
      await q("DELETE FROM user_database_rows WHERE id = $1", [id]);
    });
    const [row] = await changes();
    expect(row.kind).toBe("deleted");
    expect(row.changes).toEqual([
      { columnId: COL_A, columnName: "Nom", columnType: "text", before: "a", after: null },
      { columnId: COL_B, columnName: "Montant", columnType: "number", before: "", after: null },
    ]);
  });

  it("suppression en cascade d'une base : réussit, aucune entrée pour cette base", async () => {
    const other = randomUUID();
    await pool.query("INSERT INTO user_databases (id, space_id) VALUES ($1, $2)", [other, SPACE]);
    await tx(ctx({ source: "ui" }), async (q) => {
      await insertRow(q, { [COL_A]: "a" });
      await q("INSERT INTO user_database_rows (database_id, cells) VALUES ($1, $2)", [other, "{}"]);
    });
    await tx(ctx({ source: "ui" }), async (q) => {
      await q("DELETE FROM user_databases WHERE id = $1", [DB]);
    });
    const left = await pool.query("SELECT count(*)::int AS n FROM user_database_rows WHERE database_id = $1", [DB]);
    expect(left.rows[0].n).toBe(0);
    const rows = await changes();
    expect(rows.filter((r) => r.database_id === DB)).toHaveLength(0);
  });

  it("sans contexte : source system, même batch_id dans une transaction, batch_id différent entre deux transactions", async () => {
    await tx(null, async (q) => {
      await insertRow(q, { [COL_A]: "1" });
      await insertRow(q, { [COL_A]: "2" });
    });
    await tx(null, async (q) => {
      await insertRow(q, { [COL_A]: "3" });
    });
    const rows = await changes();
    expect(rows).toHaveLength(3);
    expect(rows.every((r) => r.source === "system" && r.actor_user_id === null)).toBe(true);
    expect(rows[0].batch_id).toBe(rows[1].batch_id);
    expect(rows[2].batch_id).not.toBe(rows[0].batch_id);
  });

  it("skip true : aucune entrée", async () => {
    await tx(ctx({ source: "ui", skip: true }), async (q) => {
      await insertRow(q, { [COL_A]: "a" });
    });
    expect(await changes()).toHaveLength(0);
  });

  it("contexte JSON invalide : source system; batchId invalide : batch dérivé", async () => {
    await tx("{pas du json", async (q) => {
      await insertRow(q, { [COL_A]: "a" });
    });
    await tx(ctx({ source: "ui", batchId: "pas-un-uuid", actorUserId: "nope" }), async (q) => {
      await insertRow(q, { [COL_A]: "b" });
    });
    const rows = await changes();
    expect(rows[0]).toMatchObject({ source: "system", actor_user_id: null });
    expect(rows[1].source).toBe("ui");
    expect(rows[1].actor_user_id).toBeNull();
    expect(rows[1].batch_id).toMatch(/^[0-9a-f-]{36}$/);
  });

  it("rollback : ni écriture ni entrée", async () => {
    await expect(
      tx(ctx({ source: "ui" }), async (q) => {
        await insertRow(q, { [COL_A]: "a" });
        throw new Error("boom");
      })
    ).rejects.toThrow("boom");
    expect(await changes()).toHaveLength(0);
    const n = await pool.query("SELECT count(*)::int AS n FROM user_database_rows");
    expect(n.rows[0].n).toBe(0);
  });

  it("le contexte ne fuit pas : après le commit d'une transaction avec contexte ui, un UPDATE hors transaction produit system", async () => {
    const c = await pool.connect();
    try {
      let id = "";
      await c.query("BEGIN");
      await c.query("select set_config('loriax.row_ctx', $1, true)", [ctx({ source: "ui", actorUserId: USER })]);
      id = await insertRow(c.query.bind(c) as Pool["query"], { [COL_A]: "a" });
      await c.query("COMMIT");
      await c.query("UPDATE user_database_rows SET cells = $2 WHERE id = $1", [id, JSON.stringify({ [COL_A]: "b" })]);
      const rows = (await c.query("SELECT * FROM database_row_changes ORDER BY created_at, id")).rows;
      expect(rows).toHaveLength(2);
      expect(rows[0]).toMatchObject({ kind: "created", source: "ui", actor_user_id: USER });
      expect(rows[1]).toMatchObject({ kind: "updated", source: "system", actor_user_id: null });
    } finally {
      c.release();
    }
  });

  it("colonne renommée après coup : l'entrée garde l'ancien columnName", async () => {
    let id = "";
    await tx(ctx({ skip: true }), async (q) => {
      id = await insertRow(q, { [COL_A]: "a" });
    });
    await tx(ctx({ source: "ui" }), async (q) => {
      await updateCells(q, id, { [COL_A]: "b" });
    });
    await pool.query("UPDATE user_database_columns SET name = 'Renommée' WHERE id = $1", [COL_A]);
    await tx(ctx({ source: "ui" }), async (q) => {
      await updateCells(q, id, { [COL_A]: "c" });
    });
    const rows = await changes();
    expect(rows[0].changes[0].columnName).toBe("Nom");
    expect(rows[1].changes[0].columnName).toBe("Renommée");
  });

  it("row_history_is_empty est identique à isEmptyCell", async () => {
    const values: unknown[] = [
      null, "", " ", "\n", "\t", " ", " a ", "0", 0, false, [], [""], ["a"], {}, "2026-01-01",
      " ", "﻿", "　", "​",
    ];
    for (const v of values) {
      const r = await pool.query("SELECT row_history_is_empty($1::jsonb) AS e", [JSON.stringify(v)]);
      expect(r.rows[0].e, JSON.stringify(v)).toBe(isEmptyCell(v));
    }
  });

  it("fixture drift : les colonnes de database_row_changes suivent le schéma Drizzle", async () => {
    const r = await pool.query(
      "SELECT column_name FROM information_schema.columns WHERE table_schema = $1 AND table_name = 'database_row_changes'",
      [schemaName],
    );
    const actual = r.rows.map((x) => x.column_name).sort();
    const expected = Object.values(getTableColumns(databaseRowChanges))
      .map((c) => c.name)
      .sort();
    expect(actual).toEqual(expected);
  });

  it("ensureRowHistoryTriggers renvoie null si les tables n'existent pas", async () => {
    const { Pool: P } = await import("pg");
    const admin = new P({ connectionString: URL });
    const emptySchema = `${schemaName}_empty`;
    await admin.query(`CREATE SCHEMA IF NOT EXISTS ${emptySchema}`);
    try {
      const u = new globalThis.URL(URL!);
      u.searchParams.set("options", `-c search_path=${emptySchema}`);
      await expect(ensureRowHistoryTriggers(u.toString())).resolves.toBeNull();
    } finally {
      await admin.query(`DROP SCHEMA IF EXISTS ${emptySchema} CASCADE`);
      await admin.end();
    }
  });
});
