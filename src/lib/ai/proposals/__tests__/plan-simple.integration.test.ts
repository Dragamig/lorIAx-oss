/**
 * Review Focus 3 contre la vraie base : une ligne d'une autre base, ou d'une base d'une autre organisation,
 * n'est jamais chargée ni planifiée. Requiert RELATIONS_TEST_DATABASE_URL ; ignore sinon.
 */
import { describe, it, expect, vi, beforeAll, afterAll } from "vitest";
import { randomUUID } from "crypto";
import type { Pool } from "pg";
import { setupRowHistoryFixture } from "../../../databases/__tests__/row-history-fixture";

const h = vi.hoisted(() => ({ db: undefined as unknown }));

vi.mock("@/lib/db", () => ({
  db: new Proxy({}, { get: (_t, k) => (h.db as Record<string | symbol, unknown>)[k] }),
}));

import { loadRowsByIds } from "@/lib/ai/chat-tools/rows-loader";
import { planUpdateRows } from "../plan-update";
import { planDeleteRows } from "../plan-delete";

const URL = process.env.RELATIONS_TEST_DATABASE_URL;
const DB_NAME = URL ? new globalThis.URL(URL).pathname.replace(/^\//, "") : "";
if (URL && !DB_NAME.includes("test")) {
  throw new Error(`RELATIONS_TEST_DATABASE_URL doit viser une base de test, reçu "${DB_NAME}"`);
}

describe.skipIf(!URL)("planification : cloisonnement des lignes", () => {
  let pool: Pool;
  let teardown: () => Promise<void>;
  const ORG_A = randomUUID();
  const ORG_B = randomUUID();
  const SPACE_A = randomUUID();
  const SPACE_B = randomUUID();
  const DB_MINE = randomUUID();
  const DB_SAME_ORG = randomUUID();
  const DB_OTHER_ORG = randomUUID();
  const COL = randomUUID();
  const ROW_MINE = randomUUID();
  const ROW_SAME_ORG = randomUUID();
  const ROW_OTHER_ORG = randomUUID();

  beforeAll(async () => {
    const f = await setupRowHistoryFixture(URL!, "rh_ai_plan_simple");
    pool = f.pool;
    teardown = f.teardown;
    h.db = f.db;
    await pool.query("INSERT INTO spaces (id, organization_id) VALUES ($1,$2),($3,$4)", [SPACE_A, ORG_A, SPACE_B, ORG_B]);
    await pool.query("INSERT INTO user_databases (id, space_id) VALUES ($1,$2),($3,$2),($4,$5)", [
      DB_MINE,
      SPACE_A,
      DB_SAME_ORG,
      DB_OTHER_ORG,
      SPACE_B,
    ]);
    await pool.query("INSERT INTO user_database_columns (id, database_id, name, type) VALUES ($1,$2,'t','text')", [COL, DB_MINE]);
    await pool.query(
      `INSERT INTO user_database_rows (id, database_id, cells, position) VALUES
       ($1,$4,$7::jsonb,0), ($2,$5,$8::jsonb,0), ($3,$6,$9::jsonb,0)`,
      [
        ROW_MINE,
        ROW_SAME_ORG,
        ROW_OTHER_ORG,
        DB_MINE,
        DB_SAME_ORG,
        DB_OTHER_ORG,
        JSON.stringify({ [COL]: "a" }),
        JSON.stringify({ [COL]: "autre base" }),
        JSON.stringify({ [COL]: "autre organisation" }),
      ],
    );
  });
  afterAll(async () => {
    await teardown();
  });

  it("loadRowsByIds ne rend que les lignes de la base demandée", async () => {
    const rows = await loadRowsByIds(DB_MINE, [ROW_MINE, ROW_SAME_ORG, ROW_OTHER_ORG, "pas-un-uuid"]);
    expect(rows.map((r) => r.id)).toEqual([ROW_MINE]);
    expect(await loadRowsByIds(DB_MINE, [ROW_SAME_ORG, ROW_OTHER_ORG])).toEqual([]);
  });

  it("planUpdateRows : unknown_row pour une ligne d'une autre base ou d'une autre organisation", async () => {
    for (const rowId of [ROW_SAME_ORG, ROW_OTHER_ORG, "pas-un-uuid"]) {
      await expect(planUpdateRows(DB_MINE, [{ rowId, cells: { [COL]: "x" } }])).rejects.toMatchObject({
        code: "unknown_row",
      });
    }
    await expect(
      planUpdateRows(DB_MINE, [
        { rowId: ROW_MINE, cells: { [COL]: "x" } },
        { rowId: ROW_OTHER_ORG, cells: { [COL]: "x" } },
      ]),
    ).rejects.toMatchObject({ code: "unknown_row" });
  });

  it("planUpdateRows : une ligne de la base passe, avec before exact", async () => {
    const plan = await planUpdateRows(DB_MINE, [{ rowId: ROW_MINE, cells: { [COL]: "b" } }]);
    expect(plan.payload).toMatchObject({ changes: [{ rowId: ROW_MINE, before: { [COL]: "a" }, after: { [COL]: "b" } }] });
  });

  it("planDeleteRows : unknown_row pour une ligne étrangère", async () => {
    await expect(planDeleteRows(DB_MINE, [ROW_MINE, ROW_OTHER_ORG])).rejects.toMatchObject({ code: "unknown_row" });
    await expect(planDeleteRows(DB_MINE, [ROW_SAME_ORG])).rejects.toMatchObject({ code: "unknown_row" });
  });
});
