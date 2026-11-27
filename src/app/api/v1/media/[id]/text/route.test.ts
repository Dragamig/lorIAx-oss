import { beforeEach, describe, expect, it, vi } from "vitest";
import { apiError } from "@/lib/api/response";

const h = vi.hoisted(() => ({ auth: vi.fn(), full: vi.fn(), access: vi.fn(), state: vi.fn() }));
vi.mock("@/lib/api/auth-api", () => ({ authenticateApiRequest: h.auth }));
vi.mock("@/lib/api/media-user", () => ({
  apiUserToSessionUser: async (u: { id: string }) => ({ id: u.id }),
  requireMediaScope: (u: { scopes: string[] | null }, s: string) =>
    u.scopes === null || u.scopes.includes(s) ? null : apiError(`Scope manquant : ${s}`, 403),
}));
vi.mock("@/lib/media/access", () => ({ getMediaFull: h.full, resolveMediaAccess: h.access }));
vi.mock("@/lib/media/ai/text-state", () => ({ getMediaTextState: h.state }));
vi.mock("@/lib/db", () => ({ db: {} }));

import { GET } from "./route";

const ID = "11111111-1111-4111-8111-111111111111";
const row = { id: ID, organizationId: "org1", deletedAt: null, mimeType: "application/pdf", filename: "a.pdf" };
const call = (qs = "") => GET(new Request(`http://x/api/v1/media/${ID}/text${qs}`), { params: Promise.resolve({ id: ID }) });

beforeEach(() => {
  vi.clearAllMocks();
  h.auth.mockResolvedValue({ user: { id: "u1", orgId: "org1", scopes: ["media:read"] } });
  h.full.mockResolvedValue(row);
  h.access.mockResolvedValue({ allowed: true });
  h.state.mockResolvedValue({ status: "done", text: "abc" });
});

describe("GET /api/v1/media/[id]/text", () => {
  it("200 avec portée media:read, organisation de la clé", async () => {
    const res = await call();
    expect(res.status).toBe(200);
    expect((await res.json()).data.text).toBe("abc");
    expect(h.access).toHaveBeenCalledWith(expect.anything(), row, "read", { orgId: "org1" });
  });
  it("403 sans la portée", async () => {
    h.auth.mockResolvedValue({ user: { id: "u1", orgId: "org1", scopes: ["media:write"] } });
    expect((await call()).status).toBe(403);
    expect(h.state).not.toHaveBeenCalled();
  });
  it("404 muet : refus d'accès, autre organisation, corbeille", async () => {
    h.access.mockResolvedValue({ allowed: false, reason: "org" });
    expect((await call()).status).toBe(404);
    h.access.mockResolvedValue({ allowed: true });
    h.full.mockResolvedValue({ ...row, deletedAt: new Date() });
    expect((await call()).status).toBe(404);
    expect(h.state).not.toHaveBeenCalled();
  });
  it("400 sur paramètre inconnu", async () => {
    expect((await call("?x=1")).status).toBe(400);
  });
});
