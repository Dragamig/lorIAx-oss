/**
 * Règles d'écriture des vues par portée. Requiert RELATIONS_TEST_DATABASE_URL ; ignore sinon.
 */
import { describe, it, expect, beforeAll, afterAll, beforeEach } from "vitest";
import { randomUUID } from "crypto";
import type { Pool } from "pg";
import { setupViewsFixture } from "./views-fixture";
import {
  decideViewUpdate,
  decideViewCreate,
  decideViewDelete,
  countSharedViews,
  type ViewRow,
} from "../view-access";
import { eq, and } from "drizzle-orm";
import { userDatabaseViews } from "@/lib/db/schema";
import type { DbExecutor } from "../row-writes";

const URL = process.env.RELATIONS_TEST_DATABASE_URL;
const DB_NAME = URL ? new globalThis.URL(URL).pathname.replace(/^\//, "") : "";
if (URL && !DB_NAME.includes("test")) {
  throw new Error(`RELATIONS_TEST_DATABASE_URL doit viser une base de test, reçu "${DB_NAME}"`);
}

describe.skipIf(!URL)("view-access écriture", () => {
  let pool: Pool;
  let exec: DbExecutor;
  let tdb: { transaction: <T>(fn: (tx: DbExecutor) => Promise<T>) => Promise<T> };
  let teardown: () => Promise<void>;
  const SPACE = randomUUID();
  const DB = randomUUID();
  const A = randomUUID();
  const B = randomUUID();

  beforeAll(async () => {
    const f = await setupViewsFixture(URL!, "rh_l4_write");
    pool = f.pool;
    exec = f.db as unknown as DbExecutor;
    tdb = f.db as unknown as typeof tdb;
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
    await pool.query("INSERT INTO user_databases (id, space_id) VALUES ($1, $2)", [DB, SPACE]);
  });

  async function add(
    name: string,
    o: { scope?: "shared" | "personal"; by?: string | null; isDefault?: boolean; isPublic?: boolean } = {},
  ): Promise<ViewRow> {
    const r = await pool.query(
      `INSERT INTO user_database_views (database_id, name, type, scope, created_by, is_default, is_public, public_token)
       VALUES ($1, $2, 'kanban', $3, $4, $5, $6, $7) RETURNING id`,
      [
        DB,
        name,
        o.scope ?? "shared",
        o.by === undefined ? A : o.by,
        o.isDefault ?? false,
        o.isPublic ?? false,
        o.isPublic ? randomUUID().replace(/-/g, "") : null,
      ],
    );
    const id = r.rows[0].id as string;
    const [v] = await exec.select().from(userDatabaseViews).where(eq(userDatabaseViews.id, id));
    return v;
  }

  it("non-auteur change scope d'une partagée vers personal : 403, rien écrit", async () => {
    await add("S2");
    const v = await add("S1");
    const d = await decideViewUpdate(exec, { view: v, userId: B, patch: { scope: "personal" } });
    expect(d).toEqual({ ok: false, status: 403, error: "Accès refusé" });
    expect(await countSharedViews(exec, DB)).toBe(2);
  });

  it("partagée sans auteur vers personal : 400", async () => {
    await add("S2");
    const v = await add("S1", { by: null });
    const d = await decideViewUpdate(exec, { view: v, userId: A, patch: { scope: "personal" } });
    expect(d.ok).toBe(false);
    if (!d.ok) expect(d.status).toBe(400);
  });

  it("auteur : partagée vers personal acceptée si une autre partagée existe", async () => {
    await add("S2");
    const v = await add("S1");
    const d = await decideViewUpdate(exec, { view: v, userId: A, patch: { scope: "personal" } });
    expect(d).toMatchObject({ ok: true, revokePublicToken: false, unsetDefaultOthers: false });
  });

  it("passer en personal la vue isDefault : 400", async () => {
    await add("S2");
    const v = await add("S1", { isDefault: true });
    const d = await decideViewUpdate(exec, { view: v, userId: A, patch: { scope: "personal" } });
    expect(d.ok).toBe(false);
    if (!d.ok) expect(d.status).toBe(400);
  });

  it("passer en personal la dernière vue partagée : 400, même s'il existe des personnelles", async () => {
    await add("P1", { scope: "personal" });
    await add("P2", { scope: "personal", by: B });
    const v = await add("S1");
    const d = await decideViewUpdate(exec, { view: v, userId: A, patch: { scope: "personal" } });
    expect(d.ok).toBe(false);
    if (!d.ok) expect(d.status).toBe(400);
  });

  it("personnelle vers shared par son auteur : acceptée", async () => {
    const v = await add("P1", { scope: "personal" });
    const d = await decideViewUpdate(exec, { view: v, userId: A, patch: { scope: "shared" } });
    expect(d).toMatchObject({ ok: true, revokePublicToken: false, unsetDefaultOthers: false });
  });

  it("personnelle d'un autre : 404 pour update et delete, y compris pour un admin", async () => {
    const v = await add("P1", { scope: "personal", by: A });
    const u = await decideViewUpdate(exec, { view: v, userId: B, patch: { scope: "shared" } });
    expect(u).toEqual({ ok: false, status: 404, error: "Introuvable" });
    const del = await decideViewDelete(exec, { view: v, userId: B });
    expect(del).toEqual({ ok: false, status: 404, error: "Introuvable" });
  });

  it("isDefault ou isPublic sur une personnelle : 400", async () => {
    const v = await add("P1", { scope: "personal" });
    for (const patch of [{ isDefault: true }, { isPublic: true }]) {
      const d = await decideViewUpdate(exec, { view: v, userId: A, patch });
      expect(d.ok).toBe(false);
      if (!d.ok) expect(d.status).toBe(400);
    }
  });

  it("vue publique passée en personal : revokePublicToken", async () => {
    await add("S2");
    const v = await add("S1", { isPublic: true });
    const d = await decideViewUpdate(exec, { view: v, userId: A, patch: { scope: "personal" } });
    expect(d).toMatchObject({ ok: true, revokePublicToken: true, unsetDefaultOthers: false });
  });

  it("decideViewCreate personal avec isPublic ou isDefault : 400", () => {
    expect(decideViewCreate({ scope: "personal", isPublic: true }).ok).toBe(false);
    expect(decideViewCreate({ scope: "personal", isDefault: true }).ok).toBe(false);
    expect(decideViewCreate({ scope: "personal" })).toEqual({ ok: true });
    expect(decideViewCreate({ scope: "shared", isPublic: true, isDefault: true })).toEqual({ ok: true });
  });

  it("delete de la dernière vue partagée : 400 malgré 3 personnelles", async () => {
    await add("P1", { scope: "personal" });
    await add("P2", { scope: "personal" });
    await add("P3", { scope: "personal" });
    const v = await add("S1");
    const d = await decideViewDelete(exec, { view: v, userId: A });
    expect(d).toEqual({
      ok: false,
      status: 400,
      error: "Impossible de supprimer la dernière vue partagée d'une base",
    });
  });

  it("delete d'une personnelle : ok sans promoteDefault", async () => {
    const v = await add("P1", { scope: "personal" });
    expect(await decideViewDelete(exec, { view: v, userId: A })).toEqual({ ok: true, promoteDefault: false });
  });

  it("delete de la vue partagée isDefault : promoteDefault", async () => {
    await add("S2");
    const v = await add("S1", { isDefault: true });
    expect(await decideViewDelete(exec, { view: v, userId: A })).toEqual({ ok: true, promoteDefault: true });
  });

  it("404 precede 400 : non-auteur, isDefault sur la personnelle d'un autre", async () => {
    const v = await add("P1", { scope: "personal", by: A });
    const d = await decideViewUpdate(exec, { view: v, userId: B, patch: { isDefault: true } });
    expect(d).toEqual({ ok: false, status: 404, error: "Introuvable" });
  });

  it("publicToken parasite sur une partagee passee en personal : revoque", async () => {
    await add("S2");
    const v = await add("S1");
    await pool.query("UPDATE user_database_views SET public_token = 'tok' WHERE id = $1", [v.id]);
    const [fresh] = await exec.select().from(userDatabaseViews).where(eq(userDatabaseViews.id, v.id));
    const d = await decideViewUpdate(exec, { view: fresh, userId: A, patch: { scope: "personal" } });
    expect(d.ok && d.revokePublicToken).toBe(true);
  });

  it("personnelle vers shared avec isDefault : unsetDefaultOthers", async () => {
    const v = await add("P1", { scope: "personal" });
    const d = await decideViewUpdate(exec, { view: v, userId: A, patch: { scope: "shared", isDefault: true } });
    expect(d).toMatchObject({ ok: true, unsetDefaultOthers: true });
  });

  it("snapshot perimee : la vue relue fait foi (deja supprimee : 404)", async () => {
    const v = await add("S1");
    await pool.query("DELETE FROM user_database_views WHERE id = $1", [v.id]);
    expect(await decideViewDelete(exec, { view: v, userId: A })).toEqual({ ok: false, status: 404, error: "Introuvable" });
  });

  it("concurrence : deux transactions suppriment S1 et S2, une seule reussit, une partagee reste", async () => {
    const s1 = await add("S1");
    const s2 = await add("S2");
    const run = (v: ViewRow) =>
      tdb.transaction(async (tx) => {
        const d = await decideViewDelete(tx, { view: v, userId: A });
        if (!d.ok) return false;
        await new Promise((r) => setTimeout(r, 150));
        await tx.delete(userDatabaseViews).where(and(eq(userDatabaseViews.id, v.id)));
        return true;
      });
    const res = await Promise.all([run(s1), run(s2)]);
    expect(res.filter(Boolean)).toHaveLength(1);
    expect(await countSharedViews(exec, DB)).toBe(1);
  });

  it("concurrence : suppression de S1 et passage en personal de S2 : une partagee reste", async () => {
    const s1 = await add("S1");
    const s2 = await add("S2");
    const del = tdb.transaction(async (tx) => {
      const d = await decideViewDelete(tx, { view: s1, userId: A });
      if (!d.ok) return false;
      await new Promise((r) => setTimeout(r, 150));
      await tx.delete(userDatabaseViews).where(eq(userDatabaseViews.id, s1.id));
      return true;
    });
    const dem = tdb.transaction(async (tx) => {
      const d = await decideViewUpdate(tx, { view: s2, userId: A, patch: { scope: "personal" } });
      if (!d.ok) return false;
      await new Promise((r) => setTimeout(r, 150));
      await tx.update(userDatabaseViews).set({ scope: "personal" }).where(eq(userDatabaseViews.id, s2.id));
      return true;
    });
    const res = await Promise.all([del, dem]);
    expect(res.filter(Boolean)).toHaveLength(1);
    expect(await countSharedViews(exec, DB)).toBe(1);
  });
});
