import { describe, it, expect, beforeAll, afterAll, vi } from "vitest";
import { randomUUID } from "node:crypto";
import { eq } from "drizzle-orm";
import { setupActivationFixture } from "@/lib/crm/__tests__/crm-fixture";
import { userDatabaseColumns } from "@/lib/db/schema";
import { findPairedInverse } from "../../relation-columns";
import { pairRelation } from "../relations";
import { TemplateFailure, type TemplateContext } from "../types";
import type { PermissionLevel } from "@/types";

const URL = process.env.RELATIONS_TEST_DATABASE_URL;

describe.skipIf(!URL)("pairRelation (Postgres)", () => {
  let fx: Awaited<ReturnType<typeof setupActivationFixture>>;
  let orgA: string;
  let orgB: string;
  const userId = randomUUID();
  const levels = new Map<string, PermissionLevel | null>();
  const defaultLevel: PermissionLevel | null = "admin";

  const ctx = (orgId: string, permissionOf?: TemplateContext["permissionOf"]): TemplateContext => ({
    orgId,
    userId,
    permissionOf: permissionOf ?? (async (_u, spaceId) => (levels.has(spaceId) ? levels.get(spaceId)! : defaultLevel)),
  });

  async function snapshot(...dbIds: string[]) {
    const out = [];
    for (const id of dbIds) {
      const { rows } = await fx.pool.query(
        "SELECT id, name, type, config::text AS config, position FROM user_database_columns WHERE database_id=$1 ORDER BY position, id",
        [id],
      );
      out.push(rows);
    }
    return out;
  }

  async function seedPair(org: string, label: string) {
    const spA = await fx.seedSpace(org, { name: `${label}-A`, ownerUserId: null });
    const spB = await fx.seedSpace(org, { name: `${label}-B`, ownerUserId: null });
    const dossiers = await fx.seedDatabase(spA, "Dossiers", [{ name: "Titre", type: "text" }]);
    const contacts = await fx.seedDatabase(spB, "Contacts", [{ name: "Nom", type: "text" }]);
    return { spA, spB, dossiers, contacts };
  }

  beforeAll(async () => {
    fx = await setupActivationFixture(URL!, "rh_l6_act_rel");
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

  it("crée la paire Dossiers.Contact et Contacts.Dossiers liées par inverseColumnId", async () => {
    const s = await seedPair(orgA, "t1");
    const r = await fx.db.transaction((tx) =>
      pairRelation(tx, ctx(orgA), {
        databaseId: s.dossiers,
        name: "Contact",
        targetDatabaseId: s.contacts,
        inverseName: "Dossiers",
      }),
    );
    expect(r.created).toBe("both");
    const [col] = await fx.db.select().from(userDatabaseColumns).where(eq(userDatabaseColumns.id, r.columnId));
    const [inv] = await fx.db.select().from(userDatabaseColumns).where(eq(userDatabaseColumns.id, r.inverseColumnId));
    expect(col.databaseId).toBe(s.dossiers);
    expect(inv.databaseId).toBe(s.contacts);
    expect((col.config as Record<string, unknown>).inverseColumnId).toBe(inv.id);
    expect((inv.config as Record<string, unknown>).inverseColumnId).toBe(col.id);
    expect((col.config as Record<string, unknown>).targetDatabaseId).toBe(s.contacts);
  });

  it("colonne relation existante d'un seul côté : seule l'inverse est ajoutée, la colonne existante est intacte", async () => {
    const s = await seedPair(orgA, "t2");
    const { rows } = await fx.pool.query(
      "INSERT INTO user_database_columns (database_id, name, type, config, position) VALUES ($1,'Dossier','relation',$2,1) RETURNING id",
      [s.dossiers, JSON.stringify({ targetDatabaseId: s.contacts, allowMultiple: true, custom: "x" })],
    );
    const existingId = rows[0].id as string;
    const [beforeExisting] = (await snapshot(s.dossiers))[0].filter((c) => c.id === existingId);
    const beforeTarget = (await snapshot(s.contacts))[0];

    const r = await fx.db.transaction((tx) =>
      pairRelation(tx, ctx(orgA), {
        databaseId: s.dossiers,
        columnId: existingId,
        name: "Dossier",
        targetDatabaseId: s.contacts,
        inverseName: "Dossiers",
      }),
    );
    expect(r.created).toBe("inverse-only");
    expect(r.columnId).toBe(existingId);

    const [afterExisting] = (await snapshot(s.dossiers))[0].filter((c) => c.id === existingId);
    expect(afterExisting.name).toBe(beforeExisting.name);
    expect(afterExisting.type).toBe(beforeExisting.type);
    expect(afterExisting.position).toBe(beforeExisting.position);
    const cfgBefore = JSON.parse(beforeExisting.config);
    const cfgAfter = JSON.parse(afterExisting.config);
    expect(cfgAfter).toEqual({ ...cfgBefore, inverseColumnId: r.inverseColumnId });
    // aucune colonne ajoutée côté source ; une seule côté cible, anciennes intactes
    expect((await snapshot(s.dossiers))[0]).toHaveLength(3 - 1);
    const afterTarget = (await snapshot(s.contacts))[0];
    expect(afterTarget.slice(0, beforeTarget.length)).toEqual(beforeTarget);
    expect(afterTarget).toHaveLength(beforeTarget.length + 1);

    const [col] = await fx.db.select().from(userDatabaseColumns).where(eq(userDatabaseColumns.id, existingId));
    const [inv] = await fx.db.select().from(userDatabaseColumns).where(eq(userDatabaseColumns.id, r.inverseColumnId));
    expect((await findPairedInverse(fx.db, col))?.id).toBe(inv.id);
    expect((await findPairedInverse(fx.db, inv))?.id).toBe(col.id);
  });

  it("déjà jumelées : none, rien écrit", async () => {
    const s = await seedPair(orgA, "t3");
    const first = await fx.db.transaction((tx) =>
      pairRelation(tx, ctx(orgA), {
        databaseId: s.dossiers, name: "Contact", targetDatabaseId: s.contacts, inverseName: "Dossiers",
      }),
    );
    const before = await snapshot(s.dossiers, s.contacts);
    const r = await fx.db.transaction((tx) =>
      pairRelation(tx, ctx(orgA), {
        databaseId: s.dossiers, columnId: first.columnId, name: "Contact",
        targetDatabaseId: s.contacts, inverseName: "Dossiers",
      }),
    );
    expect(r).toEqual({ columnId: first.columnId, inverseColumnId: first.inverseColumnId, created: "none" });
    expect(await snapshot(s.dossiers, s.contacts)).toEqual(before);
  });

  it("colonne dont inverseColumnId pointe ailleurs : refus relation_conflict, rien écrit", async () => {
    const s = await seedPair(orgA, "t4");
    const other = await fx.pool.query(
      "INSERT INTO user_database_columns (database_id, name, type, config, position) VALUES ($1,'Autre','relation','{}',5) RETURNING id",
      [s.contacts],
    );
    const { rows } = await fx.pool.query(
      "INSERT INTO user_database_columns (database_id, name, type, config, position) VALUES ($1,'Dossier','relation',$2,1) RETURNING id",
      [s.dossiers, JSON.stringify({ targetDatabaseId: s.contacts, inverseColumnId: other.rows[0].id })],
    );
    const before = await snapshot(s.dossiers, s.contacts);
    const err = await fx.db
      .transaction((tx) =>
        pairRelation(tx, ctx(orgA), {
          databaseId: s.dossiers, columnId: rows[0].id, name: "Dossier",
          targetDatabaseId: s.contacts, inverseName: "Dossiers",
        }),
      )
      .catch((e) => e);
    expect(err).toBeInstanceOf(TemplateFailure);
    expect(err.error).toEqual({ code: "relation_conflict" });
    expect(await snapshot(s.dossiers, s.contacts)).toEqual(before);
  });

  it("colonne existante qui cible une autre base : relation_conflict, rien écrit", async () => {
    const s = await seedPair(orgA, "t5");
    const third = await fx.seedDatabase(s.spA, "Tiers", []);
    const { rows } = await fx.pool.query(
      "INSERT INTO user_database_columns (database_id, name, type, config, position) VALUES ($1,'Dossier','relation',$2,1) RETURNING id",
      [s.dossiers, JSON.stringify({ targetDatabaseId: third })],
    );
    const before = await snapshot(s.dossiers, s.contacts);
    const err = await fx.db
      .transaction((tx) =>
        pairRelation(tx, ctx(orgA), {
          databaseId: s.dossiers, columnId: rows[0].id, name: "Dossier",
          targetDatabaseId: s.contacts, inverseName: "Dossiers",
        }),
      )
      .catch((e) => e);
    expect(err.error).toEqual({ code: "relation_conflict" });
    expect(await snapshot(s.dossiers, s.contacts)).toEqual(before);
  });

  it("nom d'inverse déjà pris : name_collision, rien écrit", async () => {
    const s = await seedPair(orgA, "t6");
    const before = await snapshot(s.dossiers, s.contacts);
    const err = await fx.db
      .transaction((tx) =>
        pairRelation(tx, ctx(orgA), {
          databaseId: s.dossiers, name: "Contact", targetDatabaseId: s.contacts, inverseName: " nom ",
        }),
      )
      .catch((e) => e);
    expect(err.error).toEqual({ code: "name_collision", key: "inverse" });
    expect(await snapshot(s.dossiers, s.contacts)).toEqual(before);
  });

  it("base cible d'une autre organisation : not_found, permissionOf non appelé pour elle, rien écrit", async () => {
    const s = await seedPair(orgA, "t7");
    const spX = await fx.seedSpace(orgB, { name: "t7-X", ownerUserId: null });
    const foreign = await fx.seedDatabase(spX, "Etrangere", []);
    const spy = vi.fn(async () => "admin" as PermissionLevel | null);
    const before = await snapshot(s.dossiers, foreign);
    const err = await fx.db
      .transaction((tx) =>
        pairRelation(tx, ctx(orgA, spy), {
          databaseId: s.dossiers, name: "Contact", targetDatabaseId: foreign, inverseName: "Dossiers",
        }),
      )
      .catch((e) => e);
    expect(err.error).toEqual({ code: "not_found" });
    expect(spy).not.toHaveBeenCalledWith(userId, spX);
    expect(await snapshot(s.dossiers, foreign)).toEqual(before);
  });

  it("base source d'une autre organisation : not_found", async () => {
    const s = await seedPair(orgA, "t8");
    const spX = await fx.seedSpace(orgB, { name: "t8-X", ownerUserId: null });
    const foreign = await fx.seedDatabase(spX, "Etrangere", []);
    const err = await fx.db
      .transaction((tx) =>
        pairRelation(tx, ctx(orgA), {
          databaseId: foreign, name: "Contact", targetDatabaseId: s.contacts, inverseName: "Dossiers",
        }),
      )
      .catch((e) => e);
    expect(err.error).toEqual({ code: "not_found" });
  });

  it("base cible en lecture seule : forbidden, toute la transaction annulée", async () => {
    const s = await seedPair(orgA, "t9");
    levels.set(s.spB, "viewer");
    const before = await snapshot(s.dossiers, s.contacts);
    const err = await fx.db
      .transaction((tx) =>
        pairRelation(tx, ctx(orgA), {
          databaseId: s.dossiers, name: "Contact", targetDatabaseId: s.contacts, inverseName: "Dossiers",
        }),
      )
      .catch((e) => e);
    expect(err.error).toEqual({ code: "forbidden" });
    expect(await snapshot(s.dossiers, s.contacts)).toEqual(before);
  });

  it("base source en lecture seule : forbidden", async () => {
    const s = await seedPair(orgA, "t10");
    levels.set(s.spA, "viewer");
    const err = await fx.db
      .transaction((tx) =>
        pairRelation(tx, ctx(orgA), {
          databaseId: s.dossiers, name: "Contact", targetDatabaseId: s.contacts, inverseName: "Dossiers",
        }),
      )
      .catch((e) => e);
    expect(err.error).toEqual({ code: "forbidden" });
  });

  it("auto-relation (même base des deux côtés) : refus, rien écrit", async () => {
    const s = await seedPair(orgA, "auto");
    const before = await snapshot(s.dossiers);
    const err = await fx.db
      .transaction((tx) =>
        pairRelation(tx, ctx(orgA), { databaseId: s.dossiers, name: "Moi", targetDatabaseId: s.dossiers, inverseName: "Moi inverse" }),
      )
      .catch((e) => e);
    expect(err).toBeInstanceOf(TemplateFailure);
    expect(await snapshot(s.dossiers)).toEqual(before);
  });
});
