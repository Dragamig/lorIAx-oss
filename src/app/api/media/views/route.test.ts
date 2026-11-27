import { describe, expect, it, vi, beforeEach } from "vitest";

const h = vi.hoisted(() => ({ user: null as unknown, org: "org1" as string | null }));
vi.mock("@/lib/auth/get-user", () => ({ getSessionUser: () => Promise.resolve(h.user) }));
vi.mock("@/lib/org/get-request-org", () => ({ getRequestOrgId: () => Promise.resolve(h.org) }));
const svc = vi.hoisted(() => ({
  listSavedViews: vi.fn(),
  createSavedView: vi.fn(),
  updateSavedView: vi.fn(),
  deleteSavedView: vi.fn(),
}));
vi.mock("@/lib/media/saved-views", async (orig) => ({
  ...(await orig<typeof import("@/lib/media/saved-views")>()),
  ...svc,
}));

import { SavedViewError } from "@/lib/media/saved-views";
import { GET, POST } from "./route";
import { DELETE, PATCH } from "./[id]/route";

const ID = "11111111-1111-4111-8111-111111111111";
const req = (body?: unknown) =>
  new Request("http://x/api/media/views", { method: "POST", body: JSON.stringify(body) }) as never;
const ctx = (id = ID) => ({ params: Promise.resolve({ id }) });

beforeEach(() => {
  h.user = { id: "u1", globalRole: "editor" };
  h.org = "org1";
  Object.values(svc).forEach((f) => f.mockReset());
});

describe("routes des vues enregistrées", () => {
  it("401 sans session", async () => {
    h.user = null;
    expect((await GET()).status).toBe(401);
    expect((await POST(req({}))).status).toBe(401);
    expect((await PATCH(req({}), ctx())).status).toBe(401);
    expect((await DELETE(req(), ctx())).status).toBe(401);
  });
  it("403 sans organisation", async () => {
    h.org = null;
    expect((await GET()).status).toBe(403);
  });
  it("GET renvoie mine et shared sans cache", async () => {
    svc.listSavedViews.mockResolvedValue({ mine: [], shared: [] });
    const res = await GET();
    expect(await res.json()).toEqual({ mine: [], shared: [] });
    expect(res.headers.get("Cache-Control")).toBe("private, no-store");
  });
  it("POST 201, relaie 409 et 400 du service", async () => {
    svc.createSavedView.mockResolvedValue({ id: ID });
    expect((await POST(req({ name: "a", query: "" }))).status).toBe(201);
    expect(svc.createSavedView).toHaveBeenCalledWith(h.user, "org1", { name: "a", query: "", shared: undefined });
    svc.createSavedView.mockRejectedValue(new SavedViewError(409, "doublon"));
    expect((await POST(req({ name: "a" }))).status).toBe(409);
  });
  it("POST corps invalide : 400", async () => {
    const bad = new Request("http://x", { method: "POST", body: "pas json" }) as never;
    expect((await POST(bad)).status).toBe(400);
  });
  it("PATCH et DELETE : id invalide 404, 404 du service, 204", async () => {
    expect((await PATCH(req({ name: "a" }), ctx("nope"))).status).toBe(404);
    expect((await DELETE(req(), ctx("nope"))).status).toBe(404);
    svc.updateSavedView.mockRejectedValue(new SavedViewError(404, "Vue introuvable"));
    expect((await PATCH(req({ name: "a" }), ctx())).status).toBe(404);
    svc.deleteSavedView.mockResolvedValue(undefined);
    expect((await DELETE(req(), ctx())).status).toBe(204);
  });
});
