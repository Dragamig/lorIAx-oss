/**
 * listEditableSpaces et findCollisions contre la vraie base (schéma rh_l6_act_preview).
 * La permission d'espace est injectée : seul le contrôle d'organisation SQL est éprouvé ici.
 */
import { describe, it, expect, vi, beforeAll, afterAll } from "vitest";
import { randomUUID } from "node:crypto";
import { setupActivationFixture } from "./crm-fixture";

const h = vi.hoisted(() => ({ db: undefined as unknown }));
vi.mock("@/lib/db", () => ({
  db: new Proxy({}, { get: (_t, k) => (h.db as Record<string | symbol, unknown>)[k] }),
}));
vi.mock("@/lib/auth/get-user", () => ({ getSessionUser: vi.fn(async () => null) }));

import { findCollisions, listEditableSpaces } from "../preview";
import type { CrmDeps } from "../connection";

const URL = process.env.RELATIONS_TEST_DATABASE_URL;

describe.skipIf(!URL)("aperçu CRM : espaces et collisions (Postgres)", () => {
  let fx: Awaited<ReturnType<typeof setupActivationFixture>>;
  let deps: CrmDeps;
  let orgA: string, orgB: string, sEdit: string, sView: string, sOther: string;
  const user = randomUUID();
  const asked: string[] = [];

  beforeAll(async () => {
    fx = await setupActivationFixture(URL!, "rh_l6_act_preview");
    h.db = fx.db;
    await fx.pool.query("INSERT INTO users (id) VALUES ($1)", [user]);
    orgA = await fx.seedOrg("A");
    orgB = await fx.seedOrg("B");
    sEdit = await fx.seedSpace(orgA, { name: "CRM", ownerUserId: null });
    sView = await fx.seedSpace(orgA, { name: "Lecture", ownerUserId: null });
    sOther = await fx.seedSpace(orgB, { name: "Secret B", ownerUserId: null });
    deps = {
      executor: fx.db,
      permissionOf: async (_u, s) => {
        asked.push(s);
        return s === sView ? "viewer" : "admin";
      },
    } as CrmDeps;
  });
  afterAll(async () => {
    await fx?.teardown();
  });

  it("ne rend que les espaces de l'organisation où l'utilisateur est editor, sans interroger la permission des autres organisations", async () => {
    const out = await listEditableSpaces(orgA, user, deps);
    expect(out).toEqual([{ id: sEdit, name: "CRM" }]);
    expect(asked).not.toContain(sOther);
  });

  it("collisions : nom normalisé (casse, accents, espaces), hors archivées et supprimées, hors autres espaces", async () => {
    await fx.seedDatabase(sEdit, "  CONTACTS ", []);
    const archived = await fx.seedDatabase(sEdit, "Dossiers", []);
    await fx.pool.query("UPDATE user_databases SET archived_at = now() WHERE id = $1", [archived]);
    const gone = await fx.seedDatabase(sEdit, "Interactions", []);
    await fx.pool.query("UPDATE user_databases SET deleted_at = now() WHERE id = $1", [gone]);
    await fx.seedDatabase(sView, "Dossiers", []);
    const out = await findCollisions(sEdit, { contacts: "Contacts", dossiers: "Dossiers", interactions: "Interactions" }, deps);
    expect(out.contacts).toHaveLength(1);
    expect(out.contacts[0].name).toBe("  CONTACTS ");
    expect(out.dossiers).toEqual([]);
    expect(out.interactions).toEqual([]);
  });

  it("espace null : aucune collision", async () => {
    const out = await findCollisions(null, { contacts: "Contacts", dossiers: "Dossiers", interactions: "Interactions" }, deps);
    expect(out).toEqual({ contacts: [], dossiers: [], interactions: [] });
  });
});
