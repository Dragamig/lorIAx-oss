import { describe, it, expect, vi, beforeEach } from "vitest";

const UP = "55555555-5555-4555-8555-555555555555";
const SP = "66666666-6666-4666-8666-666666666666";

const h = vi.hoisted(() => {
  class MultipartInputError extends Error {}
  return {
    MultipartInputError,
    user: { id: "u1" } as { id: string } | null,
    orgId: "org-1" as string | null,
    enabled: true,
    open: vi.fn(),
    sign: vi.fn(),
    state: vi.fn(),
    complete: vi.fn(),
    abort: vi.fn(),
    detail: vi.fn(),
  };
});

vi.mock("@/lib/auth/get-user", () => ({ getSessionUser: () => Promise.resolve(h.user) }));
vi.mock("@/lib/org/get-request-org", () => ({ getRequestOrgId: () => Promise.resolve(h.orgId) }));
vi.mock("@/lib/media/metadata", () => ({ getMediaDetail: (...a: unknown[]) => h.detail(...a) }));
vi.mock("@/lib/media/multipart", () => ({
  MultipartInputError: h.MultipartInputError,
  MULTIPART_NOT_FOUND: "Envoi introuvable",
  MULTIPART_MAX_BYTES: 5 * 1024 ** 3,
  MULTIPART_PART_SIZE: 16 * 1024 * 1024,
  MULTIPART_MAX_SIGN_PARTS: 20,
  multipartEnabled: () => h.enabled,
  openMultipart: (...a: unknown[]) => h.open(...a),
  signParts: (...a: unknown[]) => h.sign(...a),
  getUploadState: (...a: unknown[]) => h.state(...a),
  completeMultipart: (...a: unknown[]) => h.complete(...a),
  abortUpload: (...a: unknown[]) => h.abort(...a),
}));

import { GET as getConfig } from "./config/route";
import { POST as openRoute } from "./route";
import { GET as stateRoute, DELETE as abortRoute } from "./[id]/route";
import { POST as partsRoute } from "./[id]/parts/route";
import { POST as completeRoute } from "./[id]/complete/route";
import { resetQuota, RATE_LIMITS } from "@/lib/rate-limit";

let n = 0;
const json = (body: unknown) =>
  new Request("http://x/api/media/multipart", {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify(body),
  }) as never;
const ctx = (id = UP) => ({ params: Promise.resolve({ id }) });
const OPEN = { name: "a.mp4", size: 300 * 1024 * 1024, type: "video/mp4", spaceId: SP };

beforeEach(async () => {
  n++;
  h.user = { id: `user-${n}` };
  h.orgId = "org-1";
  h.enabled = true;
  for (const f of [h.open, h.sign, h.state, h.complete, h.abort, h.detail]) f.mockReset();
  await resetQuota(`media-multipart-open:user-${n}`, [RATE_LIMITS.mediaMultipartOpen]);
  await resetQuota(`media-multipart-sign:user-${n}`, [RATE_LIMITS.mediaMultipartSign]);
});

describe("401 et organisation", () => {
  it("toutes les routes refusent sans session", async () => {
    h.user = null;
    expect((await getConfig()).status).toBe(401);
    expect((await openRoute(json(OPEN))).status).toBe(401);
    expect((await stateRoute(json({}), ctx())).status).toBe(401);
    expect((await abortRoute(json({}), ctx())).status).toBe(401);
    expect((await partsRoute(json({ partNumbers: [1] }), ctx())).status).toBe(401);
    expect((await completeRoute(json({ parts: [] }), ctx())).status).toBe(401);
  });
  it("organisation introuvable : 404", async () => {
    h.orgId = null;
    expect((await openRoute(json(OPEN))).status).toBe(404);
  });
});

