import { describe, it, expect, vi, beforeEach } from "vitest";
import { NextRequest } from "next/server";

const h = vi.hoisted(() => ({
  user: null as unknown,
  orgId: "org-1" as string | null,
  store: new Map<string, unknown>(),
}));

vi.mock("@/lib/auth/get-user", () => ({ getSessionUser: vi.fn(async () => h.user) }));
vi.mock("@/lib/org/get-request-org", () => ({ getRequestOrgId: vi.fn(async () => h.orgId) }));
const audit = vi.hoisted(() => vi.fn());
vi.mock("@/lib/audit/log", () => ({ auditLog: audit }));
vi.mock("@/lib/rate-limit", () => ({ getClientIp: () => "192.0.2.1" }));
vi.mock("@/lib/settings/system-settings", () => ({
  getSetting: vi.fn(async (k: string) => h.store.get(k) ?? null),
  setSetting: vi.fn(async (k: string, v: unknown) => {
    h.store.set(k, v);
  }),
}));

import { GET, PUT } from "../route";

const ALL = {
  actionsEnabled: true,
  readDatabases: true,
  proposeUpdates: true,
  proposeDeletes: true,
  proposeMerges: true,
  proposeCreates: true,
  proposeSpreadsheets: true,
  proposeDocuments: true,
  proposePresentations: true,
};
const put = (body: unknown) =>
  PUT(new NextRequest("http://localhost/api/admin/ai/chat-actions", { method: "PUT", body: JSON.stringify(body) }));

beforeEach(() => {
  h.user = { id: "u1", globalRole: "admin" };
  h.orgId = "org-1";
  h.store.clear();
  audit.mockReset();
});

describe("/api/admin/ai/chat-actions", () => {
  it("non connecté, ou rôle insuffisant : 403, rien d'écrit", async () => {
    for (const u of [null, { id: "u", globalRole: "user" }, { id: "u", globalRole: "editor" }]) {
      h.user = u;
      expect((await GET()).status).toBe(403);
      expect((await put(ALL)).status).toBe(403);
    }
    expect(h.store.size).toBe(0);
  });

  it("organisation non résolue : 404 muet en lecture et en écriture", async () => {
    h.orgId = null;
    expect((await GET()).status).toBe(404);
    expect((await put(ALL)).status).toBe(404);
    expect(h.store.size).toBe(0);
  });

  it("GET : défauts prudents quand rien n'est stocké", async () => {
    const res = await GET();
    expect(res.status).toBe(200);
    expect(await res.json()).toEqual({ ...ALL, proposeDeletes: false, proposeMerges: false, proposePresentations: false });
  });

  it("PUT écrit sous la clé de l'organisation de la session et GET le relit", async () => {
    const next = { ...ALL, proposeDeletes: false, actionsEnabled: false };
    const res = await put(next);
    expect(res.status).toBe(200);
    expect([...h.store.keys()]).toEqual(["chat_actions:org-1"]);
    expect(await (await GET()).json()).toEqual(next);
  });

  it("PUT journalise settings.update avec l'utilisateur, l'organisation et les valeurs", async () => {
    await put({ ...ALL, proposeDeletes: false });
    expect(audit).toHaveBeenCalledTimes(1);
    expect(audit).toHaveBeenCalledWith(
      "settings.update",
      "u1",
      expect.objectContaining({ keys: ["chat_actions"], organizationId: "org-1", settings: { ...ALL, proposeDeletes: false } }),
      "192.0.2.1",
    );
  });

  it("aucun journal sur un refus ou un corps invalide", async () => {
    h.user = { id: "u", globalRole: "user" };
    await put(ALL);
    h.user = { id: "u1", globalRole: "admin" };
    await put({});
    expect(audit).not.toHaveBeenCalled();
  });

  it("l'autre organisation reste intacte", async () => {
    h.store.set("chat_actions:org-2", { ...ALL, proposeCreates: false });
    await put({ ...ALL, proposeUpdates: false });
    expect(h.store.get("chat_actions:org-2")).toEqual({ ...ALL, proposeCreates: false });
    h.orgId = "org-2";
    expect(await (await GET()).json()).toEqual({ ...ALL, proposeCreates: false });
  });

  it("un identifiant d'organisation dans le corps est refusé (schéma strict)", async () => {
    expect((await put({ ...ALL, orgId: "org-2" })).status).toBe(400);
    expect((await put({ ...ALL, organizationId: "org-2" })).status).toBe(400);
    expect(h.store.size).toBe(0);
  });

  it("corps invalide : 400, rien d'écrit", async () => {
    for (const body of [{}, { ...ALL, proposeUpdates: "oui" }, { actionsEnabled: true }, [], "x", null]) {
      expect((await put(body)).status).toBe(400);
    }
    const bad = await PUT(new NextRequest("http://localhost/x", { method: "PUT", body: "{" }));
    expect(bad.status).toBe(400);
    expect(h.store.size).toBe(0);
  });

  it("super_admin passe aussi, sur l'organisation que la requête résout", async () => {
    h.user = { id: "s", globalRole: "super_admin" };
    expect((await put(ALL)).status).toBe(200);
  });
});
