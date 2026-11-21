/**
 * Plancher de classification à la copie, au déplacement et à la création.
 *
 * Règle du plafond : un document a un niveau >= celui de son espace. Copier ou
 * déplacer ne doit jamais produire un document sous le plancher de l'espace
 * cible ni sous le niveau de la source ; créer avec un niveau sous le plancher
 * est refusé.
 */
import { describe, it, expect, vi, beforeEach } from "vitest";
import { NextRequest } from "next/server";
import {
  enforceClassificationFloor,
  compareClassifications,
  type ClassificationLevel,
} from "@/lib/auth/classification";

const h = vi.hoisted(() => ({
  selectQueue: [] as unknown[][],
  insertValues: vi.fn(),
  updateSet: vi.fn(),
  createDocument: vi.fn(),
}));

function chain(result: unknown[]) {
  const c: Record<string, unknown> = {};
  const self = () => c;
  c.from = self;
  c.where = self;
  c.orderBy = self;
  c.limit = () => Promise.resolve(result);
  c.then = (res: (v: unknown) => unknown) => Promise.resolve(result).then(res);
  return c;
}

vi.mock("@/lib/db", () => ({
  db: {
    select: () => chain(h.selectQueue.shift() ?? []),
    insert: () => ({
      values: (v: unknown) => {
        h.insertValues(v);
        return { returning: async () => [{ id: "copy-1" }] };
      },
    }),
    update: () => ({
      set: (v: unknown) => {
        h.updateSet(v);
        return { where: async () => {} };
      },
    }),
  },
}));
vi.mock("@/lib/auth/get-user", () => ({
  getSessionUser: async () => ({ id: "u", name: "U", email: "u@x", globalRole: "editor" }),
}));
vi.mock("@/lib/api/auth-api", () => ({
  authenticateApiRequest: async () => ({
    user: { id: "u", name: "U", email: "u@x", orgId: "org", globalRole: "editor", scopes: [] },
  }),
  requireScope: () => null,
}));
vi.mock("@/lib/auth/check-access", async (importOriginal) => ({
  ...(await importOriginal<typeof import("@/lib/auth/check-access")>()),
  checkDocumentViewAccess: async () => true,
  checkDocumentEditAccess: async () => true,
  checkSpaceWriteAccess: async () => true,
  getSpacePermission: async () => "editor",
}));
vi.mock("@/lib/storage/filesystem", () => ({ readDocument: async () => "txt", writeDocument: async () => {} }));
vi.mock("@/lib/git/repository", () => ({ commitFile: async () => "sha" }));
vi.mock("@/lib/activity", () => ({ logActivity: () => {} }));
vi.mock("@/lib/logger", () => {
  const l: Record<string, unknown> = { error: () => {}, warn: () => {}, info: () => {}, debug: () => {} };
  l.child = () => l;
  return { default: l };
});
vi.mock("@/lib/org/scoped-space", () => ({
  getSpaceBySlugForRequest: async () => h.selectQueue.shift()?.[0] ?? null,
}));
vi.mock("@/lib/documents/create-document", async (importOriginal) => ({
  ...(await importOriginal<typeof import("@/lib/documents/create-document")>()),
  createDocument: h.createDocument,
}));
vi.mock("@/lib/onboarding/progress", () => ({ recordIfRealSpace: async () => {} }));

import { POST as copyPost } from "@/app/api/documents/[id]/copy/route";
import { POST as movePost } from "@/app/api/documents/[id]/move/route";
import { POST as v1Create } from "@/app/api/v1/documents/route";
import { POST as restCreate } from "@/app/api/spaces/[slug]/documents/route";

const LEVELS: ClassificationLevel[] = ["public", "internal", "confidential", "secret"];
const ctx = { params: Promise.resolve({ id: "doc-1" }) };
const json = (url: string, body: unknown) =>
  new NextRequest(url, { method: "POST", body: JSON.stringify(body), headers: { "content-type": "application/json" } });

