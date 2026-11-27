/**
 * Contrôle d'accès — GET /api/attachments/[...key] et GET /api/attachments/signed
 *
 * Les deux routes servaient n'importe quel objet du bucket S3 à n'importe quel
 * utilisateur authentifié, toutes organisations confondues. Elles passent
 * désormais par `canReadStorageKey` (table `media` faisant autorité via le
 * résolveur d'accès, liste blanche de familles de clés, refus par défaut).
 */
import { describe, it, expect, vi, beforeEach } from "vitest";
import { NextRequest } from "next/server";

// ─── Lignes retournées par la requête mockée (schéma réel, db mockée) ────────
import { media, videoProjects } from "@/lib/db/schema";

const ORG_A = "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa";
const ORG_B = "bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb";
let mediaRows: unknown[] = [];
let videoProjectRows: unknown[] = [];

vi.mock("@/lib/db", () => {
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const self: any = {
    select: vi.fn(() => {
      let rows: unknown[] = [];
      const b = {
        from: vi.fn((table: unknown) => {
          rows = table === media ? mediaRows : table === videoProjects ? videoProjectRows : [];
          return b;
        }),
        innerJoin: vi.fn(() => b),
        where: vi.fn(() => b),
        limit: vi.fn(() => Promise.resolve(rows)),
      };
      return b;
    }),
  };
  return { db: self };
});

vi.mock("@/lib/org/get-request-org", () => ({
  getRequestOrgId: vi.fn(() => Promise.resolve("aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa")),
}));

vi.mock("@/lib/auth/get-user", () => ({
  getSessionUser: vi.fn().mockResolvedValue({
    id: "user-a",
    name: "User A",
    email: "a@org-a.com",
    globalRole: "user",
  }),
}));

vi.mock("@/lib/auth/check-access", () => ({
  checkSpaceReadAccess: vi.fn(),
  checkSpaceWriteAccess: vi.fn(),
}));

const s3Send = vi.fn();
vi.mock("@/lib/storage/s3", () => ({
  s3Client: { send: (...args: unknown[]) => s3Send(...args) },
  BUCKET: "loriax-files",
  getFileUrl: vi.fn().mockResolvedValue("https://s3.example/signed"),
}));
vi.mock("@aws-sdk/client-s3", () => ({
  GetObjectCommand: class {
    constructor(public input: unknown) {}
  },
  HeadObjectCommand: class {
    constructor(public input: unknown) {}
  },
}));

import { checkSpaceReadAccess } from "@/lib/auth/check-access";
import { getFileUrl } from "@/lib/storage/s3";

const mockSpaceAccess = vi.mocked(checkSpaceReadAccess);
const mockGetFileUrl = vi.mocked(getFileUrl);

const SPACE_A = "11111111-1111-4111-8111-111111111111";
const SPACE_B = "22222222-2222-4222-8222-222222222222";
const mediaRow = (spaceId: string | null, orgId = ORG_A) => ({
  id: "99999999-9999-4999-8999-999999999999",
  organizationId: orgId,
  spaceId,
  uploadedBy: "user-z",
  deletedAt: null,
  origin: "upload",
  mimeType: "image/png",
  storageKey: "k",
  filename: "photo.png",
  updatedAt: new Date(1000),
});
const PROJECT = "33333333-3333-4333-8333-333333333333";

async function getRaw(key: string) {
  const { GET } = await import("@/app/api/attachments/[...key]/route");
  return GET(new NextRequest(`http://localhost/api/attachments/${key}`), {
    params: Promise.resolve({ key: key.split("/") }),
  });
}

async function getSigned(key: string) {
  const { GET } = await import("@/app/api/attachments/signed/route");
  return GET(
    new NextRequest(
      `http://localhost/api/attachments/signed?key=${encodeURIComponent(key)}`
    )
  );
}

beforeEach(() => {
  vi.clearAllMocks();
  mediaRows = [];
  videoProjectRows = [];
  mockGetFileUrl.mockResolvedValue("https://s3.example/signed");
  s3Send.mockResolvedValue({
    Body: {
      transformToByteArray: async () => new Uint8Array([1, 2, 3]),
      transformToWebStream: () => new Response("abc").body,
    },
    ContentLength: 3,
    ContentType: "image/png",
  });
});

