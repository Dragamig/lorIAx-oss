import { describe, it, expect, vi, beforeEach } from "vitest";

const execute = vi.fn();
vi.mock("@/lib/db", () => ({ db: { execute: (...a: unknown[]) => execute(...a) } }));
vi.mock("@/lib/ai/embedding-dimensions", () => ({ getActiveEmbeddingDimension: async () => 768 }));

import { ensureMediaEmbeddingSchema } from "./embedding-schema";

const flat = (q: unknown) => JSON.stringify(q);

describe("ensureMediaEmbeddingSchema", () => {
  beforeEach(() => execute.mockReset());

  it("pose extension, colonne à la dimension active et index HNSW cosinus", async () => {
    await ensureMediaEmbeddingSchema();
    const all = execute.mock.calls.map((c) => flat(c[0])).join("\n");
    expect(all).toMatch(/CREATE EXTENSION IF NOT EXISTS vector/);
    expect(all).toMatch(/ALTER TABLE media_embeddings ADD COLUMN IF NOT EXISTS embedding vector\(768\)/);
    expect(all).toMatch(/USING hnsw \(embedding vector_cosine_ops\)/);
  });
});
