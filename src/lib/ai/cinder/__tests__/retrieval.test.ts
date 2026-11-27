import { describe, it, expect, vi, beforeEach } from "vitest";

const h = vi.hoisted(() => ({
  searchKb: vi.fn(),
  searchSemantic: vi.fn(),
  embedding: vi.fn(),
  moduleActive: vi.fn(),
  media: vi.fn(),
  dbDocs: [] as { id: string; classification: string }[],
}));

vi.mock("@/lib/kb/kb", () => ({ searchKb: h.searchKb }));
vi.mock("@/lib/ai/embeddings", () => ({
  searchSemantic: h.searchSemantic,
  isEmbeddingConfiguredAsync: h.embedding,
}));
vi.mock("@/lib/ai/rerank", () => ({
  rerankCandidates: vi.fn(async () => []),
  fetchLimitForRerank: vi.fn(() => 5),
}));
vi.mock("@/lib/ai/sanitize-content", () => ({ sanitizeRagContent: (s: string) => s }));
vi.mock("@/lib/modules/enablement", () => ({ isModuleActive: h.moduleActive }));
vi.mock("@/lib/media/ai/content-search", () => ({ buildMediaChatContext: h.media }));
vi.mock("@/lib/db", () => ({
  db: { select: () => ({ from: () => ({ where: async () => h.dbDocs }) }) },
}));

import {
  buildDocumentContext,
  buildMediaContext,
  buildProductDocs,
} from "../retrieval";

const USER = { id: "u1", email: "a@b.c", name: "A", role: "user" } as never;

beforeEach(() => {
  Object.values(h).forEach((v) => typeof v === "function" && "mockReset" in v && v.mockReset());
  h.dbDocs = [];
});

describe("buildProductDocs", () => {
  it("joint les extraits assainis", async () => {
    h.searchKb.mockResolvedValue([{ chunkText: "a" }, { chunkText: "b" }]);
    expect(await buildProductDocs("kanban", "u1")).toBe("a\n\n---\n\nb");
    expect(h.searchKb).toHaveBeenCalledWith("kanban", 3, "u1");
  });
  it("renvoie vide si searchKb échoue", async () => {
    vi.spyOn(console, "error").mockImplementation(() => {});
    h.searchKb.mockRejectedValue(new Error("x"));
    expect(await buildProductDocs("kanban", "u1")).toBe("");
  });
  it("requête courte : aucun appel", async () => {
    expect(await buildProductDocs("abc", "u1")).toBe("");
    expect(h.searchKb).not.toHaveBeenCalled();
  });
});

describe("buildDocumentContext", () => {
  const base = { query: "préavis de résiliation", user: USER, orgId: "o1" };
  it("sans espace : vide, sans embedding", async () => {
    expect(await buildDocumentContext({ ...base, spaceIds: [], admin: false })).toBe("");
    expect(h.embedding).not.toHaveBeenCalled();
  });
  it("non-admin : retire les documents secret", async () => {
    h.embedding.mockResolvedValue(true);
    h.searchSemantic.mockResolvedValue([
      { documentId: "d1", chunkText: "public" },
      { documentId: "d2", chunkText: "confidentiel" },
    ]);
    h.dbDocs = [
      { id: "d1", classification: "public" },
      { id: "d2", classification: "secret" },
    ];
    const out = await buildDocumentContext({ ...base, spaceIds: ["s1"], admin: false });
    expect(out).toBe("public");
  });
  it("admin : conserve tout", async () => {
    h.embedding.mockResolvedValue(true);
    h.searchSemantic.mockResolvedValue([
      { documentId: "d1", chunkText: "public" },
      { documentId: "d2", chunkText: "confidentiel" },
    ]);
    const out = await buildDocumentContext({ ...base, spaceIds: ["s1"], admin: true });
    expect(out).toBe("public\n\n---\n\nconfidentiel");
  });
});

describe("buildMediaContext", () => {
  it("module library inactif : vide", async () => {
    h.moduleActive.mockResolvedValue(false);
    expect(await buildMediaContext({ query: "quel préavis", user: USER, orgId: "o1" })).toBe("");
    expect(h.media).not.toHaveBeenCalled();
  });
  it("orgId null : vide", async () => {
    expect(await buildMediaContext({ query: "quel préavis", user: USER, orgId: null })).toBe("");
    expect(h.moduleActive).not.toHaveBeenCalled();
  });
  it("module actif : délègue", async () => {
    h.moduleActive.mockResolvedValue(true);
    h.media.mockResolvedValue("<m/>");
    expect(await buildMediaContext({ query: "quel préavis", user: USER, orgId: "o1" })).toBe("<m/>");
    expect(h.media).toHaveBeenCalledWith(USER, "o1", "quel préavis");
  });
});
