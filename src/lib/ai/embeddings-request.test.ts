import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";

vi.mock("@/lib/db", () => ({ db: {} }));
vi.mock("@/lib/db/schema", () => ({ documentEmbeddings: {}, documents: {} }));
vi.mock("@/lib/ai/usage-logger", () => ({ logAIUsage: vi.fn() }));
vi.mock("@/lib/ai/provider-resolver", () => ({
  instanceProviderScope: vi.fn(),
  resolveEmbeddingProviderInOrg: vi.fn(),
}));
vi.mock("@/lib/settings/system-settings", () => ({
  getSetting: vi.fn(),
  setSetting: vi.fn(),
}));

import { generateEmbedding } from "./embeddings";
import { logAIUsage } from "@/lib/ai/usage-logger";

describe("generateEmbedding : corps de requête OpenAI-compatible", () => {
  const fetchMock = vi.fn();

  beforeEach(() => {
    process.env.OPENAI_API_KEY = "test-key";
    fetchMock.mockReset();
    fetchMock.mockResolvedValue({
      ok: true,
      json: async () => ({ data: [{ embedding: [0.1, 0.2] }], usage: {} }),
    });
    vi.stubGlobal("fetch", fetchMock);
  });

  afterEach(() => {
    vi.unstubAllGlobals();
  });

  async function bodyFor(model: string) {
    await generateEmbedding("bonjour", { provider: "openai", model });
    return JSON.parse(fetchMock.mock.calls[0][1].body);
  }

  it("ajoute dimensions: 1024 pour Qwen/Qwen3-Embedding-8B", async () => {
    const body = await bodyFor("Qwen/Qwen3-Embedding-8B");
    expect(body).toEqual({ input: "bonjour", model: "Qwen/Qwen3-Embedding-8B", dimensions: 1024 });
  });

  it("n'ajoute pas dimensions pour text-embedding-3-small", async () => {
    const body = await bodyFor("text-embedding-3-small");
    expect(body).toEqual({ input: "bonjour", model: "text-embedding-3-small" });
    expect(body).not.toHaveProperty("dimensions");
  });

  it("n'ajoute pas dimensions pour mistral-embed (branche mistral)", async () => {
    process.env.MISTRAL_API_KEY = "m-key";
    await generateEmbedding("bonjour", { provider: "mistral", model: "mistral-embed" });
    const body = JSON.parse(fetchMock.mock.calls[0][1].body);
    expect(body).toEqual({ model: "mistral-embed", input: ["bonjour"] });
  });

  it("log d'usage : providerId null quand le fournisseur vient de l'env (pas un uuid)", async () => {
    vi.mocked(logAIUsage).mockClear();
    await generateEmbedding("bonjour", { provider: "openai", userId: "u1" });
    expect(logAIUsage).toHaveBeenCalledWith(expect.objectContaining({ providerId: null, usageType: "embeddings" }));
  });
});
