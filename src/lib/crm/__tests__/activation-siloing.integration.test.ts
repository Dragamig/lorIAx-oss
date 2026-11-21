import { describe, it, expect, beforeAll, afterAll, beforeEach, vi } from "vitest";
import { randomUUID } from "node:crypto";
import pg from "pg";
import type { PermissionLevel } from "@/types";
import { enableTemplateTables, setupActivationFixture } from "./crm-fixture";
import { activateCrm } from "../activation";
import type { CrmDeps } from "../connection";

vi.mock("@/lib/spaces/create-space", async (orig) => ({
  ...(await orig<typeof import("@/lib/spaces/create-space")>()),
  assertSpaceQuota: vi.fn(async () => ({ exceeded: false, current: 0, max: null })),
  afterSpaceCreated: vi.fn(async () => ({ gitOk: true })),
}));

const URL = process.env.RELATIONS_TEST_DATABASE_URL;

describe.skipIf(!URL)("cloisonnement de l'activation CRM (Postgres)", () => {
  let fx: Awaited<ReturnType<typeof setupActivationFixture>>;
  let orgA: string, orgB: string;
  let spaceA: string, spaceB: string, spaceViewer: string;
  let dbA: string, dbB: string, dbViewer: string;
  const user = randomUUID();
  const levels = new Map<string, PermissionLevel | null>();
  const permissionOf = vi.fn(async (_u: string, s: string) => (levels.has(s) ? levels.get(s)! : "editor"));
  let deps: CrmDeps;
  const L = { locale: "fr" };
  const NOT_FOUND = { ok: false, status: 404, code: "not_found" };

  async function snapshot() {
    const q = async (t: string) => (await fx.pool.query(`SELECT count(*)::int AS n FROM ${t}`)).rows[0].n;
    return {
      spaces: await q("spaces"),
      dbs: await q("user_databases"),
      cols: await q("user_database_columns"),
      conn: (await fx.pool.query("SELECT * FROM crm_connections")).rows,
    };
  }

  beforeAll(async () => {
    fx = await setupActivationFixture(URL!, "rh_l6_act_silo");
    await enableTemplateTables(fx.pool);
    deps = { executor: fx.db, permissionOf };
    await fx.pool.query("INSERT INTO users (id) VALUES ($1)", [user]);
    orgA = await fx.seedOrg("Org A");
    orgB = await fx.seedOrg("Org B");
    spaceA = await fx.seedSpace(orgA, { name: "A", ownerUserId: user });
    spaceB = await fx.seedSpace(orgB, { name: "B", ownerUserId: null });
    spaceViewer = await fx.seedSpace(orgA, { name: "V", ownerUserId: null });
    dbA = await fx.seedDatabase(spaceA, "Base A", [{ name: "Nom", type: "text" }]);
    dbB = await fx.seedDatabase(spaceB, "Base B", [{ name: "Nom", type: "text" }]);
    dbViewer = await fx.seedDatabase(spaceViewer, "Base V", [{ name: "Nom", type: "text" }]);
    levels.set(spaceViewer, "viewer");
  });
  afterAll(async () => {
    await fx?.teardown();
  });
  beforeEach(async () => {
    permissionOf.mockClear();
    await fx.pool.query("DELETE FROM crm_connections");
  });

  const existingSpace = (spaceId: string) => ({ mode: "existing" as const, spaceId });

  it("spaceId d'une autre organisation : 404 muet, même corps que l'inexistant, rien d'écrit", async () => {
    const before = await snapshot();
    const foreign = await activateCrm(orgA, user, { v2: { space: existingSpace(spaceB), roles: { contacts: { mode: "create" } } }, ...L }, deps);
    const missing = await activateCrm(orgA, user, { v2: { space: existingSpace(randomUUID()), roles: { contacts: { mode: "create" } } }, ...L }, deps);
    expect(foreign).toEqual(NOT_FOUND);
    expect(missing).toEqual(foreign);
    expect(await snapshot()).toEqual(before);
    expect(permissionOf).not.toHaveBeenCalled();
  });

  it("base d'une autre organisation en connect et en complete : 404 muet, rien d'écrit", async () => {
    const before = await snapshot();
    for (const role of [{ mode: "connect" as const, databaseId: dbB }, { mode: "complete" as const, databaseId: dbB }]) {
      const r = await activateCrm(orgA, user, { v2: { space: existingSpace(spaceA), roles: { contacts: role } }, ...L }, deps);
      expect(r).toEqual(NOT_FOUND);
    }
    expect(await snapshot()).toEqual(before);
    expect(permissionOf.mock.calls.some(([, spaceId]) => spaceId === spaceB)).toBe(false);
  });

  it("spaceId éditable dans l'organisation A mais requête résolue dans B : 404 muet", async () => {
    const before = await snapshot();
    const r = await activateCrm(orgB, user, { v2: { space: existingSpace(spaceA), roles: { contacts: { mode: "create" } } }, ...L }, deps);
    expect(r).toEqual(NOT_FOUND);
    expect(await snapshot()).toEqual(before);
  });

  it("viewer sur l'espace : 403, rien d'écrit", async () => {
    const before = await snapshot();
    const r = await activateCrm(orgA, user, { v2: { space: existingSpace(spaceViewer), roles: { contacts: { mode: "create" } } }, ...L }, deps);
    expect(r).toEqual({ ok: false, status: 403, code: "forbidden" });
    const c = await activateCrm(orgA, user, { v2: { space: existingSpace(spaceA), roles: { contacts: { mode: "complete", databaseId: dbViewer } } }, ...L }, deps);
    expect(c).toEqual({ ok: false, status: 403, code: "forbidden" });
    expect(await snapshot()).toEqual(before);
  });

  it("base archivée ou supprimée : 404 en connect et en complete", async () => {
    const archived = await fx.seedDatabase(spaceA, "Archivée", [{ name: "Nom", type: "text" }]);
    const deleted = await fx.seedDatabase(spaceA, "Supprimée", [{ name: "Nom", type: "text" }]);
    await fx.pool.query("UPDATE user_databases SET archived_at = now() WHERE id=$1", [archived]);
    await fx.pool.query("UPDATE user_databases SET deleted_at = now() WHERE id=$1", [deleted]);
    const before = await snapshot();
    for (const databaseId of [archived, deleted]) {
      for (const mode of ["connect", "complete"] as const) {
        const r = await activateCrm(orgA, user, { v2: { space: existingSpace(spaceA), roles: { contacts: { mode, databaseId } } }, ...L }, deps);
        expect(r).toEqual(NOT_FOUND);
      }
    }
    expect(await snapshot()).toEqual(before);
  });

  it("base de l'organisation, éditable : raccordement accepté (témoin)", async () => {
    const r = await activateCrm(orgA, user, { v2: { space: existingSpace(spaceA), roles: { contacts: { mode: "connect", databaseId: dbA } } }, ...L }, deps);
    expect(r).toMatchObject({ ok: true });
  });

  it("connect : base d'une autre organisation ou inexistante, 404 muet sans lecture de colonnes", async () => {
    for (const databaseId of [dbB, randomUUID()]) {
      const sent: string[] = [];
      const original = pg.Client.prototype.query;
      const spy = vi.spyOn(pg.Client.prototype, "query").mockImplementation(function (this: pg.Client, ...args: unknown[]) {
        const first = args[0];
        sent.push(typeof first === "string" ? first : ((first as { text?: string })?.text ?? ""));
        return (original as (...a: unknown[]) => unknown).apply(this, args);
      } as never);
      try {
        const before = await snapshot();
        sent.length = 0;
        const r = await activateCrm(orgA, user, {
          v2: { space: existingSpace(spaceA), roles: { contacts: { mode: "connect", databaseId: dbA }, dossiers: { mode: "connect", databaseId } } },
          ...L,
        }, deps);
        expect(r).toEqual(NOT_FOUND);
        expect(sent.some((q) => /user_database_columns/i.test(q))).toBe(false);
        spy.mockRestore();
        expect(await snapshot()).toEqual(before);
      } finally {
        spy.mockRestore();
      }
    }
    expect(permissionOf.mock.calls.some(([, spaceId]) => spaceId === spaceB)).toBe(false);
  });

  it("connect : viewer sur une base de sa propre organisation, 403 sans lecture de colonnes", async () => {
    const sent: string[] = [];
    const original = pg.Client.prototype.query;
    const spy = vi.spyOn(pg.Client.prototype, "query").mockImplementation(function (this: pg.Client, ...args: unknown[]) {
      const first = args[0];
      sent.push(typeof first === "string" ? first : ((first as { text?: string })?.text ?? ""));
      return (original as (...a: unknown[]) => unknown).apply(this, args);
    } as never);
    try {
      const before = await snapshot();
      sent.length = 0;
      const r = await activateCrm(orgA, user, { v2: { space: existingSpace(spaceA), roles: { contacts: { mode: "connect", databaseId: dbViewer } } }, ...L }, deps);
      expect(r).toEqual({ ok: false, status: 403, code: "forbidden" });
      expect(sent.some((q) => /user_database_columns/i.test(q))).toBe(false);
      expect(await snapshot()).toEqual(before);
    } finally {
      spy.mockRestore();
    }
  });
});
