import { describe, it, expect, vi, beforeEach } from "vitest";

const executed: string[] = [];
const h = vi.hoisted(() => ({ enqueue: vi.fn(async () => undefined), mediaRows: [] as Array<{ id: string }> }));

vi.mock("drizzle-orm", () => ({
  sql: Object.assign(
    (strings: TemplateStringsArray) => ({ text: strings.join("") }),
    { raw: (text: string) => ({ text }) }
  ),
}));
vi.mock("@/lib/db", () => ({
  db: {
    execute: vi.fn(async (q: { text: string }) => {
      executed.push(q.text);
      if (q.text.includes("pg_attribute")) return { rows: [{ dim: 1024 }] };
      if (q.text.includes("FROM media_texts")) return { rows: h.mediaRows };
      return { rows: [] };
    }),
    select: () => ({ from: async () => [] }),
  },
}));
vi.mock("@/lib/db/schema", () => ({ documents: { id: "id" } }));
vi.mock("@/lib/settings/system-settings", () => ({
  getSetting: vi.fn(async () => null),
  setSetting: vi.fn(async () => undefined),
}));
vi.mock("@/lib/ai/provider-resolver", () => ({
  instanceProviderScope: vi.fn(async () => ({})),
  resolveEmbeddingProviderInOrg: vi.fn(async () => ({
    providerId: "infomaniak",
    model: "Qwen/Qwen3-Embedding-8B",
  })),
}));
vi.mock("@/lib/ai/embeddings", () => ({ indexDocument: vi.fn() }));
vi.mock("@/lib/kb/kb", () => ({ indexKbFromDisk: vi.fn(async () => undefined) }));
vi.mock("@/lib/media/ai/enqueue", () => ({ enqueueMediaIndex: h.enqueue }));
vi.mock("@/lib/media/ai/embedding-schema", () => ({ ensureMediaEmbeddingSchema: vi.fn(async () => undefined) }));

import { runEmbeddingReindex } from "./embedding-reindex";

describe("runEmbeddingReindex : dimension inchangée", () => {
  beforeEach(() => {
    executed.length = 0;
    h.enqueue.mockClear();
    h.mediaRows = [];
  });

  it("ne supprime ni colonne ni index quand les colonnes sont déjà en 1024", async () => {
    await runEmbeddingReindex();
    const ddl = executed.filter((t) => /DROP (INDEX|COLUMN)|ALTER TABLE|CREATE INDEX/i.test(t));
    expect(ddl).toEqual([]);
  });
});

describe("runEmbeddingReindex : phase media", () => {
  beforeEach(() => {
    executed.length = 0;
    h.enqueue.mockClear();
  });

  it("vide les vecteurs des médias puis remet en file ceux des organisations actives", async () => {
    h.mediaRows = [{ id: "m1" }, { id: "m2" }];
    await runEmbeddingReindex();
    const del = executed.findIndex((t) => t.includes("DELETE FROM media_embeddings"));
    const sel = executed.findIndex((t) => t.includes("FROM media_texts"));
    expect(del).toBeGreaterThan(-1);
    expect(sel).toBeGreaterThan(del);
    expect(h.enqueue.mock.calls).toEqual([["m1", "manual"], ["m2", "manual"]]);
  });

  it("la sélection se limite aux organisations dont l'indexation est active", async () => {
    await runEmbeddingReindex();
    expect(executed.find((t) => t.includes("FROM media_texts"))).toContain("index_enabled = true");
  });

  it("remet en pending les textes done des organisations désactivées, dont les vecteurs viennent d'être vidés", async () => {
    await runEmbeddingReindex();
    const del = executed.findIndex((t) => t.includes("DELETE FROM media_embeddings"));
    const upd = executed.findIndex((t) => t.includes("UPDATE media_texts"));
    expect(upd).toBeGreaterThan(del);
    const text = executed[upd];
    expect(text).toContain("status = 'pending'");
    expect(text).toContain("status = 'done'");
    expect(text).toContain("NOT EXISTS");
    expect(text).toContain("index_enabled = true");
  });
});
