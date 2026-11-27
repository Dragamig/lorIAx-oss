import { describe, it, expect, vi, beforeEach } from "vitest";

const h = vi.hoisted(() => ({
  configured: true,
  embed: vi.fn(),
  rows: [] as Array<Record<string, unknown>>,
  cond: vi.fn(),
  limit: 0,
}));

vi.mock("@/lib/ai/embeddings", () => ({
  generateEmbedding: h.embed,
  isEmbeddingConfiguredAsync: () => Promise.resolve(h.configured),
}));
vi.mock("@/lib/media/list", () => ({
  visibleMediaCondition: (...a: unknown[]) => {
    h.cond(...a);
    return Promise.resolve({ __cond: true });
  },
}));
vi.mock("@/lib/db", () => {
  const chain: Record<string, unknown> = {};
  for (const m of ["from", "innerJoin", "where", "orderBy"]) chain[m] = () => chain;
  chain.limit = (n: number) => {
    h.limit = n;
    return Promise.resolve(h.rows);
  };
  const tx = { execute: () => Promise.resolve({ rows: [] }), select: () => chain };
  return { db: { transaction: (fn: (t: unknown) => unknown) => fn(tx) } };
});

import { searchMediaSemantic, MEDIA_AI_SEARCH_MIN_LENGTH } from "./search";

const user = { id: "u1" } as never;
const row = (id: string, score: number, text = "t") => ({ mediaId: id, chunkText: text, score });

describe("searchMediaSemantic", () => {
  beforeEach(() => {
    h.configured = true;
    h.embed.mockReset().mockResolvedValue([0.1, 0.2]);
    h.cond.mockReset();
    h.rows = [];
  });

  it("rend [] sous la longueur minimale sans appeler le modèle", async () => {
    expect(await searchMediaSemantic(user, "o1", "a".repeat(MEDIA_AI_SEARCH_MIN_LENGTH - 1))).toEqual([]);
    expect(h.embed).not.toHaveBeenCalled();
  });

  it("rend [] quand aucun embedding n'est configuré", async () => {
    h.configured = false;
    expect(await searchMediaSemantic(user, "o1", "facture")).toEqual([]);
    expect(h.embed).not.toHaveBeenCalled();
  });

  it("construit la condition de visibilité en vue live, pour l'organisation demandée", async () => {
    await searchMediaSemantic(user, "o1", "facture");
    expect(h.cond).toHaveBeenCalledWith(user, "o1", "live");
  });

  it("garde le meilleur extrait par média et respecte la limite", async () => {
    h.rows = [row("m1", 0.9, "a"), row("m1", 0.8, "b"), row("m2", 0.7), row("m3", 0.6)];
    const out = await searchMediaSemantic(user, "o1", "facture", 2);
    expect(out.map((r) => r.mediaId)).toEqual(["m1", "m2"]);
    expect(out[0].chunkText).toBe("a");
  });

  it("rend [] si le modèle d'embedding échoue", async () => {
    h.embed.mockRejectedValue(new Error("boom"));
    expect(await searchMediaSemantic(user, "o1", "facture")).toEqual([]);
  });
});
