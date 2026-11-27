import { describe, it, expect, vi, beforeEach } from "vitest";

const { inserted, documentCollabStates, documents, spaces, spaceState } = vi.hoisted(() => ({
  spaceState: { classification: "internal" },
  inserted: [] as Array<{ table: unknown; values: Record<string, unknown> }>,
  documentCollabStates: { __t: "collab" },
  documents: { __t: "documents" },
  spaces: { id: "id", gitRepoPath: "g", classification: "c" },
}));

vi.mock("@/lib/db/schema", () => ({ documents, spaces, documentCollabStates, meetings: {} }));
vi.mock("drizzle-orm", () => ({ eq: vi.fn(), and: vi.fn() }));
vi.mock("@/lib/logger", () => {
  const l = { warn: vi.fn(), error: vi.fn(), info: vi.fn(), child: () => l };
  return { default: l };
});
vi.mock("@/lib/db", () => ({
  db: {
    select: () => ({
      from: () => ({
        where: () => ({
          limit: async () => [{ id: "s1", gitRepoPath: "repo", classification: spaceState.classification }],
        }),
      }),
    }),
    insert: (table: unknown) => ({
      values: (values: Record<string, unknown>) => {
        inserted.push({ table, values });
        return {
          returning: async () => [{ id: "doc1", ...values }],
          onConflictDoNothing: async () => undefined,
        };
      },
    }),
  },
}));
vi.mock("@/lib/storage/filesystem", () => ({ writeDocument: vi.fn(async () => {}) }));
vi.mock("@/lib/git/repository", () => ({ commitFile: vi.fn(async () => "sha") }));
vi.mock("@/lib/activity", () => ({ logActivity: vi.fn() }));
vi.mock("@/lib/editor/template-to-yjs", () => ({
  templateContentToYjsState: vi.fn(({ markdown }: { markdown: string }) =>
    markdown ? new Uint8Array([1, 2, 3]) : null
  ),
}));

import { createDocument } from "@/lib/documents/create-document";

const base = {
  spaceId: "s1",
  title: "Titre",
  createdBy: "u1",
  authorName: "A",
  authorEmail: "a@b.c",
};

describe("createDocument Yjs seeding", () => {
  beforeEach(() => {
    inserted.length = 0;
    spaceState.classification = "internal";
  });

  it("releve la classification demandee au plancher de l'espace", async () => {
    spaceState.classification = "confidential";
    await createDocument({ ...base, classification: "public" });
    expect(inserted.find((i) => i.table === documents)!.values.classification).toBe("confidential");
  });

  it("conserve une classification demandee superieure au plancher", async () => {
    spaceState.classification = "internal";
    await createDocument({ ...base, classification: "secret" });
    expect(inserted.find((i) => i.table === documents)!.values.classification).toBe("secret");
  });

  it("seeds the collab state when content is provided", async () => {
    await createDocument({ ...base, content: "# Hello" });
    const seed = inserted.find((i) => i.table === documentCollabStates);
    expect(seed).toBeDefined();
    const row = inserted.find((i) => i.table === documents);
    expect(seed!.values.documentId).toBe(row!.values.id);
    expect(seed!.values.yjsState).toBe(Buffer.from([1, 2, 3]).toString("base64"));
  });

  it("does not seed without content", async () => {
    await createDocument(base);
    expect(inserted.find((i) => i.table === documentCollabStates)).toBeUndefined();
  });
});
