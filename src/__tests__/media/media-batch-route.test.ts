import { describe, it, expect, vi, beforeEach } from "vitest";

const h = vi.hoisted(() => ({
  user: { id: "u1" } as unknown,
  org: "org1" as string | null,
  run: vi.fn(),
}));

vi.mock("@/lib/auth/get-user", () => ({ getSessionUser: () => Promise.resolve(h.user) }));
vi.mock("@/lib/org/get-request-org", () => ({ getRequestOrgId: () => Promise.resolve(h.org) }));
vi.mock("@/lib/media/tags", () => ({ TagError: class TagError extends Error { status = 400; } }));
vi.mock("@/lib/media/batch", () => {
  class BatchError extends Error {
    status = 400;
  }
  return { BATCH_MAX_IDS: 200, BatchError, runBatch: h.run };
});

import { NextRequest } from "next/server";
import { POST } from "@/app/api/media/batch/route";
import { BatchError } from "@/lib/media/batch";

const ID = "11111111-1111-4111-8111-111111111111";
const post = (body: unknown) =>
  new NextRequest("http://x", {
    method: "POST",
    body: typeof body === "string" ? body : JSON.stringify(body),
  });

beforeEach(() => {
  vi.clearAllMocks();
  h.user = { id: "u1" };
  h.org = "org1";
});

describe("POST /api/media/batch", () => {
  it("401 sans session", async () => {
    h.user = null;
    expect((await POST(post({ action: "trash", ids: [ID] }))).status).toBe(401);
  });
  it("200 même en échec partiel", async () => {
    h.run.mockResolvedValueOnce({
      results: [{ id: ID, ok: false, error: "forbidden" }],
      succeeded: 0,
      failed: 1,
    });
    const res = await POST(post({ action: "trash", ids: [ID] }));
    expect(res.status).toBe(200);
    expect((await res.json()).failed).toBe(1);
  });
  it("400 : action inconnue, trop d'ids, id non uuid, JSON invalide", async () => {
    expect((await POST(post({ action: "nuke", ids: [ID] }))).status).toBe(400);
    const many = Array.from({ length: 201 }, () => ID);
    expect((await POST(post({ action: "trash", ids: many }))).status).toBe(400);
    expect((await POST(post({ action: "trash", ids: ["x"] }))).status).toBe(400);
    expect((await POST(post({ action: "tag", ids: [], tags: ["a"] }))).status).toBe(400);
    expect((await POST(post("{"))).status).toBe(400);
    expect(h.run).not.toHaveBeenCalled();
  });
  it("BatchError du serveur : 400", async () => {
    h.run.mockRejectedValueOnce(new BatchError("Dossier introuvable"));
    const res = await POST(post({ action: "move", ids: [ID], folderId: null }));
    expect(res.status).toBe(400);
  });
});
