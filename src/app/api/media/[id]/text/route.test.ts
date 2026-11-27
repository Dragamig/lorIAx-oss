import { beforeEach, describe, expect, it, vi } from "vitest";

const h = vi.hoisted(() => ({ guard: vi.fn(), state: vi.fn() }));
vi.mock("@/lib/media/route-guard", () => ({ guardMediaRead: h.guard }));
vi.mock("@/lib/media/ai/text-state", () => ({ getMediaTextState: h.state }));

import { GET } from "./route";

const ID = "11111111-1111-4111-8111-111111111111";
const call = (qs = "") => GET(new Request(`http://x/api/media/${ID}/text${qs}`) as never, { params: Promise.resolve({ id: ID }) });
const res404 = () => new Response(JSON.stringify({ error: "Média introuvable" }), { status: 404 });

beforeEach(() => {
  vi.clearAllMocks();
  h.guard.mockResolvedValue({ ok: true, row: { id: ID, organizationId: "org1", deletedAt: null } });
  h.state.mockResolvedValue({ status: "done", text: "<b>x</b>", totalChars: 8, offset: 0, nextOffset: null });
});

describe("GET /api/media/[id]/text", () => {
  it("lecteur autorisé : texte rendu en JSON, sans mise en cache ni sniffing", async () => {
    const res = await call();
    expect(res.status).toBe(200);
    expect(res.headers.get("content-type")).toContain("application/json");
    expect(res.headers.get("x-content-type-options")).toBe("nosniff");
    expect(res.headers.get("cache-control")).toContain("no-store");
    expect((await res.json()).text).toBe("<b>x</b>");
  });
  it.each([404, 403, 401])("garde refusée (%i) : relayée, aucun accès au texte", async (status) => {
    h.guard.mockResolvedValue({ ok: false, res: status === 404 ? res404() : new Response("{}", { status }) });
    expect((await call()).status).toBe(status);
    expect(h.state).not.toHaveBeenCalled();
  });
  it("média en corbeille : 404 muet", async () => {
    h.guard.mockResolvedValue({ ok: true, row: { id: ID, organizationId: "org1", deletedAt: new Date() } });
    expect((await call()).status).toBe(404);
    expect(h.state).not.toHaveBeenCalled();
  });
  it("paramètres inconnus ou hors bornes : 400", async () => {
    expect((await call("?foo=1")).status).toBe(400);
    expect((await call("?limit=999999")).status).toBe(400);
    expect((await call("?offset=-1")).status).toBe(400);
  });
  it("pagination transmise au service", async () => {
    await call("?offset=10&limit=20");
    expect(h.state).toHaveBeenCalledWith(expect.anything(), { offset: 10, limit: 20 });
  });
});
