import { describe, it, expect, vi, beforeEach } from "vitest";
import { NextRequest, NextResponse } from "next/server";

const h = vi.hoisted(() => ({
  access: "ok" as "ok" | "404",
  isAdmin: true,
  enabled: true,
  complete: true,
  activateCalls: [] as unknown[][],
  deactivateCalls: 0,
  activateResult: { ok: true, reactivated: false } as unknown,
  toggle: vi.fn(),
}));

vi.mock("@/lib/crm/access", () => ({
  requireCrm: vi.fn(async (opts: { level: string }) => {
    if (h.access === "404") return { ok: false, response: NextResponse.json({ error: "Introuvable" }, { status: 404 }) };
    if (opts.level === "admin" && !h.isAdmin)
      return { ok: false, response: NextResponse.json({ error: "Accès refusé" }, { status: 403 }) };
    return { ok: true, user: { id: "u1" }, orgId: "org1", isAdmin: h.isAdmin, enabled: h.enabled };
  }),
}));
vi.mock("@/lib/crm/activation", () => ({
  activateCrm: vi.fn(async (...a: unknown[]) => {
    h.activateCalls.push(a);
    return h.activateResult;
  }),
  deactivateCrm: vi.fn(async () => {
    h.deactivateCalls++;
  }),
}));
vi.mock("@/lib/crm/connection", () => ({
  loadConnection: vi.fn(async () => ({ complete: h.complete })),
}));
vi.mock("@/lib/modules/toggle", () => ({ setModuleToggle: h.toggle }));

import { POST as activate } from "@/app/api/crm/activate/route";
import { POST as deactivate } from "@/app/api/crm/deactivate/route";
import { GET as status } from "@/app/api/crm/status/route";

const UUID = "11111111-1111-4111-8111-111111111111";
const post = (body?: unknown) =>
  new NextRequest("http://x/api/crm/activate", {
    method: "POST",
    body: body === undefined ? undefined : typeof body === "string" ? body : JSON.stringify(body),
  });

beforeEach(() => {
  h.access = "ok";
  h.isAdmin = true;
  h.enabled = true;
  h.complete = true;
  h.activateCalls = [];
  h.deactivateCalls = 0;
  h.activateResult = { ok: true, reactivated: false };
  h.toggle.mockClear();
});

describe("routes d'activation CRM", () => {
  it("non-admin 403", async () => {
    h.isAdmin = false;
    expect((await activate(post())).status).toBe(403);
    expect((await deactivate(post())).status).toBe(403);
  });
  it("module indisponible ou organisation étrangère : 404 muet", async () => {
    h.access = "404";
    expect((await activate(post())).status).toBe(404);
    expect((await deactivate(post())).status).toBe(404);
    expect((await status(new NextRequest("http://x/api/crm/status"))).status).toBe(404);
  });
  it("activate sans corps : réactive avec l'organisation de la requête", async () => {
    h.activateResult = { ok: true, reactivated: true, created: [], completed: [], unlinkedRelations: [] };
    const res = await activate(post());
    expect(res.status).toBe(200);
    expect(await res.json()).toEqual({ enabled: true, reactivated: true, created: [], completed: [], unlinkedRelations: [] });
    expect(h.activateCalls[0].slice(0, 3)).toEqual(["org1", "u1", { bindings: {}, locale: "fr" }]);
  });
  it("activate avec bases : transmet les liaisons", async () => {
    await activate(post({ bindings: { contacts: { databaseId: UUID } } }));
    expect(h.activateCalls[0][2]).toEqual({ bindings: { contacts: { databaseId: UUID } }, locale: "fr" });
  });
  it("corps invalide : 400 invalid_body", async () => {
    for (const b of [{ bindings: { contacts: { databaseId: "x" } } }, { autre: 1 }, { organizationId: "o" }, "{pas du json"]) {
      const res = await activate(post(b));
      expect(res.status).toBe(400);
      expect((await res.json()).code).toBe("invalid_body");
    }
    expect(h.activateCalls).toHaveLength(0);
  });
  it("base inaccessible : 404 uniforme", async () => {
    h.activateResult = { ok: false, status: 404, code: "not_found" };
    const res = await activate(post({ bindings: { contacts: { databaseId: UUID } } }));
    expect(res.status).toBe(404);
    expect(await res.json()).toEqual({ error: "Introuvable" });
  });
  it("deactivate : idempotent, rend enabled faux", async () => {
    for (let i = 0; i < 2; i++) {
      const res = await deactivate(post());
      expect(res.status).toBe(200);
      expect(await res.json()).toEqual({ enabled: false });
    }
    expect(h.deactivateCalls).toBe(2);
  });
  it("status : membre reçoit enabled et canAdmin faux", async () => {
    h.isAdmin = false;
    const res = await status(new NextRequest("http://x/api/crm/status"));
    expect(await res.json()).toEqual({ enabled: true, complete: true, canAdmin: false });
  });
  it("status : non activé donne complete faux", async () => {
    h.enabled = false;
    const res = await status(new NextRequest("http://x/api/crm/status"));
    expect(await res.json()).toEqual({ enabled: false, complete: false, canAdmin: true });
  });
  it("activate et deactivate n'appellent jamais setModuleToggle", async () => {
    await activate(post());
    await deactivate(post());
    expect(h.toggle).not.toHaveBeenCalled();
  });
});

