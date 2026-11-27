import { beforeEach, describe, expect, it, vi } from "vitest";

const h = vi.hoisted(() => ({ user: vi.fn(), org: vi.fn(), save: vi.fn(), rate: vi.fn() }));
vi.mock("@/lib/auth/get-user", () => ({ getSessionUser: h.user }));
vi.mock("@/lib/org/get-request-org", () => ({ getRequestOrgId: h.org }));
vi.mock("@/lib/media/retouch", () => ({ saveRetouch: h.save }));
vi.mock("@/lib/rate-limit", async (orig) => ({
  ...(await orig<typeof import("@/lib/rate-limit")>()),
  checkRateLimitAsync: h.rate,
}));

import { POST } from "./route";

const ID = "11111111-1111-4111-8111-111111111111";
const SP = "22222222-2222-4222-8222-222222222222";
const ctx = { params: Promise.resolve({ id: ID }) };

function post(fields: Record<string, string> = { name: "r", spaceId: SP }, file: File | null = new File([new Uint8Array([1])], "r.png", { type: "image/png" }), id = ID) {
  const fd = new FormData();
  if (file) fd.set("file", file);
  for (const [k, v] of Object.entries(fields)) fd.set(k, v);
  return POST(new Request(`http://x/api/media/${id}/retouch`, { method: "POST", body: fd }) as never, {
    params: Promise.resolve({ id }),
  });
}

beforeEach(() => {
  vi.clearAllMocks();
  h.user.mockResolvedValue({ id: "u1", globalRole: "member" });
  h.org.mockResolvedValue("org1");
  h.rate.mockResolvedValue({ success: true, resetAt: Date.now() + 1000 });
  h.save.mockResolvedValue({
    ok: true,
    media: { id: "new", storageKey: "secret", thumbnailKey: null, currentVersion: 1 },
    duplicate: false,
    quota: { warn: false },
  });
});

describe("POST /api/media/[id]/retouch", () => {
  it("401 sans session, 403 sans organisation", async () => {
    h.user.mockResolvedValue(null);
    expect((await post()).status).toBe(401);
    h.user.mockResolvedValue({ id: "u1" });
    h.org.mockResolvedValue(null);
    expect((await post()).status).toBe(403);
  });
  it("404 sur identifiant invalide", async () => {
    expect((await post(undefined, undefined, "zzz")).status).toBe(404);
  });
  it("429 au-delà du quota de débit, sans appeler le service", async () => {
    h.rate.mockResolvedValue({ success: false, resetAt: Date.now() + 5000 });
    const res = await post();
    expect(res.status).toBe(429);
    expect(res.headers.get("Retry-After")).toBeTruthy();
    expect(h.save).not.toHaveBeenCalled();
  });
  it("400 : fichier manquant, mode inconnu, champ superflu, nom vide", async () => {
    expect((await post({ name: "r" }, null)).status).toBe(400);
    expect((await post({ name: "r", mode: "x" })).status).toBe(400);
    expect((await post({ name: "" })).status).toBe(400);
    expect((await post({ name: "r", spaceId: "pas-un-uuid" })).status).toBe(400);
    expect(h.save).not.toHaveBeenCalled();
  });
  it("201 : dérivé par défaut, organisation et session du serveur, clés de stockage masquées", async () => {
    const res = await post({ name: "r", spaceId: SP, orgId: "autre" });
    expect(res.status).toBe(201);
    expect(h.save).toHaveBeenCalledWith(
      expect.objectContaining({ orgId: "org1", sourceId: ID, mode: "derived", spaceId: SP, name: "r" }),
    );
    const body = await res.json();
    expect(body.media.storageKey).toBeUndefined();
    expect(body.duplicate).toBe(false);
  });
  it("200 pour un doublon et pour une version", async () => {
    h.save.mockResolvedValue({ ok: true, media: { id: "d", currentVersion: 1 }, duplicate: true, quota: {} });
    expect((await post()).status).toBe(200);
    h.save.mockResolvedValue({ ok: true, media: { id: "d", currentVersion: 2 }, duplicate: false, quota: {}, versionId: "row-9" });
    const v = await post({ name: "r", mode: "version", expectedVersion: "3" });
    expect(v.status).toBe(200);
    expect((await v.json()).versionId).toBe("row-9");
    expect(h.save).toHaveBeenLastCalledWith(expect.objectContaining({ mode: "version", expectedVersion: 3 }));
  });
  it("relaie les codes du service (404, 403, 409, 413, 415, 507)", async () => {
    for (const status of [404, 403, 409, 413, 415, 507]) {
      h.save.mockResolvedValue({ ok: false, status, error: "e" });
      expect((await post()).status).toBe(status);
    }
  });
});
