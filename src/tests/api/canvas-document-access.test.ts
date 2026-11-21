/**
 * Contrôle d'accès — canevas embarqués (tableau blanc, mind map, design).
 *
 * Les routes /api/whiteboard/[canvasId], /api/mindmap/[mindmapId] et
 * /api/designs/[id] chargeaient la ressource par son seul identifiant, un UUID
 * généré côté client et présent en clair dans le markdown du document. Tout
 * compte authentifié pouvait donc lire ET écraser le canevas de n'importe
 * quelle organisation.
 *
 * Le rattachement `document_id` (whiteboard_snapshots, mindmap_snapshots,
 * design_snapshots) fait désormais foi et le contrôle passe par
 * checkDocumentViewAccess / checkDocumentEditAccess, qui incluent le
 * cloisonnement multi-tenant.
 */
import { describe, it, expect, vi, beforeEach } from "vitest";
import { NextRequest } from "next/server";

/** File d'attente des lignes renvoyées par les `.limit()` successifs. */
let selectQueue: unknown[][] = [];
const insertValues: Record<string, unknown>[] = [];
const conflictSets: Record<string, unknown>[] = [];

const makeDbMock = () => {
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const self: any = {
    select: vi.fn().mockReturnThis(),
    from: vi.fn().mockReturnThis(),
    where: vi.fn().mockReturnThis(),
    limit: vi.fn(() => Promise.resolve(selectQueue.shift() ?? [])),
    insert: vi.fn().mockReturnThis(),
    values: vi.fn((v: Record<string, unknown>) => {
      insertValues.push(v);
      return self;
    }),
    onConflictDoUpdate: vi.fn((arg: { set: Record<string, unknown> }) => {
      conflictSets.push(arg.set);
      return Promise.resolve();
    }),
  };
  return self;
};

vi.mock("@/lib/auth/get-user", () => ({
  getSessionUser: vi.fn().mockResolvedValue({
    id: "user-a",
    name: "User A",
    email: "a@org-a.com",
    globalRole: "user",
  }),
}));

vi.mock("@/lib/auth/check-access", () => ({
  checkDocumentViewAccess: vi.fn(),
  checkDocumentEditAccess: vi.fn(),
}));

vi.mock("@/lib/db", () => ({ db: makeDbMock() }));

vi.mock("@/lib/storage/s3", () => ({
  s3Client: { send: vi.fn().mockRejectedValue({ name: "NoSuchKey" }) },
  BUCKET: "bucket",
  uploadFile: vi.fn().mockResolvedValue(undefined),
}));

import {
  checkDocumentViewAccess,
  checkDocumentEditAccess,
} from "@/lib/auth/check-access";
import { uploadFile } from "@/lib/storage/s3";

const mockView = vi.mocked(checkDocumentViewAccess);
const mockEdit = vi.mocked(checkDocumentEditAccess);
const mockUpload = vi.mocked(uploadFile);

const CANVAS = "11111111-1111-4111-8111-111111111111";
const DOC_MINE = "22222222-2222-4222-8222-222222222222";
const DOC_OTHER = "33333333-3333-4333-8333-333333333333";

const req = (
  url: string,
  init?: { method?: string; body?: unknown }
): NextRequest =>
  new NextRequest(`http://localhost${url}`, {
    method: init?.method ?? "GET",
    ...(init?.body !== undefined
      ? {
          body: JSON.stringify(init.body),
          headers: { "content-type": "application/json" },
        }
      : {}),
  });

beforeEach(() => {
  vi.clearAllMocks();
  selectQueue = [];
  insertValues.length = 0;
  conflictSets.length = 0;
});