describe("activation : erreurs de validation", () => {
  it("400 de saveConnection rendu tel quel avec son code", async () => {
    h.activateResult = { ok: false, status: 400, code: "duplicate_database" };
    const res = await activate(post({ bindings: { contacts: { databaseId: UUID } } }));
    expect(res.status).toBe(400);
    expect((await res.json()).code).toBe("duplicate_database");
  });
});

describe("activation V2", () => {
  const v2 = { space: { mode: "create" }, roles: { contacts: { mode: "create" } } };
  it("succès : created et completed rendus, corps V2 et locale du cookie transmis", async () => {
    h.activateResult = { ok: true, reactivated: false, created: ["contacts"], completed: ["dossiers"], unlinkedRelations: ["x"] };
    const req = new NextRequest("http://x/api/crm/activate", {
      method: "POST",
      body: JSON.stringify(v2),
      headers: { cookie: "NEXT_LOCALE=en" },
    });
    const res = await activate(req);
    expect(res.status).toBe(200);
    expect(await res.json()).toEqual({
      enabled: true,
      reactivated: false,
      created: ["contacts"],
      completed: ["dossiers"],
      unlinkedRelations: ["x"],
    });
    expect(h.activateCalls[0][2]).toEqual({ v2, locale: "en" });
  });
  it("locale du cookie inconnue : repli fr", async () => {
    await activate(new NextRequest("http://x/api/crm/activate", { method: "POST", body: JSON.stringify(v2), headers: { cookie: "NEXT_LOCALE=xx" } }));
    expect((h.activateCalls[0][2] as { locale: string }).locale).toBe("fr");
  });
  it("409 name_collision rend le rôle", async () => {
    h.activateResult = { ok: false, status: 409, code: "name_collision", role: "dossiers" };
    const res = await activate(post(v2));
    expect(res.status).toBe(409);
    expect(await res.json()).toMatchObject({ code: "name_collision", role: "dossiers" });
  });
  it("403 forbidden rendu", async () => {
    h.activateResult = { ok: false, status: 403, code: "forbidden" };
    const res = await activate(post(v2));
    expect(res.status).toBe(403);
    expect((await res.json()).code).toBe("forbidden");
  });
  it("404 muet sur espace ou base étrangère", async () => {
    h.activateResult = { ok: false, status: 404, code: "not_found" };
    const res = await activate(post(v2));
    expect(res.status).toBe(404);
    expect(await res.json()).toEqual({ error: "Introuvable" });
  });
  it("400 space_quota et column_not_in_database rendus avec leur code", async () => {
    for (const code of ["space_quota", "column_not_in_database"]) {
      h.activateResult = { ok: false, status: 400, code };
      const res = await activate(post(v2));
      expect(res.status).toBe(400);
      expect((await res.json()).code).toBe(code);
    }
  });
  it("corps avec orgId : 400 invalid_body, rien d'appelé", async () => {
    for (const b of [{ ...v2, orgId: "o" }, { ...v2, organizationId: "o" }]) {
      const res = await activate(post(b));
      expect(res.status).toBe(400);
      expect((await res.json()).code).toBe("invalid_body");
    }
    expect(h.activateCalls).toHaveLength(0);
  });
});