const SRC = (classification: ClassificationLevel) => ({
  id: "doc-1", title: "Doc", slug: "doc", spaceId: "sp-src", filePath: "doc.md",
  contentText: "txt", isFolder: false, visibility: "team", classification,
});

beforeEach(() => {
  vi.clearAllMocks();
  h.selectQueue.length = 0;
});

describe("enforceClassificationFloor", () => {
  it("ne descend jamais sous la source ni sous le plancher, et reste minimal", () => {
    for (const doc of LEVELS) {
      for (const floor of LEVELS) {
        const out = enforceClassificationFloor(doc, floor);
        expect(compareClassifications(out, doc)).toBeGreaterThanOrEqual(0);
        expect(compareClassifications(out, floor)).toBeGreaterThanOrEqual(0);
        expect([doc, floor]).toContain(out);
      }
    }
  });
});

describe("copie et déplacement vers un espace classifié", () => {
  it("copy_into_lower_classified_space_is_refused : la copie ne descend jamais sous la source", async () => {
    h.selectQueue.push([SRC("secret")], [{ id: "sp-src", gitRepoPath: "r1" }], [{ id: "sp-dst", slug: "dst", gitRepoPath: "r2", classification: "public" }]);
    const res = await copyPost(json("http://x/api/documents/doc-1/copy", { targetSpaceSlug: "dst" }), ctx);
    expect(res.status).toBe(200);
    expect(h.insertValues).toHaveBeenCalledWith(expect.objectContaining({ classification: "secret" }));
  });

  it("la copie est relevée au plancher d'un espace plus classifié", async () => {
    h.selectQueue.push([SRC("public")], [{ id: "sp-src", gitRepoPath: "r1" }], [{ id: "sp-dst", slug: "dst", gitRepoPath: "r2", classification: "confidential" }]);
    await copyPost(json("http://x/api/documents/doc-1/copy", { targetSpaceSlug: "dst" }), ctx);
    expect(h.insertValues).toHaveBeenCalledWith(expect.objectContaining({ classification: "confidential" }));
  });

  it("move_into_lower_classified_space_is_refused : le déplacement ne déclasse pas un document secret", async () => {
    h.selectQueue.push([SRC("secret")], [{ id: "sp-dst", slug: "dst", classification: "public" }]);
    const res = await movePost(json("http://x/api/documents/doc-1/move", { targetSpaceSlug: "dst" }), ctx);
    expect(res.status).toBe(200);
    expect(h.updateSet).toHaveBeenCalledWith(expect.objectContaining({ classification: "secret" }));
  });

  it("le déplacement relève un document public au plancher de l'espace cible", async () => {
    h.selectQueue.push([SRC("public")], [{ id: "sp-dst", slug: "dst", classification: "secret" }]);
    await movePost(json("http://x/api/documents/doc-1/move", { targetSpaceSlug: "dst" }), ctx);
    expect(h.updateSet).toHaveBeenCalledWith(expect.objectContaining({ classification: "secret" }));
  });
});

describe("create_document_capped_at_space_classification", () => {
  it("api/v1 : refuse un niveau sous le plancher de l'espace", async () => {
    const SPACE = "11111111-1111-4111-8111-111111111111";
    h.selectQueue.push([{ id: SPACE, classification: "confidential" }]);
    const res = await v1Create(json("http://x/api/v1/documents", { spaceId: SPACE, title: "T", classification: "public" }));
    expect(res.status).toBe(400);
    expect(h.createDocument).not.toHaveBeenCalled();
  });

  it("REST : refuse un niveau sous le plancher de l'espace", async () => {
    h.selectQueue.push([{ id: "sp", slug: "s", gitRepoPath: "r", type: "team", classification: "confidential" }]);
    const res = await restCreate(
      json("http://x/api/spaces/s/documents", { title: "T", classification: "public" }),
      { params: Promise.resolve({ slug: "s" }) },
    );
    expect(res.status).toBe(400);
    expect(h.insertValues).not.toHaveBeenCalled();
  });
});
