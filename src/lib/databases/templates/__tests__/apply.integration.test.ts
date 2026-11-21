import { describe, it, expect, beforeAll, afterAll, vi } from "vitest";
import { randomUUID } from "node:crypto";
import { setupActivationFixture } from "@/lib/crm/__tests__/crm-fixture";
import { applyTemplate } from "../apply";
import { insertColumns } from "../columns";
import { TemplateFailure, type TemplateContext, type TemplateSpec } from "../types";
import type { PermissionLevel } from "@/types";

const URL = process.env.RELATIONS_TEST_DATABASE_URL;

describe.skipIf(!URL)("applyTemplate (Postgres)", () => {
  let fx: Awaited<ReturnType<typeof setupActivationFixture>>;
  let orgA: string;
  let orgB: string;
  const userId = randomUUID();
  let level: PermissionLevel | null = "admin";

  const ctx = (orgId: string): TemplateContext => ({
    orgId,
    userId,
    permissionOf: async () => level,
  });

  const spec = (space: TemplateSpec["space"]): TemplateSpec => ({
    space,
    databases: [
      {
        key: "a",
        name: "Contacts",
        columns: [
          { key: "nom", name: "Nom", type: "text" },
          { key: "statut", name: "Statut", type: "select", options: ["Nouveau", "Gagné"] },
        ],
      },
      { key: "b", name: "Deals", columns: [{ key: "t", name: "Titre", type: "text" }] },
    ],
  });

  async function count(table: string, where = "true", params: unknown[] = []) {
    const { rows } = await fx.pool.query(`SELECT count(*)::int AS n FROM ${table} WHERE ${where}`, params);
    return rows[0].n as number;
  }

  beforeAll(async () => {
    fx = await setupActivationFixture(URL!, "rh_l6_act_tpl");
    await fx.pool.query(`
      ALTER TABLE spaces ALTER COLUMN id SET DEFAULT gen_random_uuid();
      ALTER TABLE spaces
        ADD COLUMN slug varchar(255) NOT NULL DEFAULT '',
        ADD COLUMN type text NOT NULL DEFAULT 'personal',
        ADD COLUMN description text,
        ADD COLUMN owner_team_id uuid,
        ADD COLUMN git_repo_path varchar(512) NOT NULL DEFAULT '',
        ADD COLUMN classification text NOT NULL DEFAULT 'internal',
        ADD COLUMN icon varchar(50),
        ADD COLUMN appearance_preset jsonb,
        ADD COLUMN is_demo boolean NOT NULL DEFAULT false,
        ADD COLUMN created_at timestamptz NOT NULL DEFAULT now(),
        ADD COLUMN updated_at timestamptz NOT NULL DEFAULT now();
      ALTER TABLE user_databases ALTER COLUMN id SET DEFAULT gen_random_uuid();
      ALTER TABLE user_databases
        ADD COLUMN group_id uuid, ADD COLUMN description text, ADD COLUMN icon varchar(64),
        ADD COLUMN position integer NOT NULL DEFAULT 0,
        ADD COLUMN created_by uuid,
        ADD COLUMN created_at timestamptz NOT NULL DEFAULT now(),
        ADD COLUMN updated_at timestamptz NOT NULL DEFAULT now();
    `);
    await fx.pool.query("INSERT INTO users (id, name) VALUES ($1, 'Admin')", [userId]);
    orgA = await fx.seedOrg("Org A");
    orgB = await fx.seedOrg("Org B");
  });
  afterAll(async () => {
    await fx.teardown();
  });

  it("crée l'espace dans l'organisation, les bases et colonnes dans l'ordre", async () => {
    const res = await fx.db.transaction((tx) =>
      applyTemplate(tx, ctx(orgA), spec({ mode: "create", name: "Espace CRM" })),
    );
    expect(res.spaceCreated).toBe(true);
    const { rows: sp } = await fx.pool.query("SELECT organization_id, owner_user_id FROM spaces WHERE id=$1", [res.spaceId]);
    expect(sp[0].organization_id).toBe(orgA);
    expect(sp[0].owner_user_id).toBe(userId);
    const { rows: dbs } = await fx.pool.query("SELECT id, name, position FROM user_databases WHERE space_id=$1 ORDER BY position", [res.spaceId]);
    expect(dbs.map((d) => d.name)).toEqual(["Contacts", "Deals"]);
    expect(res.databases.a.id).toBe(dbs[0].id);
    const { rows: cols } = await fx.pool.query("SELECT id, name, position FROM user_database_columns WHERE database_id=$1 ORDER BY position", [res.databases.a.id]);
    expect(cols.map((c) => c.name)).toEqual(["Nom", "Statut"]);
    expect(cols.map((c) => c.position)).toEqual([0, 1]);
    expect(res.databases.a.columns.statut).toBe(cols[1].id);
  });

  it("les options d'une colonne select sont stockées", async () => {
    const res = await fx.db.transaction((tx) =>
      applyTemplate(tx, ctx(orgA), spec({ mode: "create", name: "Espace Options" })),
    );
    const { rows } = await fx.pool.query("SELECT config FROM user_database_columns WHERE id=$1", [res.databases.a.columns.statut]);
    expect(rows[0].config.options).toEqual(["Nouveau", "Gagné"]);
  });

  it("espace existant d'une autre organisation : not_found, rien écrit", async () => {
    const foreign = await fx.seedSpace(orgB, { name: "Autre", ownerUserId: null });
    const before = await count("user_databases");
    const spy = vi.fn(async () => "viewer" as PermissionLevel | null);
    const err = await fx.db
      .transaction((tx) =>
        applyTemplate(tx, { ...ctx(orgA), permissionOf: spy }, spec({ mode: "existing", spaceId: foreign })),
      )
      .catch((e) => e);
    expect(err).toBeInstanceOf(TemplateFailure);
    expect(err.error).toEqual({ code: "not_found" });
    expect(spy).not.toHaveBeenCalled();
    expect(await count("user_databases")).toBe(before);
  });

  it("espace existant en lecture seule : forbidden", async () => {
    const sp = await fx.seedSpace(orgA, { name: "Lecture", ownerUserId: null });
    level = "viewer";
    const err = await fx.db
      .transaction((tx) => applyTemplate(tx, ctx(orgA), spec({ mode: "existing", spaceId: sp })))
      .catch((e) => e);
    level = "admin";
    expect(err.error).toEqual({ code: "forbidden" });
    expect(await count("user_databases", "space_id=$1", [sp])).toBe(0);
  });

  it("nom de base déjà présent (casse, accents et espaces différents) : name_collision, rien écrit", async () => {
    const sp = await fx.seedSpace(orgA, { name: "Coll", ownerUserId: null });
    await fx.seedDatabase(sp, "  contàcts ", []);
    const err = await fx.db
      .transaction((tx) => applyTemplate(tx, ctx(orgA), spec({ mode: "existing", spaceId: sp })))
      .catch((e) => e);
    expect(err.error).toEqual({ code: "name_collision", key: "a" });
    expect(await count("user_databases", "space_id=$1", [sp])).toBe(1);
  });

  it("une base archivée ou supprimée ne bloque pas la création du même nom", async () => {
    const sp = await fx.seedSpace(orgA, { name: "Archives", ownerUserId: null });
    const d1 = await fx.seedDatabase(sp, "Contacts", []);
    const d2 = await fx.seedDatabase(sp, "Deals", []);
    await fx.pool.query("UPDATE user_databases SET archived_at = now() WHERE id=$1", [d1]);
    await fx.pool.query("UPDATE user_databases SET deleted_at = now() WHERE id=$1", [d2]);
    const res = await fx.db.transaction((tx) =>
      applyTemplate(tx, ctx(orgA), spec({ mode: "existing", spaceId: sp })),
    );
    expect(Object.keys(res.databases)).toEqual(["a", "b"]);
  });

  it("échec en cours de route dans une transaction : aucun espace ni base", async () => {
    const bad: TemplateSpec = {
      space: { mode: "create", name: "Espace Échec" },
      databases: [
        { key: "a", name: "Dup", columns: [] },
        { key: "b", name: "dup", columns: [] },
      ],
    };
    const err = await fx.db.transaction((tx) => applyTemplate(tx, ctx(orgA), bad)).catch((e) => e);
    expect(err.error).toEqual({ code: "name_collision", key: "b" });
    expect(await count("spaces", "name=$1", ["Espace Échec"])).toBe(0);
    expect(await count("user_databases", "name='Dup'")).toBe(0);
  });

  it("aucune écriture hors de l'organisation de ctx", async () => {
    const before = await count("spaces", "organization_id=$1", [orgB]);
    await fx.db.transaction((tx) => applyTemplate(tx, ctx(orgA), spec({ mode: "create", name: "Espace Iso" })));
    expect(await count("spaces", "organization_id=$1", [orgB])).toBe(before);
    expect(await count("spaces", "name=$1 AND organization_id=$2", ["Espace Iso", orgA])).toBe(1);
  });

  it("position des bases créées : max(position)+1 de l'espace, bases archivées comprises", async () => {
    const sp = await fx.seedSpace(orgA, { name: "Positions", ownerUserId: null });
    const base = await fx.seedDatabase(sp, "Existante", [{ name: "Nom", type: "text" }]);
    await fx.pool.query("UPDATE user_databases SET position = 7, archived_at = now() WHERE id=$1", [base]);
    const r = await fx.db.transaction((tx) =>
      applyTemplate(tx, ctx(orgA), { space: { mode: "existing", spaceId: sp }, databases: [{ key: "x", name: "Nouvelle", columns: [{ key: "n", name: "Nom", type: "text" }] }, { key: "y", name: "Autre", columns: [] }] }),
    );
    const { rows } = await fx.pool.query("SELECT id, position FROM user_databases WHERE space_id=$1", [sp]);
    const pos = Object.fromEntries(rows.map((x) => [x.id, x.position]));
    expect(pos[r.databases.x.id]).toBe(8);
    expect(pos[r.databases.y.id]).toBe(9);
  });

  it("insertColumns : refuse une colonne relation et retire les liens de config", async () => {
    const sp = await fx.seedSpace(orgA, { name: "Garde-fou", ownerUserId: null });
    const db = await fx.seedDatabase(sp, "G", []);
    await expect(
      fx.db.transaction((tx) => insertColumns(tx, db, [{ key: "r", name: "R", type: "relation" }])),
    ).rejects.toThrow(/pairRelation/);
    const ids = await fx.db.transaction((tx) =>
      insertColumns(tx, db, [
        { key: "t", name: "T", type: "text", config: { targetDatabaseId: "x", inverseColumnId: "y", keep: 1 } },
      ]),
    );
    const { rows } = await fx.pool.query("SELECT config FROM user_database_columns WHERE id=$1", [ids.t]);
    expect(rows[0].config).toEqual({ keep: 1 });
  });
});
