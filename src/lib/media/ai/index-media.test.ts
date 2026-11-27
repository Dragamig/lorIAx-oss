import { describe, it, expect, vi, beforeEach } from "vitest";

const h = vi.hoisted(() => ({
  org: "o1" as string | null,
  configured: true,
  quota: { allowed: true } as { allowed: boolean; reason?: string },
  columnDim: 1024 as number | null,
  activeDim: 1024,
  embed: vi.fn(),
  locked: { current_version: 3, deleted_at: null, organization_id: "o1" } as Record<string, unknown> | null,
  statements: [] as string[],
  txRolledBack: false,
  mt: { status: "running", version: 3 } as Record<string, unknown> | null,
  ensure: vi.fn(),
}));

const render = (q: unknown) => {
  const o = q as { queryChunks?: unknown[] };
  return (o.queryChunks ?? []).map((c) => (typeof c === "object" && c && "value" in (c as object) ? String((c as { value: unknown }).value) : "")).join("");
};

vi.mock("@/lib/db", () => {
  const tx = {
    execute: (q: unknown) => {
      const text = render(q);
      h.statements.push(text);
      if (text.includes("FOR SHARE")) return Promise.resolve({ rows: h.locked ? [h.locked] : [] });
      if (text.includes("FROM media_texts") && text.includes("FOR UPDATE")) return Promise.resolve({ rows: h.mt ? [h.mt] : [] });
      return Promise.resolve({ rows: [] });
    },
  };
  return {
    db: {
      execute: (q: unknown) => {
        const text = render(q);
        if (text.includes("pg_attribute")) return Promise.resolve({ rows: h.columnDim === null ? [] : [{ dim: h.columnDim }] });
        return Promise.resolve({ rows: [] });
      },
      transaction: async (fn: (t: unknown) => Promise<unknown>) => {
        try {
          return await fn(tx);
        } catch (e) {
          h.txRolledBack = true;
          throw e;
        }
      },
    },
  };
});
vi.mock("@/lib/ai/org-scope", () => ({ orgIdForMedia: () => Promise.resolve(h.org) }));
vi.mock("@/lib/ai/embeddings", () => ({
  generateEmbedding: (...a: unknown[]) => h.embed(...a),
  isEmbeddingConfiguredAsync: () => Promise.resolve(h.configured),
  chunkText: (t: string) => {
    const out: string[] = [];
    for (let i = 0; i < t.length; i += 800) out.push(t.slice(i, i + 1000));
    return out;
  },
}));
vi.mock("@/lib/ai/embedding-dimensions", () => ({
  getActiveEmbeddingDimension: () => Promise.resolve(h.activeDim),
  resolveActiveEmbeddingModel: () => Promise.resolve("mistral-embed"),
}));
vi.mock("@/lib/ai/quota-checker", () => ({ checkQuota: () => Promise.resolve(h.quota) }));
vi.mock("./embedding-schema", () => ({ ensureMediaEmbeddingSchema: (...a: unknown[]) => h.ensure(...a) }));

import { writeMediaIndex } from "./index-media";

const input = { mediaId: "m1", organizationId: "o1", uploadedBy: "u1", text: "a".repeat(2000), version: 3, source: "pdf" as const };
const inserts = () => h.statements.filter((s) => s.includes("INSERT INTO media_embeddings")).length;

beforeEach(() => {
  h.org = "o1";
  h.configured = true;
  h.quota = { allowed: true };
  h.columnDim = 1024;
  h.activeDim = 1024;
  h.locked = { current_version: 3, deleted_at: null, organization_id: "o1" };
  h.mt = { status: "running", version: 3 };
  h.statements = [];
  h.txRolledBack = false;
  h.ensure.mockReset().mockResolvedValue(undefined);
  h.embed.mockReset().mockResolvedValue([0.1, 0.2]);
});

