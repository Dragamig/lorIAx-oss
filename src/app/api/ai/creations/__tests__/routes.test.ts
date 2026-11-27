import { describe, it, expect, vi, beforeEach } from "vitest";
import { NextRequest } from "next/server";

const applyCreation = vi.fn();
const undoCreation = vi.fn();
const getOwn = vi.fn();
const markDismissed = vi.fn();
const markRestored = vi.fn();
const countPending = vi.fn();
const sessionScope = vi.fn();

vi.mock("@/lib/ai/creation/apply", () => ({
  applyCreation: (...a: unknown[]) => applyCreation(...a),
  undoCreation: (...a: unknown[]) => undoCreation(...a),
}));
vi.mock("@/lib/ai/creation/store", () => ({
  getOwnCreationProposal: (...a: unknown[]) => getOwn(...a),
  markDismissed: (...a: unknown[]) => markDismissed(...a),
  markRestored: (...a: unknown[]) => markRestored(...a),
  countPendingCreationProposals: (...a: unknown[]) => countPending(...a),
}));
vi.mock("@/lib/ai/chat-tools/create-tools", () => ({ MAX_PENDING_CREATIONS: 20 }));
vi.mock("@/lib/ai/proposals/route-utils", async () => {
  const { NextResponse } = await import("next/server");
  return {
    isUuid: (v: string) => /^[0-9a-f-]{36}$/i.test(v),
    notFound: () => NextResponse.json({ error: "Introuvable" }, { status: 404 }),
    sessionScope: (...a: unknown[]) => sessionScope(...a),
    accessErrorResponse: (e: unknown) => {
      throw e;
    },
  };
});

import { POST as apply } from "../[id]/apply/route";
import { POST as dismiss } from "../[id]/dismiss/route";
import { POST as undo } from "../[id]/undo/route";
import { POST as restore } from "../[id]/restore/route";

const ID = "11111111-1111-4111-8111-111111111111";
const ctx = { params: Promise.resolve({ id: ID }) };
const mk = (body?: unknown) =>
  new NextRequest("http://x/api", { method: "POST", body: body === undefined ? undefined : JSON.stringify(body) });

beforeEach(() => {
  vi.clearAllMocks();
  sessionScope.mockResolvedValue({ user: { id: "u1" }, orgId: "org1" });
  countPending.mockResolvedValue(0);
});

describe("routes creations", () => {
  it("apply : identité de la session, overrides transmis, DTO renvoyé", async () => {
    applyCreation.mockResolvedValue({ status: "applied", result: { id: "r" } });
    const r = await apply(mk({ overrides: { title: "X" } }), ctx);
    expect(r.status).toBe(200);
    expect(applyCreation).toHaveBeenCalledWith(
      expect.objectContaining({ proposalId: ID, orgId: "org1", overrides: { title: "X" } }),
    );
  });

  it("apply : corps avec userId ou orgId refusé", async () => {
    expect((await apply(mk({ userId: "x" }), ctx)).status).toBe(400);
    expect((await apply(mk({ overrides: { orgId: "x" } }), ctx)).status).toBe(400);
    expect(applyCreation).not.toHaveBeenCalled();
  });

  it("apply : 404 muet, 409 refusée, 400 invalide, 422 échec", async () => {
    for (const [out, code] of [
      [{ status: "not_found" }, 404],
      [{ status: "refused", message: "m" }, 409],
      [{ status: "invalid", message: "m" }, 400],
      [{ status: "failed", message: "m" }, 422],
    ] as const) {
      applyCreation.mockResolvedValue(out);
      expect((await apply(mk(), ctx)).status).toBe(code);
    }
  });

  it("id non UUID : 404", async () => {
    const bad = { params: Promise.resolve({ id: "nope" }) };
    expect((await apply(mk(), bad)).status).toBe(404);
    expect((await dismiss(mk(), bad)).status).toBe(404);
    expect((await undo(mk(), bad)).status).toBe(404);
  });

  it("dismiss : autre utilisateur 404 muet, pending ignorée, autre statut 409", async () => {
    getOwn.mockResolvedValue(null);
    expect((await dismiss(mk(), ctx)).status).toBe(404);
    expect(markDismissed).not.toHaveBeenCalled();
    getOwn.mockResolvedValue({ status: "applied" });
    expect((await dismiss(mk(), ctx)).status).toBe(409);
    getOwn.mockResolvedValue({ status: "pending" });
    markDismissed.mockResolvedValue(true);
    expect((await dismiss(mk(), ctx)).status).toBe(200);
    expect(markDismissed).toHaveBeenCalledWith(ID);
    expect(getOwn).toHaveBeenCalledWith("org1", "u1", ID);
  });

  it("dismiss : apply gagné entre-temps, 409 avec l'état réel", async () => {
    getOwn.mockResolvedValueOnce({ status: "pending" }).mockResolvedValueOnce({ status: "applying" });
    markDismissed.mockResolvedValue(false);
    const res = await dismiss(mk(), ctx);
    expect(res.status).toBe(409);
    expect(await res.json()).toMatchObject({ code: "refused", status: "applying" });
  });

  it("undo : 200, 409 après modification, 404 muet", async () => {
    undoCreation.mockResolvedValue({ status: "undone" });
    expect((await undo(mk(), ctx)).status).toBe(200);
    undoCreation.mockResolvedValue({ status: "refused", message: "modifié" });
    expect((await undo(mk(), ctx)).status).toBe(409);
    undoCreation.mockResolvedValue({ status: "not_found" });
    expect((await undo(mk(), ctx)).status).toBe(404);
  });

  it("restore : 404 muet (autre utilisateur, id invalide), 409 hors dismissed ou expirée, 200 sinon", async () => {
    getOwn.mockResolvedValue(null);
    expect((await restore(mk(), ctx)).status).toBe(404);
    expect((await restore(mk(), { params: Promise.resolve({ id: "nope" }) })).status).toBe(404);
    expect(markRestored).not.toHaveBeenCalled();
    getOwn.mockResolvedValue({ status: "applied" });
    expect((await restore(mk(), ctx)).status).toBe(409);
    getOwn.mockResolvedValue({ status: "dismissed" });
    countPending.mockResolvedValueOnce(20);
    const full = await restore(mk(), ctx);
    expect(full.status).toBe(409);
    expect((await full.json()).error).toMatch(/20/);
    expect(markRestored).not.toHaveBeenCalled();
    markRestored.mockResolvedValue(false);
    expect((await restore(mk(), ctx)).status).toBe(409);
    markRestored.mockResolvedValue(true);
    const res = await restore(mk(), ctx);
    expect(res.status).toBe(200);
    expect(await res.json()).toEqual({ status: "pending" });
    expect(getOwn).toHaveBeenCalledWith("org1", "u1", ID);
    expect(markRestored).toHaveBeenCalledWith(ID, "org1", "u1");
  });
});