describe("GET /api/attachments/[...key] — contrôle d'accès", () => {
  it("refuse une clé rattachée à un espace d'une autre organisation", async () => {
    mediaRows = [mediaRow(SPACE_B)];
    mockSpaceAccess.mockResolvedValue(false);

    const res = await getRaw(`${SPACE_B}/secret.png`);

    expect(res.status).toBe(403);
    expect(s3Send).not.toHaveBeenCalled();
    expect(mockSpaceAccess).toHaveBeenCalledWith(
      expect.objectContaining({ id: "user-a" }),
      SPACE_B,
      { orgId: ORG_A }
    );
  });

  it("refuse une clé d'un média d'une autre organisation, même si l'espace répond oui", async () => {
    mediaRows = [mediaRow(SPACE_B, ORG_B)];
    mockSpaceAccess.mockResolvedValue(true);

    const res = await getRaw(`${SPACE_B}/autre-org.png`);

    expect(res.status).toBe(403);
    expect(s3Send).not.toHaveBeenCalled();
  });

  it("refuse une clé inconnue (aucune ligne media, préfixe non listé)", async () => {
    const res = await getRaw("inconnu/fichier.png");

    expect(res.status).toBe(403);
    expect(s3Send).not.toHaveBeenCalled();
  });

  it("refuse une clé avec .. même si une ligne media existe", async () => {
    mediaRows = [mediaRow(SPACE_A)];
    mockSpaceAccess.mockResolvedValue(true);

    const res = await getRaw(`${SPACE_A}/../${SPACE_B}/x.png`);

    expect(res.status).toBe(403);
    expect(s3Send).not.toHaveBeenCalled();
  });

  it("refuse studio/ et designs/ même quand une ligne media existe pour la clé", async () => {
    mediaRows = [mediaRow(SPACE_A)];
    mockSpaceAccess.mockResolvedValue(true);

    expect((await getRaw("studio/org/image.png")).status).toBe(403);
    expect((await getRaw("designs/plan.json")).status).toBe(403);
    expect(s3Send).not.toHaveBeenCalled();
  });

  it("refuse une clé designs/ (route dédiée, contournement interdit)", async () => {
    const res = await getRaw("designs/44444444-4444-4444-4444-444444444444.json");

    expect(res.status).toBe(403);
    expect(s3Send).not.toHaveBeenCalled();
  });

  it("refuse une clé studio/ (route dédiée)", async () => {
    const res = await getRaw("studio/org-b/org/image.png");

    expect(res.status).toBe(403);
    expect(s3Send).not.toHaveBeenCalled();
  });

  it("refuse une clé sans ligne en base dont le préfixe d'espace est inaccessible", async () => {
    mediaRows = [];
    mockSpaceAccess.mockResolvedValue(false);

    const res = await getRaw(`${SPACE_B}/sync-legacy.pdf`);

    expect(res.status).toBe(403);
    expect(mockSpaceAccess).toHaveBeenCalledWith(
      expect.objectContaining({ id: "user-a" }),
      SPACE_B
    );
  });

  it("refuse une clé d'une famille inconnue", async () => {
    const res = await getRaw("backups/dump.sql");

    expect(res.status).toBe(403);
    expect(s3Send).not.toHaveBeenCalled();
  });

  it("sert le fichier quand la ligne media pointe un espace accessible", async () => {
    mediaRows = [mediaRow(SPACE_A)];
    mockSpaceAccess.mockResolvedValue(true);

    const res = await getRaw(`${SPACE_A}/photo.png`);

    expect(res.status).toBe(200);
    expect(s3Send).toHaveBeenCalled();
  });

  it("autorise la lecture des avatars et du branding de l'instance", async () => {
    mediaRows = [];

    expect((await getRaw("avatars/user-a.webp")).status).toBe(200);
    expect((await getRaw("branding/logo.webp")).status).toBe(200);
  });
});

describe("GET /api/attachments/signed — contrôle d'accès", () => {
  it("n'émet aucune URL signée en cas de refus", async () => {
    mediaRows = [mediaRow(SPACE_B)];
    mockSpaceAccess.mockResolvedValue(false);

    const res = await getSigned(`${SPACE_B}/video.mp4`);

    expect(res.status).toBe(403);
    expect(mockGetFileUrl).not.toHaveBeenCalled();
    expect(await res.json()).toEqual({ error: "Accès refusé" });
  });

  it("refuse une clé designs/ sans émettre d'URL", async () => {
    const res = await getSigned("designs/44444444-4444-4444-4444-444444444444.json");

    expect(res.status).toBe(403);
    expect(mockGetFileUrl).not.toHaveBeenCalled();
  });

  it("émet une URL courte (120 s) pour un média accessible", async () => {
    mediaRows = [{ ...mediaRow(SPACE_A), storageKey: `${SPACE_A}/video-editor/clip.mp4`, filename: "clip.png" }];
    mockSpaceAccess.mockResolvedValue(true);

    const res = await getSigned(`${SPACE_A}/video-editor/clip.mp4`);

    expect(res.status).toBe(200);
    expect(mockGetFileUrl).toHaveBeenCalledWith(
      `${SPACE_A}/video-editor/clip.mp4`,
      120,
      expect.objectContaining({
        contentType: "image/png",
        contentDisposition: expect.stringMatching(/^inline/),
      })
    );
  });

  it("autorise un média video-editor/{projectId} via l'espace du projet", async () => {
    mediaRows = [];
    videoProjectRows = [{ spaceId: SPACE_A }];
    mockSpaceAccess.mockResolvedValue(true);

    const res = await getSigned(`video-editor/${PROJECT}/sources/clip.mp4`);

    expect(res.status).toBe(200);
    expect(mockSpaceAccess).toHaveBeenCalledWith(
      expect.objectContaining({ id: "user-a" }),
      SPACE_A
    );
  });

  it("refuse un média video-editor/{projectId} d'un projet hors périmètre", async () => {
    mediaRows = [];
    videoProjectRows = [{ spaceId: SPACE_B }];
    mockSpaceAccess.mockResolvedValue(false);

    const res = await getSigned(`video-editor/${PROJECT}/exports/job.mp4`);

    expect(res.status).toBe(403);
    expect(mockGetFileUrl).not.toHaveBeenCalled();
  });
});