describe("config", () => {
  it("enabled false sans S3_PUBLIC_URL", async () => {
    h.enabled = false;
    const r = await getConfig();
    expect(await r.json()).toMatchObject({ enabled: false, thresholdBytes: 209715200 });
  });
  it("enabled true avec taille de part et plafond", async () => {
    expect(await (await getConfig()).json()).toEqual({
      enabled: true,
      thresholdBytes: 209715200,
      partSize: 16 * 1024 * 1024,
      maxBytes: 5 * 1024 ** 3,
    });
  });
});

describe("ouverture", () => {
  it("201 avec uploadId, session et organisation venant du serveur", async () => {
    h.open.mockResolvedValue({ ok: true, uploadId: UP, partSize: 16, partCount: 19 });
    const r = await openRoute(json({ ...OPEN, organizationId: "autre" }));
    expect(r.status).toBe(400); // zod strict : champ inconnu refusé
    const ok = await openRoute(json(OPEN));
    expect(ok.status).toBe(201);
    expect(await ok.json()).toEqual({ uploadId: UP, partSize: 16, partCount: 19 });
    expect(h.open).toHaveBeenCalledWith(h.user, "org-1", expect.objectContaining({ spaceId: SP, name: "a.mp4" }));
  });
  it("transmet les tags au service ; type invalide : 400", async () => {
    h.open.mockResolvedValue({ ok: true, uploadId: UP, partSize: 16, partCount: 19 });
    expect((await openRoute(json({ ...OPEN, tags: ["a", "b"] }))).status).toBe(201);
    expect(h.open).toHaveBeenCalledWith(h.user, "org-1", expect.objectContaining({ tags: ["a", "b"] }));
    expect((await openRoute(json({ ...OPEN, tags: "a" }))).status).toBe(400);
  });
  it("traduit les statuts du service (fonction désactivée, 403, 507)", async () => {
    h.open.mockResolvedValueOnce({ ok: false, status: 400, error: "Envoi direct indisponible" });
    expect((await openRoute(json(OPEN))).status).toBe(400);
    h.open.mockResolvedValueOnce({ ok: false, status: 403, error: "Accès refusé" });
    expect((await openRoute(json(OPEN))).status).toBe(403);
    h.open.mockResolvedValueOnce({ ok: false, status: 507, error: "Quota de stockage atteint" });
    const r = await openRoute(json(OPEN));
    expect(r.status).toBe(507);
    expect((await r.json()).error).toBe("Quota de stockage atteint");
  });
  it("corps invalide : 400 sans appeler le service", async () => {
    expect((await openRoute(json({ ...OPEN, size: -1 }))).status).toBe(400);
    expect((await openRoute(json({ ...OPEN, spaceId: "pas-un-uuid" }))).status).toBe(400);
    expect(h.open).not.toHaveBeenCalled();
  });
  it("429 au 11e appel de l'heure", async () => {
    h.open.mockResolvedValue({ ok: true, uploadId: UP, partSize: 16, partCount: 19 });
    for (let i = 0; i < 10; i++) expect((await openRoute(json(OPEN))).status).toBe(201);
    const r = await openRoute(json(OPEN));
    expect(r.status).toBe(429);
    expect(r.headers.get("Retry-After")).toBeTruthy();
  });
});

describe("envoi d'un autre utilisateur ou d'une autre organisation : 404 muet", () => {
  it("état, abandon, signature, fin", async () => {
    h.state.mockResolvedValue(null);
    h.abort.mockResolvedValue(false);
    h.sign.mockResolvedValue(null);
    h.complete.mockResolvedValue({ ok: false, status: 400, error: "Envoi introuvable" });
    expect((await stateRoute(json({}), ctx())).status).toBe(404);
    expect((await abortRoute(json({}), ctx())).status).toBe(404);
    expect((await partsRoute(json({ partNumbers: [1] }), ctx())).status).toBe(404);
    expect((await completeRoute(json({ parts: [{ partNumber: 1, etag: "e" }] }), ctx())).status).toBe(404);
  });
  it("identifiant qui n'est pas un UUID : 404 sans appel au service", async () => {
    expect((await stateRoute(json({}), ctx("../x"))).status).toBe(404);
    expect(h.state).not.toHaveBeenCalled();
  });
});