describe("writeMediaIndex", () => {
  it("écrit les blocs, remplace les anciens, journalise via userId, pose le schéma en différé", async () => {
    const r = await writeMediaIndex(input);
    expect(r).toEqual({ ok: true, chunks: 3 });
    expect(h.ensure).toHaveBeenCalled();
    expect(h.embed).toHaveBeenCalledWith(expect.any(String), { userId: "u1" });
    expect(h.statements.findIndex((s) => s.includes("DELETE FROM media_embeddings"))).toBeLessThan(
      h.statements.findIndex((s) => s.includes("INSERT INTO media_embeddings")),
    );
    expect(inserts()).toBe(3);
  });

  it("quota IA atteint : quota, aucun embedding, rien d'écrit", async () => {
    h.quota = { allowed: false, reason: "plein" };
    expect(await writeMediaIndex(input)).toMatchObject({ ok: false, reason: "quota" });
    expect(h.embed).not.toHaveBeenCalled();
    expect(h.statements).toEqual([]);
  });

  it("embedding non configuré : no_embedding", async () => {
    h.configured = false;
    expect(await writeMediaIndex(input)).toMatchObject({ ok: false, reason: "no_embedding" });
    expect(h.embed).not.toHaveBeenCalled();
  });

  it("un bloc dont l'embedding échoue : error global, aucune écriture (anciens blocs conservés)", async () => {
    h.embed.mockResolvedValueOnce([1]).mockRejectedValueOnce(new Error("429"));
    expect(await writeMediaIndex(input)).toMatchObject({ ok: false, reason: "error" });
    expect(h.statements).toEqual([]);
  });

  it("dimension de colonne différente : error explicite, schéma non modifié, aucun embedding", async () => {
    h.columnDim = 1536;
    const r = await writeMediaIndex(input);
    expect(r).toMatchObject({ ok: false, reason: "error" });
    expect((r as { message: string }).message).toContain("réindexation");
    expect(h.embed).not.toHaveBeenCalled();
  });

  it("organisation du média différente de celle annoncée : error, aucun embedding", async () => {
    h.org = "autre";
    expect(await writeMediaIndex(input)).toMatchObject({ ok: false, reason: "error" });
    h.org = null;
    expect(await writeMediaIndex(input)).toMatchObject({ ok: false, reason: "error" });
    expect(h.embed).not.toHaveBeenCalled();
  });

  it("média remplacé pendant le calcul : stale, aucune écriture de l'ancienne version", async () => {
    h.locked = { current_version: 4, deleted_at: null, organization_id: "o1" };
    expect(await writeMediaIndex(input)).toMatchObject({ ok: false, reason: "stale" });
    expect(inserts()).toBe(0);
    expect(h.statements.some((s) => s.includes("DELETE FROM media_embeddings"))).toBe(false);
  });

  it("média en corbeille ou supprimé pendant le calcul : stale", async () => {
    h.locked = { current_version: 3, deleted_at: new Date(), organization_id: "o1" };
    expect(await writeMediaIndex(input)).toMatchObject({ ok: false, reason: "stale" });
    h.locked = null;
    expect(await writeMediaIndex(input)).toMatchObject({ ok: false, reason: "stale" });
  });

  it("verrou de lecture sur la ligne média (FOR SHARE) avant l'écriture", async () => {
    await writeMediaIndex(input);
    expect(h.statements[0]).toContain("FOR SHARE");
  });

  it("index effacé pendant le calcul (ligne media_texts absente) : stale, rien réinséré", async () => {
    h.mt = null;
    expect(await writeMediaIndex(input)).toMatchObject({ ok: false, reason: "stale" });
    expect(inserts()).toBe(0);
    expect(h.statements.some((s) => s.includes("DELETE FROM media_embeddings"))).toBe(false);
  });

  it("ligne media_texts plus en running (remise en file) ou d'une autre version : stale", async () => {
    h.mt = { status: "pending", version: 3 };
    expect(await writeMediaIndex(input)).toMatchObject({ ok: false, reason: "stale" });
    h.mt = { status: "running", version: 4 };
    expect(await writeMediaIndex(input)).toMatchObject({ ok: false, reason: "stale" });
    expect(inserts()).toBe(0);
  });

  it("verrouille la ligne media_texts (FOR UPDATE) avant d'écrire les vecteurs", async () => {
    await writeMediaIndex(input);
    const lock = h.statements.findIndex((s) => s.includes("FROM media_texts") && s.includes("FOR UPDATE"));
    expect(lock).toBeGreaterThan(-1);
    expect(lock).toBeLessThan(h.statements.findIndex((s) => s.includes("INSERT INTO media_embeddings")));
  });
});
