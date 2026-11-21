/**
 * Visibilité des vues par portée. Requiert RELATIONS_TEST_DATABASE_URL ; ignore sinon.
 */
import { describe, it, expect, beforeAll, afterAll, beforeEach } from "vitest";
import { randomUUID } from "crypto";
import type { Pool } from "pg";
import { setupViewsFixture } from "./views-fixture";
import { listVisibleViews, getVisibleView, pickDefaultView, type ViewRow } from "../view-access";
import type { DbExecutor } from "../row-writes";

const URL = process.env.RELATIONS_TEST_DATABASE_URL;
const DB_NAME = URL ? new globalThis.URL(URL).pathname.replace(/^\//, "") : "";
if (URL && !DB_NAME.includes("test")) {
  throw new Error(`RELATIONS_TEST_DATABASE_URL doit viser une base de test, reçu "${DB_NAME}"`);
}

describe.skipIf(!URL)("view-access", () => {
  let pool: Pool;
  let exec: DbExecutor;
  let teardown: () => Promise<void>;
  const SPACE = randomUUID();
  const DB = randomUUID();
  const DB2 = randomUUID();
  const A = randomUUID();
  const B = randomUUID();

  beforeAll(async () => {
    const f = await setupViewsFixture(URL!, "rh_l4_access");
    pool = f.pool;
    exec = f.db as unknown as DbExecutor;
    teardown = f.teardown;
  });
  afterAll(async () => {
    await teardown();
  });
  beforeEach(async () => {
    await pool.query("DELETE FROM user_database_views");
    await pool.query("DELETE FROM user_databases");
    await pool.query("DELETE FROM users");
    await pool.query("INSERT INTO users (id, name) VALUES ($1, 'A'), ($2, 'B')", [A, B]);
    await pool.query("INSERT INTO user_databases (id, space_id) VALUES ($1, $3), ($2, $3)", [DB, DB2, SPACE]);
  });

  async function add(
    name: string,
    o: { db?: string; scope?: "shared" | "personal"; by?: string; position?: number; isDefault?: boolean; createdAt?: string } = {},
  ): Promise<string> {
    const r = await pool.query(
      `INSERT INTO user_database_views (database_id, name, type, scope, created_by, position, is_default, created_at)
       VALUES ($1, $2, 'kanban', $3, $4, $5, $6, COALESCE($7::timestamptz, now())) RETURNING id`,
      [o.db ?? DB, name, o.scope ?? "shared", o.by ?? A, o.position ?? 0, o.isDefault ?? false, o.createdAt ?? null],
    );
    return r.rows[0].id;
  }

  it("listVisibleViews d'A : la partagée puis la personnelle d'A, jamais celle de B", async () => {
    await add("Partagée");
    await add("Perso A", { scope: "personal", by: A });
    await add("Perso B", { scope: "personal", by: B });
    const names = (await listVisibleViews(exec, DB, A)).map((v) => v.name);
    expect(names).toEqual(["Partagée", "Perso A"]);
  });

  it("ordre : partagées avant personnelles quelle que soit la position", async () => {
    await add("P0", { scope: "personal", by: A, position: 0 });
    await add("S5", { position: 5 });
    await add("S2", { position: 2 });
    await add("P1", { scope: "personal", by: A, position: 1 });
    const names = (await listVisibleViews(exec, DB, A)).map((v) => v.name);
    expect(names).toEqual(["S2", "S5", "P0", "P1"]);
  });

  it("getVisibleView d'une personnelle d'un autre : null", async () => {
    const id = await add("Perso B", { scope: "personal", by: B });
    expect(await getVisibleView(exec, DB, id, A)).toBeNull();
    expect((await getVisibleView(exec, DB, id, B))?.id).toBe(id);
  });

  it("getVisibleView d'une vue d'une autre base : null", async () => {
    const id = await add("Partagée", { db: DB2 });
    expect(await getVisibleView(exec, DB, id, A)).toBeNull();
  });

  it("getVisibleView d'un identifiant inexistant : null", async () => {
    expect(await getVisibleView(exec, DB, randomUUID(), A)).toBeNull();
  });

  it("pickDefaultView ignore une personnelle isDefault parasite", async () => {
    await add("Perso défaut", { scope: "personal", by: A, isDefault: true });
    await add("Partagée", { position: 3 });
    const views = await listVisibleViews(exec, DB, A);
    expect(pickDefaultView(views)?.name).toBe("Partagée");
  });

  it("pickDefaultView prend la partagée isDefault, sinon la première partagée", async () => {
    await add("S1", { position: 1 });
    await add("S2", { position: 2, isDefault: true });
    expect(pickDefaultView(await listVisibleViews(exec, DB, A))?.name).toBe("S2");
  });

  it("pickDefaultView sans vue partagée renvoie la première personnelle", async () => {
    await add("Perso 2", { scope: "personal", by: A, position: 2 });
    await add("Perso 1", { scope: "personal", by: A, position: 1 });
    expect(pickDefaultView(await listVisibleViews(exec, DB, A))?.name).toBe("Perso 1");
  });

  it("pickDefaultView d'une liste vide : null", () => {
    expect(pickDefaultView([] as ViewRow[])).toBeNull();
  });
});