describe("état et abandon", () => {
  it("rend les parts reçues pour reprendre", async () => {
    h.state.mockResolvedValue({ partSize: 16, partCount: 3, done: [{ partNumber: 1, etag: "e1" }] });
    const r = await stateRoute(json({}), ctx());
    expect(r.status).toBe(200);
    expect((await r.json()).done).toEqual([{ partNumber: 1, etag: "e1" }]);
  });
  it("DELETE : 204 pour l'auteur", async () => {
    h.abort.mockResolvedValue(true);
    expect((await abortRoute(json({}), ctx())).status).toBe(204);
    expect(h.abort).toHaveBeenCalledWith(h.user, "org-1", UP);
  });
});

describe("signature de parts", () => {
  it("rend les URL signées", async () => {
    h.sign.mockResolvedValue([{ partNumber: 1, url: "https://s3.exemple/x?sig=1" }]);
    const r = await partsRoute(json({ partNumbers: [1] }), ctx());
    expect(r.status).toBe(200);
    expect((await r.json()).parts[0].url).toMatch(/^https:\/\/s3\.exemple\//);
  });
  it("21 parts : 400 sans appeler le service ; champ inconnu : 400", async () => {
    const many = Array.from({ length: 21 }, (_, i) => i + 1);
    expect((await partsRoute(json({ partNumbers: many }), ctx())).status).toBe(400);
    expect((await partsRoute(json({ partNumbers: [1], x: 1 }), ctx())).status).toBe(400);
    expect((await partsRoute(json({ partNumbers: [0] }), ctx())).status).toBe(400);
    expect(h.sign).not.toHaveBeenCalled();
  });
  it("MultipartInputError (numéro hors 1..partCount) : 400", async () => {
    h.sign.mockRejectedValue(new h.MultipartInputError("Numéros de parts invalides"));
    const r = await partsRoute(json({ partNumbers: [99] }), ctx());
    expect(r.status).toBe(400);
    expect((await r.json()).error).toBe("Numéros de parts invalides");
  });
  it("une erreur inattendue n'est pas masquée en 400", async () => {
    h.sign.mockRejectedValue(new Error("boom"));
    await expect(partsRoute(json({ partNumbers: [1] }), ctx())).rejects.toThrow("boom");
  });
});

describe("finalisation", () => {
  const body = { parts: [{ partNumber: 1, etag: "e1" }] };
  it("200 avec le média", async () => {
    h.complete.mockResolvedValue({ ok: true, media: { id: "m1" }, quota: {}, hasLocationExif: false });
    h.detail.mockResolvedValue({ id: "m1", filename: "a.mp4" });
    const r = await completeRoute(json(body), ctx());
    expect(r.status).toBe(200);
    expect((await r.json()).media.id).toBe("m1");
  });
  it("statuts du service conservés (415, 507 avec quota)", async () => {
    h.complete.mockResolvedValueOnce({ ok: false, status: 415, error: "Le contenu du fichier n'est pas un média reconnu" });
    expect((await completeRoute(json(body), ctx())).status).toBe(415);
    h.complete.mockResolvedValueOnce({ ok: false, status: 507, error: "Quota", quota: { allowed: false } });
    const r = await completeRoute(json(body), ctx());
    expect(r.status).toBe(507);
    expect((await r.json()).quota).toEqual({ allowed: false });
  });
  it("corps invalide : 400", async () => {
    expect((await completeRoute(json({ parts: [] }), ctx())).status).toBe(400);
    expect((await completeRoute(json({ parts: [{ partNumber: 1 }] }), ctx())).status).toBe(400);
    expect(h.complete).not.toHaveBeenCalled();
  });
});