// ─────────────────────────────────────────────────────────────────────────────
describe("Lecture cross-org refusée", () => {
  it("whiteboard : 403 quand le document porteur est hors de portée", async () => {
    selectQueue = [
      [{ canvasId: CANVAS, documentId: DOC_OTHER, snapshot: '{"elements":[1]}' }],
      [{ spaceId: "space-org-b" }],
    ];
    mockView.mockResolvedValue(false);

    const { GET } = await import("@/app/api/whiteboard/[canvasId]/route");
    const res = await GET(req(`/api/whiteboard/${CANVAS}`), {
      params: Promise.resolve({ canvasId: CANVAS }),
    });

    expect(res.status).toBe(403);
    expect(mockView).toHaveBeenCalledWith(
      expect.objectContaining({ id: "user-a" }),
      "space-org-b",
      DOC_OTHER
    );
  });

  it("mindmap : 403 quand le document porteur est hors de portée", async () => {
    selectQueue = [
      [{ mindmapId: CANVAS, documentId: DOC_OTHER, data: "secret" }],
      [{ spaceId: "space-org-b" }],
    ];
    mockView.mockResolvedValue(false);

    const { GET } = await import("@/app/api/mindmap/[mindmapId]/route");
    const res = await GET(req(`/api/mindmap/${CANVAS}`), {
      params: Promise.resolve({ mindmapId: CANVAS }),
    });

    expect(res.status).toBe(403);
    expect(await res.json()).not.toHaveProperty("data", "secret");
  });

  it("design : 403 sans jamais lire l'objet S3", async () => {
    selectQueue = [[{ documentId: DOC_OTHER }], [{ spaceId: "space-org-b" }]];
    mockView.mockResolvedValue(false);

    const { GET } = await import("@/app/api/designs/[id]/route");
    const res = await GET(req(`/api/designs/${CANVAS}`), {
      params: Promise.resolve({ id: CANVAS }),
    });

    expect(res.status).toBe(403);
  });

  it("whiteboard : 403 fail-closed sur une ligne restée sans rattachement", async () => {
    selectQueue = [[{ canvasId: CANVAS, documentId: null, snapshot: "{}" }]];

    const { GET } = await import("@/app/api/whiteboard/[canvasId]/route");
    const res = await GET(req(`/api/whiteboard/${CANVAS}`), {
      params: Promise.resolve({ canvasId: CANVAS }),
    });

    expect(res.status).toBe(403);
    expect(mockView).not.toHaveBeenCalled();
  });
});

// ─────────────────────────────────────────────────────────────────────────────
describe("Écriture cross-org refusée", () => {
  it("whiteboard : 403 et aucun upsert", async () => {
    selectQueue = [[{ documentId: DOC_OTHER }], [{ spaceId: "space-org-b" }]];
    mockEdit.mockResolvedValue(false);

    const { POST } = await import("@/app/api/whiteboard/[canvasId]/route");
    const res = await POST(
      req(`/api/whiteboard/${CANVAS}?documentId=${DOC_MINE}`, {
        method: "POST",
        body: { elements: [] },
      }),
      { params: Promise.resolve({ canvasId: CANVAS }) }
    );

    expect(res.status).toBe(403);
    expect(insertValues).toHaveLength(0);
  });

  it("mindmap : 403 et aucun upsert", async () => {
    selectQueue = [[{ documentId: DOC_OTHER }], [{ spaceId: "space-org-b" }]];
    mockEdit.mockResolvedValue(false);

    const { POST } = await import("@/app/api/mindmap/[mindmapId]/route");
    const res = await POST(
      req(`/api/mindmap/${CANVAS}?documentId=${DOC_MINE}`, {
        method: "POST",
        body: { data: "{}" },
      }),
      { params: Promise.resolve({ mindmapId: CANVAS }) }
    );

    expect(res.status).toBe(403);
    expect(insertValues).toHaveLength(0);
  });

  it("design : 403 et aucun envoi S3", async () => {
    selectQueue = [[{ documentId: DOC_OTHER }], [{ spaceId: "space-org-b" }]];
    mockEdit.mockResolvedValue(false);

    const { PUT } = await import("@/app/api/designs/[id]/route");
    const res = await PUT(
      req(`/api/designs/${CANVAS}?documentId=${DOC_MINE}`, {
        method: "PUT",
        body: { objects: [] },
      }),
      { params: Promise.resolve({ id: CANVAS }) }
    );

    expect(res.status).toBe(403);
    expect(mockUpload).not.toHaveBeenCalled();
  });
});

