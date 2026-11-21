import { describe, it, expect, vi, beforeEach } from "vitest";

const ID = "11111111-1111-4111-8111-111111111111";
const { selectQueue, writeDocument, commitFile, rewrite } = vi.hoisted(() => ({
  selectQueue: [] as unknown[][],
  writeDocument: vi.fn(async (..._a: unknown[]) => {}),
  commitFile: vi.fn(async (..._a: unknown[]) => "sha"),
  rewrite: vi.fn(),
}));

function chain(result: unknown[]) {
  const c: Record<string, unknown> = {};
  const self = () => c;
  c.from = self; c.where = self; c.innerJoin = self; c.orderBy = self;
  c.limit = () => Promise.resolve(result);
  c.then = (res: (v: unknown) => unknown) => Promise.resolve(result).then(res);
  return c;
}

vi.mock("@/lib/db", () => ({
  db: {
    select: () => chain(selectQueue.shift() ?? []),
    delete: () => ({ where: async () => {} }),
    insert: () => ({ values: () => ({ onConflictDoNothing: async () => {} }) }),
    update: () => ({ set: () => ({ where: () => ({ returning: async () => [{ title: "T" }] }) }) }),
  },
}));
vi.mock("@/lib/auth/get-user", () => ({ getSessionUser: async () => ({ id: "u", name: "U", email: "u@x" }) }));
vi.mock("@/lib/auth/check-access", () => ({
  checkDocumentViewAccess: async () => true,
  checkDocumentEditAccess: async () => true,
}));
vi.mock("@/lib/storage/filesystem", () => ({ readDocument: async () => "", writeDocument }));
vi.mock("@/lib/git/repository", () => ({ commitFile }));
vi.mock("@/lib/graph/links", () => ({ parseWikiLinks: () => [] }));
vi.mock("@/lib/ai/embeddings", () => ({ indexDocument: async () => {} }));
vi.mock("@/lib/activity", () => ({ logActivity: () => {} }));
vi.mock("@/lib/notifications", () => ({ createNotifications: async () => {} }));
vi.mock("@/lib/auth/classification", () => ({ isClassificationAllowed: () => true }));
vi.mock("@/lib/logger", () => ({ default: { error: () => {}, warn: () => {} } }));
vi.mock("@/lib/media/attachment-key-lookup", () => ({ createOrgKeyLookup: () => async () => new Map() }));
vi.mock("@/lib/media/rewrite-document-refs", () => ({ rewriteDocumentRefs: (...a: unknown[]) => rewrite(...a) }));

import { PATCH } from "./route";

function call(content: string) {
  return PATCH(
    new Request("http://x/api/documents/d", { method: "PATCH", body: JSON.stringify({ content }) }),
    { params: Promise.resolve({ id: "d" }) },
  );
}

beforeEach(() => {
  selectQueue.length = 0;
  writeDocument.mockClear();
  commitFile.mockClear();
  rewrite.mockReset();
  selectQueue.push(
    [{ id: "d", spaceId: "s", title: "T", filePath: "f.md", isFolder: false, contentText: "" }],
    [{ id: "s", gitRepoPath: "r", organizationId: "org", classification: "internal" }],
    [], // document_collab_states : aucun état Yjs
  );
});

describe("PATCH /api/documents/[id] : réécriture B69", () => {
  it("écrit le Markdown réécrit", async () => {
    rewrite.mockResolvedValue({ markdown: `![](/api/media/${ID})`, rewritten: 1, skipped: 0 });
    const res = await call("![](/api/attachments/k)");
    expect(res.status).toBe(200);
    expect(writeDocument).toHaveBeenCalledWith("r", "f.md", `![](/api/media/${ID})`);
    expect(commitFile).toHaveBeenCalledTimes(1);
  });

  it("état Yjs existant : aucune réécriture, le texte original est écrit", async () => {
    selectQueue.length = 0;
    selectQueue.push(
      [{ id: "d", spaceId: "s", title: "T", filePath: "f.md", isFolder: false, contentText: "" }],
      [{ id: "s", gitRepoPath: "r", organizationId: "org", classification: "internal" }],
      [{ documentId: "d" }],
    );
    const res = await call("![](/api/attachments/k)");
    expect(res.status).toBe(200);
    expect(rewrite).not.toHaveBeenCalled();
    expect(writeDocument).toHaveBeenCalledWith("r", "f.md", "![](/api/attachments/k)");
  });

  it("rien à réécrire : contenu identique, un seul commit", async () => {
    rewrite.mockImplementation(async (md: string) => ({ markdown: md, rewritten: 0, skipped: 0 }));
    await call("texte");
    expect(writeDocument).toHaveBeenCalledWith("r", "f.md", "texte");
    expect(commitFile).toHaveBeenCalledTimes(1);
  });

  it("échec de la réécriture : la sauvegarde réussit avec le texte original", async () => {
    rewrite.mockRejectedValue(new Error("boom"));
    const res = await call("![](/api/attachments/k)");
    expect(res.status).toBe(200);
    expect(writeDocument).toHaveBeenCalledWith("r", "f.md", "![](/api/attachments/k)");
  });
});
