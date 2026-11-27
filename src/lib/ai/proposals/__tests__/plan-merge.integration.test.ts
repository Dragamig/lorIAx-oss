/**
 * Fusion de doublons contre la vraie base : repointage des relations unidirectionnelles, jumelles ignorées,
 * autre organisation ignorée. Requiert RELATIONS_TEST_DATABASE_URL ; ignore sinon.
 */
import { describe, it, expect, vi, beforeAll, afterAll } from "vitest";
import { randomUUID } from "crypto";
import type { Pool } from "pg";
import { setupRowHistoryFixture } from "../../../databases/__tests__/row-history-fixture";

const h = vi.hoisted(() => ({ db: undefined as unknown }));

vi.mock("@/lib/db", () => ({
  db: new Proxy({}, { get: (_t, k) => (h.db as Record<string | symbol, unknown>)[k] }),
}));

import { planMergeDuplicates, computeMergeFreshness, buildMergeWrites } from "../plan-merge";
import { isFresh } from "../freshness";

// eslint-disable-next-line @typescript-eslint/no-explicit-any
type G = Record<string, any>;
const URL = process.env.RELATIONS_TEST_DATABASE_URL;
const DB_NAME = URL ? new globalThis.URL(URL).pathname.replace(/^\//, "") : "";
if (URL && !DB_NAME.includes("test")) {
  throw new Error(`RELATIONS_TEST_DATABASE_URL doit viser une base de test, reçu "${DB_NAME}"`);
}

describe.skipIf(!URL)("planMergeDuplicates : repointage des relations", () => {
  let pool: Pool;
  let teardown: () => Promise<void>;
  const ORG_A = randomUUID();
  const ORG_B = randomUUID();
  const SPACE_A = randomUUID();
  const SPACE_B = randomUUID();
  const DB_A = randomUUID(); // base fusionnée
  const DB_X = randomUUID(); // même organisation
  const DB_Y = randomUUID(); // autre organisation
  const KEY = randomUUID();
  const SELF_UNI = randomUUID(); // relation unidirectionnelle de A vers A
  const X_UNI = randomUUID(); // X -> A, sans jumelle
  const X_PAIRED = randomUUID(); // X -> A, jumelée avec A_PAIRED
  const A_PAIRED = randomUUID(); // A -> X, jumelée avec X_PAIRED
  const X_FAKE_PAIR = randomUUID(); // X -> A, inverse déclarée mais non réciproque
  const Y_UNI = randomUUID(); // autre organisation
  const OLD = randomUUID();
  const NEW = randomUUID();
  const OLD_B = randomUUID(); // second groupe : cible de relation d'une ligne retirée du premier
  const NEW_B = randomUUID();
  const X_ROW = randomUUID();
  const X_PAIRED_ROW = randomUUID();
  const Y_ROW = randomUUID();
  const j = JSON.stringify;

  beforeAll(async () => {
    const f = await setupRowHistoryFixture(URL!, "rh_ai_plan_merge");
    pool = f.pool;
    teardown = f.teardown;
    h.db = f.db;
    await pool.query("INSERT INTO spaces (id, organization_id) VALUES ($1,$2),($3,$4)", [SPACE_A, ORG_A, SPACE_B, ORG_B]);
    await pool.query("INSERT INTO user_databases (id, space_id) VALUES ($1,$2),($3,$2),($4,$5)", [DB_A, SPACE_A, DB_X, DB_Y, SPACE_B]);
    const col = (id: string, db: string, type: string, config: unknown) =>
      pool.query("INSERT INTO user_database_columns (id, database_id, name, type, config) VALUES ($1,$2,'c',$3,$4::jsonb)", [id, db, type, j(config)]);
    await col(KEY, DB_A, "text", {});
    await col(SELF_UNI, DB_A, "relation", { targetDatabaseId: DB_A });
    await col(X_UNI, DB_X, "relation", { targetDatabaseId: DB_A });
    await col(X_PAIRED, DB_X, "relation", { targetDatabaseId: DB_A, inverseColumnId: A_PAIRED });
    await col(A_PAIRED, DB_A, "relation", { targetDatabaseId: DB_X, inverseColumnId: X_PAIRED });
    await col(X_FAKE_PAIR, DB_X, "relation", { targetDatabaseId: DB_A, inverseColumnId: randomUUID() });
    await col(Y_UNI, DB_Y, "relation", { targetDatabaseId: DB_A });
    const row = (id: string, db: string, cells: unknown, pos: number, updated: string) =>
      pool.query("INSERT INTO user_database_rows (id, database_id, cells, position, updated_at) VALUES ($1,$2,$3::jsonb,$4,$5)", [id, db, j(cells), pos, updated]);
    // OLD (retirée) porte une relation unidirectionnelle vers OLD_B (retirée aussi) : cible d'une autre ligne retirée.
    await row(OLD, DB_A, { [KEY]: "dup", [SELF_UNI]: [OLD_B] }, 0, "2026-01-01T00:00:00Z");
    await row(NEW, DB_A, { [KEY]: "dup" }, 1, "2026-02-01T00:00:00Z");
    await row(OLD_B, DB_A, { [KEY]: "bis" }, 2, "2026-01-01T00:00:00Z");
    await row(NEW_B, DB_A, { [KEY]: "bis" }, 3, "2026-02-01T00:00:00Z");
    await row(X_ROW, DB_X, { [X_UNI]: [OLD, "autre", OLD_B], [X_FAKE_PAIR]: [OLD] }, 0, "2026-01-01T00:00:00Z");
    await row(X_PAIRED_ROW, DB_X, { [X_PAIRED]: [OLD] }, 1, "2026-01-01T00:00:00Z");
    await row(Y_ROW, DB_Y, { [Y_UNI]: [OLD] }, 0, "2026-01-01T00:00:00Z");
  });
  afterAll(async () => {
    await teardown();
  });

  it("repointe les unidirectionnelles de la même organisation, ignore jumelles et autre organisation", async () => {
    const plan = await planMergeDuplicates(DB_A, [KEY]);
    const p = plan.payload as { groups: G[] };
    const g = p.groups.find((x) => x.keepRowId === NEW)!;
    const gb = p.groups.find((x) => x.keepRowId === NEW_B)!;
    // La ligne retirée OLD (membre de groupe) est listée aussi ; buildMergeWrites l'écarte.
    const all = [...g.repatriation.repointed, ...gb.repatriation.repointed].filter((r: G) => r.rowId !== OLD);
    const keyOf = (r: G) => `${r.rowId}:${r.columnId}`;
    expect(all.map(keyOf).sort()).toEqual([`${X_ROW}:${X_UNI}`, `${X_ROW}:${X_FAKE_PAIR}`, `${X_ROW}:${X_UNI}`].sort());
    const uni = g.repatriation.repointed.find((r: G) => r.columnId === X_UNI);
    expect(uni.before).toEqual([OLD, "autre", OLD_B]);
    const w = buildMergeWrites(plan.payload as Extract<typeof plan.payload, { type: "merge_duplicates" }>);
    expect(w.repoints.find((r) => r.columnId === X_UNI)!.after).toEqual([NEW, "autre", NEW_B]);
    // Ni la jumelle réciproque ni l'autre organisation.
    expect(all.some((r) => r.rowId === X_PAIRED_ROW || r.rowId === Y_ROW)).toBe(false);
    // Focus 4 : la ligne retirée OLD (porteuse d'une relation vers OLD_B, retirée) est snapshottée et sa relation réunie sur la conservée.
    expect(g.removedRows[0].cells[SELF_UNI]).toEqual([OLD_B]);
    expect(w.keeps.find((k) => k.rowId === NEW)!.after[SELF_UNI]).toEqual([NEW_B]);
    expect(plan.freshness.rows.map((r) => r.id)).toContain(X_ROW);
  });

  it("computeMergeFreshness retombe sur l'empreinte planifiée, puis détecte un changement", async () => {
    const plan = await planMergeDuplicates(DB_A, [KEY]);
    const p = plan.payload as Extract<typeof plan.payload, { type: "merge_duplicates" }>;
    expect(isFresh(plan.freshness, await computeMergeFreshness(DB_A, p))).toBe(true);
    await pool.query("UPDATE user_database_rows SET cells = $2::jsonb WHERE id = $1", [X_ROW, j({ [X_UNI]: [OLD] })]);
    expect(isFresh(plan.freshness, await computeMergeFreshness(DB_A, p))).toBe(false);
    const stale = await planMergeDuplicates(DB_A, [KEY]);
    await pool.query("INSERT INTO user_database_rows (database_id, cells, position) VALUES ($1,$2::jsonb,9)", [DB_A, j({ [KEY]: "DUP" })]);
    expect(isFresh(stale.freshness, await computeMergeFreshness(DB_A, stale.payload as Extract<typeof stale.payload, { type: "merge_duplicates" }>))).toBe(false);
  });
});
