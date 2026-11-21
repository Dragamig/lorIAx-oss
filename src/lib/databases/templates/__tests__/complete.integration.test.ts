import { describe, it, expect, beforeAll, afterAll, vi } from "vitest";
import { randomUUID } from "node:crypto";
import pg from "pg";
import { sql } from "drizzle-orm";
import { setupActivationFixture } from "@/lib/crm/__tests__/crm-fixture";
import { completeDatabase } from "../apply";
import { TemplateFailure, type TemplateContext } from "../types";
import type { PermissionLevel } from "@/types";

const URL = process.env.RELATIONS_TEST_DATABASE_URL;

describe.skipIf(!URL)("completeDatabase (Postgres)", () => {
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

  const cols = [
    { key: "statut", name: "Statut", type: "select" as const, options: ["Nouveau", "Gagné"] },
    { key: "note", name: "Note", type: "text" as const },
  ];

  async function snapshot(dbId: string) {
    const { rows } = await fx.pool.query(
      "SELECT id, name, type, config::text AS config, position FROM user_database_columns WHERE database_id=$1 ORDER BY position, id",
      [dbId],
    );
    return rows;
  }

  beforeAll(async () => {
    fx = await setupActivationFixture(URL!, "rh_l6_act_complete");
    await fx.pool.query(`
      ALTER TABLE user_databases ALTER COLUMN id SET DEFAULT gen_random_uuid();
      ALTER TABLE user_databases
        ADD COLUMN group_id uuid, ADD COLUMN description text, ADD COLUMN icon varchar(64),
        ADD COLUMN position integer NOT NULL DEFAULT 0,
        ADD COLUMN created_by uuid,
        ADD COLUMN created_at timestamptz NOT NULL DEFAULT now(),
        ADD COLUMN updated_at timestamptz NOT NULL DEFAULT now();
    `);
    orgA = await fx.seedOrg("Org A");
    orgB = await fx.seedOrg("Org B");
  });
  afterAll(async () => {
    await fx.teardown();
  });

  it("ajoute les colonnes en fin de base avec options de sélection", async () => {
    const sp = await fx.seedSpace(orgA, { name: "S1", ownerUserId: null });
    const dbId = await fx.seedDatabase(sp, "Contacts", [{ name: "Nom", type: "text" }]);
    const ids = await fx.db.transaction((tx) =>
      completeDatabase(tx, ctx(orgA), { databaseId: dbId, columns: cols }),
    );
    const rows = await snapshot(dbId);
    expect(rows.map((r) => r.name)).toEqual(["Nom", "Statut", "Note"]);
    expect(rows.map((r) => r.position)).toEqual([0, 1, 2]);
    expect(ids.statut).toBe(rows[1].id);
    expect(JSON.parse(rows[1].config).options).toEqual(["Nouveau", "Gagné"]);
  });

  it("invariant existant intact : colonnes préexistantes identiques avant et après", async () => {
    const sp = await fx.seedSpace(orgA, { name: "S2", ownerUserId: null });
    const dbId = await fx.seedDatabase(sp, "Deals", [
      { name: "Titre", type: "text" },
      { name: "Étape", type: "select", config: { options: ["A", "B"] } },
    ]);
    const before = await snapshot(dbId);
    await fx.db.transaction((tx) => completeDatabase(tx, ctx(orgA), { databaseId: dbId, columns: cols }));
    const after = await snapshot(dbId);
    expect(after.slice(0, before.length)).toEqual(before);
    expect(after).toHaveLength(before.length + 2);
  });

  it("base d'une autre organisation : not_found, permissionOf non appelé", async () => {
    const sp = await fx.seedSpace(orgB, { name: "Autre", ownerUserId: null });
    const dbId = await fx.seedDatabase(sp, "Etrangere", []);
    const spy = vi.fn(async () => "admin" as PermissionLevel | null);
    const err = await fx.db
      .transaction((tx) =>
        completeDatabase(tx, { ...ctx(orgA), permissionOf: spy }, { databaseId: dbId, columns: cols }),
      )
      .catch((e) => e);
    expect(err).toBeInstanceOf(TemplateFailure);
    expect(err.error).toEqual({ code: "not_found" });
    expect(spy).not.toHaveBeenCalled();
    expect(await snapshot(dbId)).toEqual([]);
  });

  it("base inexistante : not_found", async () => {
    const err = await fx.db
      .transaction((tx) => completeDatabase(tx, ctx(orgA), { databaseId: randomUUID(), columns: cols }))
      .catch((e) => e);
    expect(err.error).toEqual({ code: "not_found" });
  });

  it("base archivée ou supprimée : not_found", async () => {
    const sp = await fx.seedSpace(orgA, { name: "S3", ownerUserId: null });
    const d1 = await fx.seedDatabase(sp, "Arch", []);
    const d2 = await fx.seedDatabase(sp, "Supp", []);
    await fx.pool.query("UPDATE user_databases SET archived_at = now() WHERE id=$1", [d1]);
    await fx.pool.query("UPDATE user_databases SET deleted_at = now() WHERE id=$1", [d2]);
    for (const id of [d1, d2]) {
      const err = await fx.db
        .transaction((tx) => completeDatabase(tx, ctx(orgA), { databaseId: id, columns: cols }))
        .catch((e) => e);
      expect(err.error).toEqual({ code: "not_found" });
      expect(await snapshot(id)).toEqual([]);
    }
  });

  it("base en lecture seule : forbidden", async () => {
    const sp = await fx.seedSpace(orgA, { name: "S4", ownerUserId: null });
    const dbId = await fx.seedDatabase(sp, "Lecture", []);
    level = "viewer";
    const err = await fx.db
      .transaction((tx) => completeDatabase(tx, ctx(orgA), { databaseId: dbId, columns: cols }))
      .catch((e) => e);
    level = "admin";
    expect(err.error).toEqual({ code: "forbidden" });
    expect(await snapshot(dbId)).toEqual([]);
  });

  it("nom déjà pris (casse, accents, bords) : name_collision, rien écrit", async () => {
    const sp = await fx.seedSpace(orgA, { name: "S5", ownerUserId: null });
    const dbId = await fx.seedDatabase(sp, "Coll", [{ name: "  statüt ", type: "text" }]);
    const before = await snapshot(dbId);
    const err = await fx.db
      .transaction((tx) => completeDatabase(tx, ctx(orgA), { databaseId: dbId, columns: cols }))
      .catch((e) => e);
    expect(err.error).toEqual({ code: "name_collision", key: "statut" });
    expect(await snapshot(dbId)).toEqual(before);
  });

  it("aucun UPDATE ni DELETE n'est émis (SQL réellement envoyé au driver)", async () => {
    const sp = await fx.seedSpace(orgA, { name: "S6", ownerUserId: null });
    const dbId = await fx.seedDatabase(sp, "Spy", [{ name: "Nom", type: "text" }]);
    const sent: string[] = [];
    const original = pg.Client.prototype.query;
    const spy = vi.spyOn(pg.Client.prototype, "query").mockImplementation(function (
      this: pg.Client,
      ...args: unknown[]
    ) {
      const first = args[0];
      sent.push(typeof first === "string" ? first : ((first as { text?: string })?.text ?? ""));
      return (original as (...a: unknown[]) => unknown).apply(this, args);
    } as never);
    try {
      await fx.db.transaction((tx) => completeDatabase(tx, ctx(orgA), { databaseId: dbId, columns: cols }));
      const real = sent.filter((q) => /^\s*(update|delete)\b/i.test(q));
      expect(sent.some((q) => /^\s*insert\b/i.test(q))).toBe(true);
      expect(real).toEqual([]);
      // témoin positif : une requête UPDATE volontaire est bien captée
      sent.length = 0;
      await fx.db.transaction((tx) =>
        tx.execute(sql`UPDATE user_databases SET name = name WHERE id = ${dbId}`),
      );
      expect(sent.some((q) => /^\s*update\b/i.test(q))).toBe(true);
    } finally {
      spy.mockRestore();
    }
    expect((await snapshot(dbId)).length).toBe(3);
  });

  it("permissionOf renvoie null : forbidden", async () => {
    const sp = await fx.seedSpace(orgA, { name: "S7", ownerUserId: null });
    const dbId = await fx.seedDatabase(sp, "Null", []);
    level = null;
    const err = await fx.db
      .transaction((tx) => completeDatabase(tx, ctx(orgA), { databaseId: dbId, columns: cols }))
      .catch((e) => e);
    level = "admin";
    expect(err.error).toEqual({ code: "forbidden" });
    expect(await snapshot(dbId)).toEqual([]);
  });
});