// ─────────────────────────────────────────────────────────────────────────────
describe("Le documentId client est ignoré quand la base en porte un", () => {
  it("whiteboard : le contrôle et l'upsert portent sur le document stocké", async () => {
    selectQueue = [[{ documentId: DOC_OTHER }], [{ spaceId: "space-stocke" }]];
    mockEdit.mockResolvedValue(true);

    const { POST } = await import("@/app/api/whiteboard/[canvasId]/route");
    const res = await POST(
      req(`/api/whiteboard/${CANVAS}?documentId=${DOC_MINE}`, {
        method: "POST",
        body: { elements: [] },
      }),
      { params: Promise.resolve({ canvasId: CANVAS }) }
    );

    expect(res.status).toBe(200);
    expect(mockEdit).toHaveBeenCalledWith(
      expect.objectContaining({ id: "user-a" }),
      "space-stocke",
      DOC_OTHER
    );
    expect(mockEdit).not.toHaveBeenCalledWith(
      expect.anything(),
      expect.anything(),
      DOC_MINE
    );
    expect(insertValues[0].documentId).toBe(DOC_OTHER);
    expect(conflictSets[0].documentId).toBe(DOC_OTHER);
  });
});

// ─────────────────────────────────────────────────────────────────────────────
describe("Adoption d'une ligne orpheline", () => {
  it("refusée sans droit d'édition sur le document annoncé", async () => {
    selectQueue = [
      [{ documentId: null }], // ligne orpheline
      [{ spaceId: "space-a" }], // spaceId du document annoncé
    ];
    mockEdit.mockResolvedValue(false);

    const { POST } = await import("@/app/api/whiteboard/[canvasId]/route");
    const res = await POST(
      req(`/api/whiteboard/${CANVAS}?documentId=${DOC_MINE}`, {
        method: "POST",
        body: { elements: [] },
      }),
      { params: Promise.resolve({ canvasId: CANVAS }) }
    );

    expect(res.status).toBe(403);
    expect(insertValues).toHaveLength(0);
  });

  it("refusée si le document ne cite pas l'identifiant du canevas", async () => {
    selectQueue = [
      [{ documentId: null }],
      [{ spaceId: "space-a" }],
      [], // le document ne contient pas l'identifiant
    ];
    mockEdit.mockResolvedValue(true);

    const { POST } = await import("@/app/api/whiteboard/[canvasId]/route");
    const res = await POST(
      req(`/api/whiteboard/${CANVAS}?documentId=${DOC_MINE}`, {
        method: "POST",
        body: { elements: [] },
      }),
      { params: Promise.resolve({ canvasId: CANVAS }) }
    );

    expect(res.status).toBe(403);
    expect(insertValues).toHaveLength(0);
  });

  it("acceptée quand le droit existe et que l'identifiant figure au contenu", async () => {
    selectQueue = [
      [{ documentId: null }],
      [{ spaceId: "space-a" }],
      [{ id: DOC_MINE }], // le document cite bien l'identifiant
    ];
    mockEdit.mockResolvedValue(true);

    const { POST } = await import("@/app/api/whiteboard/[canvasId]/route");
    const res = await POST(
      req(`/api/whiteboard/${CANVAS}?documentId=${DOC_MINE}`, {
        method: "POST",
        body: { elements: [] },
      }),
      { params: Promise.resolve({ canvasId: CANVAS }) }
    );

    expect(res.status).toBe(200);
    expect(insertValues[0].documentId).toBe(DOC_MINE);
    expect(conflictSets[0].documentId).toBe(DOC_MINE);
  });
});

// ─────────────────────────────────────────────────────────────────────────────
describe("Création", () => {
  it("rattache la ligne neuve dans le même insert, sans exiger le contenu", async () => {
    selectQueue = [
      [], // aucune ligne : création
      [{ spaceId: "space-a" }],
    ];
    mockEdit.mockResolvedValue(true);

    const { POST } = await import("@/app/api/mindmap/[mindmapId]/route");
    const res = await POST(
      req(`/api/mindmap/${CANVAS}?documentId=${DOC_MINE}`, {
        method: "POST",
        body: { data: "{}" },
      }),
      { params: Promise.resolve({ mindmapId: CANVAS }) }
    );

    expect(res.status).toBe(200);
    expect(insertValues[0].documentId).toBe(DOC_MINE);
  });

  it("400 si le client n'annonce aucun document porteur", async () => {
    selectQueue = [[]];

    const { POST } = await import("@/app/api/mindmap/[mindmapId]/route");
    const res = await POST(
      req(`/api/mindmap/${CANVAS}`, { method: "POST", body: { data: "{}" } }),
      { params: Promise.resolve({ mindmapId: CANVAS }) }
    );

    expect(res.status).toBe(400);
    expect(insertValues).toHaveLength(0);
  });
});
