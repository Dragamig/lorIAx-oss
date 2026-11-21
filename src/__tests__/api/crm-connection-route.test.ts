import { describe, it, expect, vi, beforeEach } from "vitest";
import { NextRequest, NextResponse } from "next/server";

const h = vi.hoisted(() => ({
  access: "ok" as "ok" | "404" | "403",
  isAdmin: false,
  save: { ok: true } as { ok: true } | { ok: false; status: 400 | 404; code: string },
  saveArgs: undefined as unknown,
  loadCalls: [] as unknown[][],
}));

const conn = {
  enabled: true,
  okTotal: 3,
  badTotal: 0,
  complete: false,
  roles: {
    contacts: { role: "contacts", connected: true, databaseId: "d1", databaseName: "Contacts", fields: {}, ok: 3, total: 7, bad: 0, complete: false },
    dossiers: { role: "dossiers", connected: false, fields: {}, ok: 0, total: 7, bad: 0, complete: false },
    interactions: { role: "interactions", connected: false, fields: {}, ok: 0, total: 3, bad: 0, complete: false },
  },
};

vi.mock("@/lib/crm/access", () => ({
  requireCrm: vi.fn(async (opts: { level: string }) => {
    if (h.access === "404") return { ok: false, response: NextResponse.json({ error: "Introuvable" }, { status: 404 }) };
    if (opts.level === "admin" && !h.isAdmin)
      return { ok: false, response: NextResponse.json({ error: "Accès refusé" }, { status: 403 }) };
    return { ok: true, user: { id: "u1" }, orgId: "org1", isAdmin: h.isAdmin, enabled: true };
  }),
}));
vi.mock("@/lib/crm/connection", () => ({
  loadConnection: vi.fn(async (...a: unknown[]) => {
    h.loadCalls.push(a);
    return conn;
  }),
  saveConnection: vi.fn(async (...a: unknown[]) => {
    h.saveArgs = a;
    return h.save;
  }),
}));

import { GET, PUT } from "@/app/api/crm/connection/route";

const COL = "11111111-1111-4111-8111-111111111111";
const DB = "22222222-2222-4222-8222-222222222222";
const put = (body: unknown) =>
  PUT(new NextRequest("http://x/api/crm/connection", { method: "PUT", body: JSON.stringify(body) }));
const get = () => GET(new NextRequest("http://x/api/crm/connection"));

beforeEach(() => {
  h.access = "ok";
  h.isAdmin = false;
  h.save = { ok: true };
  h.saveArgs = undefined;
  h.loadCalls = [];
});

describe("GET /api/crm/connection", () => {
  it("sans module : 404", async () => {
    h.access = "404";
    expect((await get()).status).toBe(404);
  });
  it("membre : 200 avec roles et canAdmin false", async () => {
    const res = await get();
    const j = await res.json();
    expect(res.status).toBe(200);
    expect(j.canAdmin).toBe(false);
    expect(Object.keys(j.roles)).toEqual(["contacts", "dossiers", "interactions"]);
    expect(h.loadCalls[0].slice(0, 3)).toEqual(["org1", "u1", "viewer"]);
  });
  it("ne contient jamais le nom d'une base illisible", async () => {
    const j = await (await get()).json();
    expect(j.roles.dossiers.databaseName).toBeUndefined();
    expect(j.roles.dossiers.databaseId).toBeUndefined();
  });
});

describe("PUT /api/crm/connection", () => {
  it("membre non admin : 403", async () => {
    expect((await put({ roles: {}, fieldMap: {} })).status).toBe(403);
  });
  it("corps invalide (clé de champ inconnue) : 400 invalid_body", async () => {
    h.isAdmin = true;
    const res = await put({ roles: {}, fieldMap: { contacts: { inconnu: COL } } });
    expect(res.status).toBe(400);
    expect((await res.json()).code).toBe("invalid_body");
    expect(h.saveArgs).toBeUndefined();
  });
  it("base refusée : 404 au corps identique à une base inexistante", async () => {
    h.isAdmin = true;
    h.save = { ok: false, status: 404, code: "not_found" };
    const res = await put({ roles: { contacts: DB }, fieldMap: {} });
    expect(res.status).toBe(404);
    expect(await res.json()).toEqual({ error: "Introuvable" });
  });
  it("colonne d'une autre base : 400 column_not_in_database", async () => {
    h.isAdmin = true;
    h.save = { ok: false, status: 400, code: "column_not_in_database" };
    const res = await put({ roles: { contacts: DB }, fieldMap: { contacts: { nom: COL } } });
    expect(res.status).toBe(400);
    expect((await res.json()).code).toBe("column_not_in_database");
  });
  it("doublon de base : 400 duplicate_database", async () => {
    h.isAdmin = true;
    h.save = { ok: false, status: 400, code: "duplicate_database" };
    const res = await put({ roles: { contacts: DB, dossiers: DB }, fieldMap: {} });
    expect(res.status).toBe(400);
    expect((await res.json()).code).toBe("duplicate_database");
  });
  it("identifiant de base non UUID : 400 invalid_body", async () => {
    h.isAdmin = true;
    const res = await put({ roles: { contacts: "pas-un-uuid" }, fieldMap: {} });
    expect(res.status).toBe(400);
    expect((await res.json()).code).toBe("invalid_body");
  });
  it("valide : 200 et réponse relue par loadConnection", async () => {
    h.isAdmin = true;
    const res = await put({ roles: { contacts: DB }, fieldMap: {} });
    expect(res.status).toBe(200);
    const j = await res.json();
    expect(j.canAdmin).toBe(true);
    expect(j.roles.contacts.databaseName).toBe("Contacts");
    expect(h.loadCalls).toHaveLength(1);
    expect((h.saveArgs as unknown[])[0]).toBe("org1");
  });
});
