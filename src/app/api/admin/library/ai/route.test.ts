import { beforeEach, describe, expect, it, vi } from "vitest";
import { NextResponse } from "next/server";

const h = vi.hoisted(() => ({
  user: null as unknown,
  orgFail: false,
  membership: true,
  orgAdmin: false,
  embedding: true,
  settings: { indexEnabled: false, transcribeEnabled: false },
  set: vi.fn(),
  clear: vi.fn(),
  audit: vi.fn(),
  backfill: vi.fn(async (..._a: unknown[]) => 0),
}));

vi.mock("@/lib/auth/get-user", () => ({ getSessionUser: async () => h.user }));
vi.mock("@/lib/auth/require-org-scoped", () => {
  class OrgScopeError extends Error {
    constructor(public response: Response) {
      super("x");
    }
  }
  return {
    OrgScopeError,
    requireOrgScoped: async () => {
      if (h.orgFail) throw new OrgScopeError(NextResponse.json({ error: "Introuvable" }, { status: 404 }));
      return { orgId: "org-1" };
    },
  };
});
vi.mock("@/lib/org/resolve-request-org", () => ({ hasOrgMembershipRow: async () => h.membership }));
vi.mock("@/lib/media/access", () => ({ isOrgAdminOrOwner: async () => h.orgAdmin }));
vi.mock("@/lib/ai/embeddings", () => ({ isEmbeddingConfiguredAsync: async () => h.embedding }));
vi.mock("@/lib/meet/transcribe", () => ({ isTranscriptionEnabled: async () => true }));
vi.mock("@/lib/audit/log", () => ({ auditLog: (...a: unknown[]) => h.audit(...a) }));
vi.mock("@/lib/rate-limit", () => ({ getClientIp: () => "198.51.100.1" }));
vi.mock("@/lib/media/ai/backfill", () => ({ backfillMediaIndex: (...a: unknown[]) => h.backfill(...a) }));
vi.mock("@/lib/media/ai/settings", async () => {
  class MediaAiSettingsError extends Error {}
  return {
    MediaAiSettingsError,
    getMediaAiSettings: async () => h.settings,
    getMediaAiStats: async () => ({ pending: 1, indexed: 2, failed: 0, estimate: { media: 3, chunks: 4, audioVideo: 1 } }),
    setMediaAiSettings: (...a: unknown[]) => h.set(...a),
    clearMediaAiIndex: (...a: unknown[]) => h.clear(...a),
  };
});

import { GET, PUT, DELETE } from "./route";
import { MediaAiSettingsError } from "@/lib/media/ai/settings";

const put = (body: unknown) =>
  PUT(new Request("http://x/api/admin/library/ai", { method: "PUT", body: JSON.stringify(body) }) as never);
const del = () => DELETE(new Request("http://x/api/admin/library/ai", { method: "DELETE" }) as never);

beforeEach(() => {
  h.user = { id: "u1", globalRole: "user" };
  h.orgFail = false;
  h.membership = true;
  h.orgAdmin = true;
  h.embedding = true;
  h.settings = { indexEnabled: false, transcribeEnabled: false };
  h.set.mockReset();
  h.set.mockResolvedValue({ indexEnabled: true, transcribeEnabled: false });
  h.clear.mockReset();
  h.clear.mockResolvedValue(5);
  h.audit.mockReset();
  h.backfill.mockClear();
});

describe("/api/admin/library/ai", () => {
  it("non authentifié : 401", async () => {
    h.user = null;
    expect((await GET()).status).toBe(401);
  });

  it("membre simple : 403 en lecture, écriture et effacement", async () => {
    h.orgAdmin = false;
    expect((await GET()).status).toBe(403);
    expect((await put({ indexEnabled: true })).status).toBe(403);
    expect((await del()).status).toBe(403);
    expect(h.set).not.toHaveBeenCalled();
    expect(h.clear).not.toHaveBeenCalled();
  });

  it("admin global sans appartenance à l'organisation : 404 muet, jamais 403", async () => {
    h.user = { id: "u2", globalRole: "admin" };
    h.membership = false;
    expect((await put({ indexEnabled: true })).status).toBe(404);
    expect((await del()).status).toBe(404);
    expect(h.set).not.toHaveBeenCalled();
    expect(h.clear).not.toHaveBeenCalled();
  });

  it("organisation non résolue : réponse du garde d'organisation", async () => {
    h.orgFail = true;
    expect((await GET()).status).toBe(404);
  });

  it("admin d'organisation : lit réglages, état et estimation", async () => {
    const res = await GET();
    expect(res.status).toBe(200);
    expect(await res.json()).toEqual({
      indexEnabled: false,
      transcribeEnabled: false,
      embeddingConfigured: true,
      whisperAvailable: true,
      pending: 1,
      indexed: 2,
      failed: 0,
      estimate: { media: 3, chunks: 4, audioVideo: 1 },
    });
  });

  it("super_admin franchit sans ligne d'appartenance", async () => {
    h.user = { id: "u3", globalRole: "super_admin" };
    h.membership = false;
    h.orgAdmin = false;
    expect((await GET()).status).toBe(200);
  });

  it("PUT : écrit sur l'organisation courante seulement et trace l'audit", async () => {
    const res = await put({ indexEnabled: true });
    expect(res.status).toBe(200);
    expect(h.set).toHaveBeenCalledWith("org-1", "u1", { indexEnabled: true });
    expect(h.audit).toHaveBeenCalledWith("media.ai.settings", "u1", expect.objectContaining({ organizationId: "org-1" }), "198.51.100.1");
  });

  it("PUT : une organisation fournie par le client est refusée (corps strict)", async () => {
    expect((await put({ indexEnabled: true, organizationId: "org-2" })).status).toBe(400);
    expect(h.set).not.toHaveBeenCalled();
  });

  it("PUT : corps vide ou non booléen : 400", async () => {
    expect((await put({})).status).toBe(400);
    expect((await put({ indexEnabled: "oui" })).status).toBe(400);
  });

  it("PUT : transcription sans indexation : 400", async () => {
    h.set.mockRejectedValue(new MediaAiSettingsError("La transcription exige l'indexation du texte."));
    expect((await put({ transcribeEnabled: true })).status).toBe(400);
  });

  it("PUT : activation sans fournisseur d'embedding : 409, rien d'écrit", async () => {
    h.embedding = false;
    const res = await put({ indexEnabled: true });
    expect(res.status).toBe(409);
    expect(h.set).not.toHaveBeenCalled();
  });

  it("PUT : le passage de désactivé à activé met l'existant en file backfill", async () => {
    await put({ indexEnabled: true });
    expect(h.backfill).toHaveBeenCalledWith("org-1");
  });

  it("PUT : déjà activé ou désactivation : pas de backfill", async () => {
    h.settings = { indexEnabled: true, transcribeEnabled: false };
    await put({ indexEnabled: true });
    h.set.mockResolvedValue({ indexEnabled: false, transcribeEnabled: false });
    await put({ indexEnabled: false });
    expect(h.backfill).not.toHaveBeenCalled();
  });

  it("PUT : la désactivation reste possible sans fournisseur", async () => {
    h.embedding = false;
    expect((await put({ indexEnabled: false })).status).toBe(200);
  });

  it("DELETE : efface l'index de l'organisation courante et le trace", async () => {
    const res = await del();
    expect(res.status).toBe(200);
    expect(h.clear).toHaveBeenCalledWith("org-1");
    expect(h.audit).toHaveBeenCalledWith("media.ai.index_cleared", "u1", expect.objectContaining({ deleted: 5 }), "198.51.100.1");
  });
});
