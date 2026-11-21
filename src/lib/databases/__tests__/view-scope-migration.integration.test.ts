/**
 * Migration 0057 (portee des vues). Requiert RELATIONS_TEST_DATABASE_URL ; ignore sinon.
 * La fixture est creee SANS colonne scope et avec l'ancien index : la migration doit tout apporter.
 */
import { describe, it, expect, beforeAll, afterAll } from "vitest";
import { randomUUID } from "crypto";
import type { Pool } from "pg";
import { setupViewsFixture, readViewScopeSql } from "./views-fixture";

const URL = process.env.RELATIONS_TEST_DATABASE_URL;
const DB_NAME = URL ? new globalThis.URL(URL).pathname.replace(/^\//, "") : "";
if (URL && !DB_NAME.includes("test")) {
  throw new Error(`RELATIONS_TEST_DATABASE_URL doit viser une base de test, reçu "${DB_NAME}"`);
}

const SCHEMA = "rh_l4_scope";

describe.skipIf(!URL)("migration 0057 portée des vues", () => {
  let pool: Pool;
  let teardown: () => Promise<void>;
  const dbId = randomUUID();
  const u1 = randomUUID();
  const u2 = randomUUID();

  const insert = (name: string, by: string, scope?: string) =>
    pool.query(
      scope
        ? "INSERT INTO user_database_views (database_id, name, type, created_by, scope) VALUES ($1,$2,'grid',$3,$4)"
        : "INSERT INTO user_database_views (database_id, name, type, created_by) VALUES ($1,$2,'grid',$3)",
      scope ? [dbId, name, by, scope] : [dbId, name, by],
    );

  beforeAll(async () => {
    const f = await setupViewsFixture(URL!, SCHEMA, { preMigrated: false });
    pool = f.pool;
    teardown = f.teardown;
    await pool.query("INSERT INTO users (id) VALUES ($1), ($2)", [u1, u2]);
    await pool.query("INSERT INTO user_databases (id, space_id) VALUES ($1, $2)", [dbId, randomUUID()]);
    await insert("Ancienne", u1);
    await pool.query(readViewScopeSql());
  });
  afterAll(async () => {
    await teardown();
  });

  it("0057 appliquée deux fois sur un schéma préexistant : idempotente", async () => {
    await expect(pool.query(readViewScopeSql())).resolves.toBeDefined();
  });

  it("les vues antérieures deviennent shared", async () => {
    const { rows } = await pool.query("SELECT scope FROM user_database_views WHERE name = 'Ancienne'");
    expect(rows[0].scope).toBe("shared");
  });

  it("deux vues personnelles de même nom pour deux auteurs : acceptées", async () => {
    await insert("Perso A", u1, "personal");
    await expect(insert("Perso A", u2, "personal")).resolves.toBeDefined();
  });

  it("deux vues personnelles de même nom pour le même auteur : rejetées", async () => {
    await insert("Perso B", u1, "personal");
    await expect(insert("Perso B", u1, "personal")).rejects.toMatchObject({ code: "23505" });
  });

  it("une vue personnelle et une partagée de même nom : acceptées", async () => {
    await insert("Mixte", u1, "shared");
    await expect(insert("Mixte", u1, "personal")).resolves.toBeDefined();
  });

  it("deux vues partagées de même nom : rejetées", async () => {
    await insert("Doublon", u1, "shared");
    await expect(insert("Doublon", u2, "shared")).rejects.toMatchObject({ code: "23505" });
  });
});
