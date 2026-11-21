/**
 * Lecture de l'historique d'une ligne. Requiert RELATIONS_TEST_DATABASE_URL ; ignore sinon.
 */
import { describe, it, expect, beforeAll, afterAll, beforeEach } from "vitest";
import { randomUUID } from "crypto";
import type { Pool } from "pg";
import { setupRowHistoryFixture } from "./row-history-fixture";
import { listRowHistory, InvalidHistoryCursorError } from "../row-history-read";
import type { DbExecutor } from "../row-writes";

const URL = process.env.RELATIONS_TEST_DATABASE_URL;
const DB_NAME = URL ? new globalThis.URL(URL).pathname.replace(/^\//, "") : "";
if (URL && !DB_NAME.includes("test")) {
  throw new Error(`RELATIONS_TEST_DATABASE_URL doit viser une base de test, reçu "${DB_NAME}"`);
}

describe.skipIf(!URL)("listRowHistory", () => {
  let pool: Pool;
  let exec: DbExecutor;
  let teardown: () => Promise<void>;
  const ORG = randomUUID();
  const OTHER_ORG = randomUUID();
  const SPACE = randomUUID();
  const DB = randomUUID();
  const DB2 = randomUUID();
  const COL = randomUUID();
  const ROW = randomUUID();
  const MEMBER = randomUUID();
  const OUTSIDER = randomUUID();

  beforeAll(async () => {
    const f = await setupRowHistoryFixture(URL!, "rh_read");
    pool = f.pool;
    exec = f.db as unknown as DbExecutor;
    teardown = f.teardown;
  });
  afterAll(async () => {
    await teardown();
  });
  beforeEach(async () => {
    await pool.query("DELETE FROM database_row_changes");
    await pool.query("DELETE FROM user_databases");
    await pool.query("DELETE FROM spaces");
    await pool.query("DELETE FROM organization_members");
    await pool.query("DELETE FROM users");
    await pool.query("INSERT INTO spaces (id, organization_id) VALUES ($1, $2)", [SPACE, ORG]);
    await pool.query("INSERT INTO user_databases (id, space_id) VALUES ($1, $3), ($2, $3)", [DB, DB2, SPACE]);
    await pool.query("INSERT INTO users (id, name) VALUES ($1, 'Alice'), ($2, 'Zed')", [MEMBER, OUTSIDER]);
    await pool.query("INSERT INTO organization_members (organization_id, user_id) VALUES ($1, $2)", [ORG, MEMBER]);
    await pool.query("INSERT INTO organization_members (organization_id, user_id) VALUES ($1, $2)", [OTHER_ORG, OUTSIDER]);
  });

  const entry = (over: { id?: string; createdAt?: string; db?: string; row?: string; actor?: string | null; label?: string | null; changes?: unknown }) =>
    pool.query(
      `INSERT INTO database_row_changes (id, database_id, row_id, kind, source, actor_user_id, actor_label, batch_id, changes, created_at)
       VALUES ($1, $2, $3, 'updated', 'ui', $4, $5, $6, $7::jsonb, $8::timestamptz)`,
      [
        over.id ?? randomUUID(),
        over.db ?? DB,
        over.row ?? ROW,
        over.actor ?? null,
        over.label ?? null,
        randomUUID(),
        JSON.stringify(over.changes ?? []),
        over.createdAt ?? "2026-01-01T00:00:00.000000Z",
      ]
    );
  const list = (over: Partial<{ cursor: string; limit: number; db: string; row: string; org: string }> = {}) =>
    listRowHistory(exec, {
      databaseId: over.db ?? DB,
      rowId: over.row ?? ROW,
      orgId: over.org ?? ORG,
      cursor: over.cursor,
      limit: over.limit ?? 20,
    });

  it("ordre created_at desc puis id desc", async () => {
    const a = "00000000-0000-4000-8000-000000000001";
    const b = "00000000-0000-4000-8000-000000000002";
    const c = "00000000-0000-4000-8000-000000000003";
    await entry({ id: a, createdAt: "2026-01-01T00:00:00.000000Z" });
    await entry({ id: b, createdAt: "2026-01-02T00:00:00.000000Z" });
    await entry({ id: c, createdAt: "2026-01-02T00:00:00.000000Z" });
    const { items } = await list();
    expect(items.map((i) => i.id)).toEqual([c, b, a]);
  });

  it("60 entrées de même created_at paginées par 20 : aucune duplication, aucun trou, 3 pages", async () => {
    const ts = "2026-03-03T10:20:30.123456Z";
    const ids: string[] = [];
    for (let n = 0; n < 60; n++) {
      const id = randomUUID();
      ids.push(id);
      await entry({ id, createdAt: ts });
    }
    const seen: string[] = [];
    let cursor: string | undefined;
    let pages = 0;
    do {
      const page = await list({ cursor, limit: 20 });
      seen.push(...page.items.map((i) => i.id));
      cursor = page.nextCursor ?? undefined;
      pages++;
    } while (cursor && pages < 10);
    expect(pages).toBe(3);
    expect(seen).toHaveLength(60);
    expect(new Set(seen).size).toBe(60);
    expect([...seen].sort()).toEqual([...ids].sort());
  });

  it("limit + 1 : nextCursor null sur la dernière page", async () => {
    for (let n = 0; n < 3; n++) await entry({ createdAt: `2026-01-0${n + 1}T00:00:00.000000Z` });
    const p1 = await list({ limit: 2 });
    expect(p1.items).toHaveLength(2);
    expect(p1.nextCursor).not.toBeNull();
    const p2 = await list({ limit: 2, cursor: p1.nextCursor! });
    expect(p2.items).toHaveLength(1);
    expect(p2.nextCursor).toBeNull();
    const exact = await list({ limit: 3 });
    expect(exact.nextCursor).toBeNull();
  });

  it("un rowId d'une autre base ne renvoie rien", async () => {
    await entry({ db: DB2 });
    expect((await list()).items).toHaveLength(0);
    expect((await list({ db: DB2 })).items).toHaveLength(1);
  });

  it("une base d'une autre organisation ne renvoie rien", async () => {
    await entry({});
    expect((await list({ org: OTHER_ORG })).items).toHaveLength(0);
  });

  it("ligne supprimée : l'historique reste lisible", async () => {
    await entry({});
    await pool.query("DELETE FROM user_database_rows WHERE id = $1", [ROW]);
    expect((await list()).items).toHaveLength(1);
  });

  it("acteur supprimé : actor null et actorLabel conservé", async () => {
    await entry({ actor: MEMBER, label: "Alice (ancienne)" });
    await pool.query("DELETE FROM users WHERE id = $1", [MEMBER]);
    const [item] = (await list()).items;
    expect(item.actor).toBeNull();
    expect(item.actorLabel).toBe("Alice (ancienne)");
  });

  it("acteur membre : actor renseigné; acteur hors organisation : actor null", async () => {
    await entry({ actor: MEMBER, createdAt: "2026-01-02T00:00:00.000000Z" });
    await entry({ actor: OUTSIDER, createdAt: "2026-01-01T00:00:00.000000Z" });
    const { items } = await list();
    expect(items[0].actor).toEqual({ id: MEMBER, name: "Alice" });
    expect(items[1].actor).toBeNull();
  });

  it("colonne renommée : columnName d'origine", async () => {
    await entry({
      changes: [{ columnId: COL, columnName: "Ancien nom", columnType: "text", before: null, after: "x" }],
    });
    const [item] = (await list()).items;
    expect(item.changes[0].columnName).toBe("Ancien nom");
  });

  it("curseur illisible : InvalidHistoryCursorError", async () => {
    await expect(list({ cursor: "zzz" })).rejects.toBeInstanceOf(InvalidHistoryCursorError);
    const bad = Buffer.from(JSON.stringify({ t: "x'; drop", i: "y" })).toString("base64url");
    await expect(list({ cursor: bad })).rejects.toBeInstanceOf(InvalidHistoryCursorError);
  });
});
