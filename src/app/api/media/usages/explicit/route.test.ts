import { beforeEach, describe, expect, it, vi } from "vitest";
import { NextRequest } from "next/server";

const h = vi.hoisted(() => ({
  user: vi.fn(),
  org: vi.fn(),
  space: vi.fn(),
  set: vi.fn(),
  spaceRead: vi.fn(),
  canvasEdit: vi.fn(),
}));
vi.mock("@/lib/auth/get-user", () => ({ getSessionUser: h.user }));
vi.mock("@/lib/org/get-request-org", () => ({ getRequestOrgId: h.org }));
vi.mock("@/lib/db", () => ({
  db: { select: () => ({ from: () => ({ where: () => ({ limit: () => h.space() }) }) }) },
}));
vi.mock("@/lib/auth/canvas-access", () => ({
  checkCanvasEditAccess: h.canvasEdit,
  getRequestedDocumentId: () => null,
}));
vi.mock("@/lib/auth/check-access", () => ({ checkSpaceReadAccess: h.spaceRead }));
vi.mock("@/lib/media/explicit-usages", () => ({ setExplicitUsages: h.set }));

import { PUT } from "./route";

const SPACE = "11111111-1111-4111-8111-111111111111";
const TARGET = "22222222-2222-4222-8222-222222222222";
const MEDIA = "33333333-3333-4333-8333-333333333333";
const req = (body: unknown) =>
  new NextRequest("http://x/api/media/usages/explicit", {
    method: "PUT",
    body: typeof body === "string" ? body : JSON.stringify(body),
    headers: { "content-type": "application/json" },
  });
const ok = { targetType: "design", targetId: TARGET, spaceId: SPACE, mediaIds: [MEDIA] };

beforeEach(() => {
  Object.values(h).forEach((f) => f.mockReset());
  h.user.mockResolvedValue({ id: "u1" });
  h.org.mockResolvedValue("o1");
  h.space.mockResolvedValue([{ id: SPACE }]);
  h.spaceRead.mockResolvedValue(true);
  h.canvasEdit.mockResolvedValue({ ok: true, documentId: "d1" });
  h.set.mockResolvedValue({ added: 1, removed: 0, ignored: 0 });
});

describe("PUT /api/media/usages/explicit", () => {
  it("401 sans session", async () => {
    h.user.mockResolvedValue(null);
    expect((await PUT(req(ok))).status).toBe(401);
    expect(h.set).not.toHaveBeenCalled();
  });

  it("400 sur un corps invalide", async () => {
    expect((await PUT(req("{"))).status).toBe(400);
    expect((await PUT(req({ ...ok, targetType: "document" }))).status).toBe(400);
    expect((await PUT(req({ ...ok, mediaIds: ["zz"] }))).status).toBe(400);
  });

  it("404 pour un espace d'une autre organisation", async () => {
    h.space.mockResolvedValue([]);
    expect((await PUT(req(ok))).status).toBe(404);
    expect(h.set).not.toHaveBeenCalled();
  });

  it("404 pour un espace illisible par l'utilisateur", async () => {
    h.spaceRead.mockResolvedValue(false);
    expect((await PUT(req(ok))).status).toBe(404);
    expect(h.set).not.toHaveBeenCalled();
  });

  it("403 pour un lecteur seul de la cible (pas d'écriture)", async () => {
    h.canvasEdit.mockResolvedValue({ ok: false, status: 403 });
    expect((await PUT(req(ok))).status).toBe(403);
    expect(h.set).not.toHaveBeenCalled();
  });

  it("sans documentId (corps ni requête), le contrôle d'écriture reste appliqué et refuse fermé", async () => {
    h.canvasEdit.mockResolvedValue({ ok: false, status: 400 });
    const res = await PUT(req(ok));
    expect(res.status).toBe(400);
    expect(h.canvasEdit).toHaveBeenCalledWith(
      expect.anything(),
      TARGET,
      expect.objectContaining({ requestedDocumentId: null }),
    );
    expect(h.set).not.toHaveBeenCalled();
  });

  it("le documentId du corps est transmis au contrôle d'écriture", async () => {
    const DOC = "44444444-4444-4444-8444-444444444444";
    await PUT(req({ ...ok, documentId: DOC }));
    expect(h.canvasEdit).toHaveBeenCalledWith(
      expect.anything(),
      TARGET,
      expect.objectContaining({ requestedDocumentId: DOC }),
    );
  });

  it("cible sans ligne en base : le document doit mentionner la cible (requireMention)", async () => {
    h.space.mockResolvedValue([]);
    await PUT(req({ ...ok, spaceId: null }));
    expect(h.canvasEdit).toHaveBeenCalledWith(
      expect.anything(),
      TARGET,
      expect.objectContaining({ rowExists: false, requireMention: true }),
    );
  });

  it("200 avec les compteurs", async () => {
    const res = await PUT(req(ok));
    expect(res.status).toBe(200);
    expect(await res.json()).toEqual({ added: 1, removed: 0, ignored: 0 });
    expect(h.set).toHaveBeenCalledWith(expect.objectContaining({ targetType: "design", orgId: "o1", spaceId: SPACE }));
  });

  it("espace nul accepté (média hors espace)", async () => {
    const res = await PUT(req({ ...ok, spaceId: null }));
    expect(res.status).toBe(200);
    expect(h.space).toHaveBeenCalledTimes(1); // seule la lecture du snapshot de la cible
  });
});
