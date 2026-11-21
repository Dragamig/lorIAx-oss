/**
 * Garde de déclassification : PATCH /api/documents/[id] et PATCH /api/v1/documents/[id].
 *
 * Un éditeur d'espace qui n'a pas le droit de lire un document `secret` ne doit
 * pas pouvoir l'abaisser en `internal` puis le relire. Modifier la classification
 * exige le droit de lecture ; l'abaisser exige en plus d'être auteur, admin
 * d'espace, propriétaire de l'espace ou admin global.
 */
import { describe, it, expect, vi, beforeEach } from "vitest";

const h = vi.hoisted(() => ({
  selectQueue: [] as unknown[][],
  updateSet: vi.fn(),
  view: vi.fn(),
  edit: vi.fn(),
  declassify: vi.fn(),
}));

function chain(result: unknown[]) {
  const c: Record<string, unknown> = {};
  const self = () => c;
  c.from = self;
  c.where = self;
  c.innerJoin = self;
  c.orderBy = self;
  c.limit = () => Promise.resolve(result);
  c.then = (res: (v: unknown) => unknown) => Promise.resolve(result).then(res);
  return c;
}

vi.mock("@/lib/db", () => ({
  db: {
    select: () => chain(h.selectQueue.shift() ?? []),
    delete: () => ({ where: async () => {} }),
    insert: () => ({ values: () => ({ onConflictDoNothing: async () => {} }) }),
    update: () => ({
      set: (v: unknown) => {
        h.updateSet(v);
        return { where: () => ({ returning: async () => [{ id: "d", title: "T" }] }) };
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
  checkDocumentViewAccess: h.view,
  checkDocumentEditAccess: h.edit,
  checkDocumentDeclassifyAccess: h.declassify,
}));
vi.mock("@/lib/storage/filesystem", () => ({ readDocument: async () => "", writeDocument: async () => {} }));
vi.mock("@/lib/git/repository", () => ({ commitFile: async () => "sha" }));
vi.mock("@/lib/graph/links", () => ({ parseWikiLinks: () => [] }));
vi.mock("@/lib/ai/embeddings", () => ({ indexDocument: async () => {} }));
vi.mock("@/lib/activity", () => ({ logActivity: () => {} }));
vi.mock("@/lib/notifications", () => ({ createNotifications: async () => {} }));
vi.mock("@/lib/logger", () => ({ default: { error: () => {}, warn: () => {} } }));
vi.mock("@/lib/webhooks/dispatch", () => ({
  dispatchWebhookEvent: () => {},
  organizationIdOfSpace: async () => "org",
}));

import { PATCH as restPatch } from "@/app/api/documents/[id]/route";
import { PATCH as v1Patch } from "@/app/api/v1/documents/[id]/route";

const ctx = { params: Promise.resolve({ id: "d" }) };
const req = (body: unknown) =>
  new Request("http://x/api/documents/d", { method: "PATCH", body: JSON.stringify(body) });

function seed() {
  h.selectQueue.length = 0;
  h.selectQueue.push(
    [{ id: "d", spaceId: "s", title: "T", filePath: "f.md", isFolder: false, classification: "secret", createdBy: "autre" }],
    [{ id: "s", gitRepoPath: "r", organizationId: "org", classification: "internal" }],
    [],
  );
}

beforeEach(() => {
  vi.clearAllMocks();
  h.view.mockResolvedValue(true);
  h.edit.mockResolvedValue(true);
  h.declassify.mockResolvedValue(true);
  seed();
});

type PatchHandler = (
  request: Request,
  ctx: { params: Promise<{ id: string }> },
) => Promise<Response>;

const surfaces: [string, PatchHandler][] = [
  ["REST", restPatch],
  ["api/v1", v1Patch],
];

describe.each(surfaces)("PATCH classification (%s)", (_name, patch) => {
  it("patch_cannot_lower_classification_without_permission", async () => {
    h.declassify.mockResolvedValue(false);
    const res = await patch(req({ classification: "internal" }), ctx);
    expect(res.status).toBe(403);
    expect(h.updateSet).not.toHaveBeenCalled();
  });

  it("refuse tout changement de classification sans droit de lecture", async () => {
    h.view.mockResolvedValue(false);
    const res = await patch(req({ classification: "internal" }), ctx);
    expect(res.status).toBe(403);
    expect(h.updateSet).not.toHaveBeenCalled();
  });

  it("autorise la déclassification pour qui en a le droit", async () => {
    const res = await patch(req({ classification: "internal" }), ctx);
    expect(res.status).toBe(200);
    expect(h.updateSet).toHaveBeenCalledWith(expect.objectContaining({ classification: "internal" }));
  });

  it("un relèvement de classification ne demande pas le droit de déclasser", async () => {
    h.selectQueue[0][0] = { ...(h.selectQueue[0][0] as object), classification: "internal" };
    h.declassify.mockResolvedValue(false);
    const res = await patch(req({ classification: "secret" }), ctx);
    expect(res.status).toBe(200);
  });

  it("une modification sans classification ne demande ni lecture ni déclassification", async () => {
    h.view.mockResolvedValue(false);
    h.declassify.mockResolvedValue(false);
    const res = await patch(req({ title: "Nouveau" }), ctx);
    expect(res.status).toBe(200);
  });
});
