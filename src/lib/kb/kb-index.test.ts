import { mkdtempSync, writeFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

// ------------------------------------------------------------------
// Doublures : la fonction d'indexation parle à Postgres et au fournisseur
// d'embeddings. On remplace les deux pour observer ce que le résumé compte.
// ------------------------------------------------------------------

/** Texte SQL approximatif d'un objet `sql` drizzle (dispatch des doublures). */
function sqlText(query: unknown): string {
  const chunks = (query as { queryChunks?: unknown[] })?.queryChunks ?? [];
  return chunks
    .map((c) =>
      Array.isArray((c as { value?: unknown[] })?.value)
        ? (c as { value: unknown[] }).value.join("")
        : ""
    )
    .join(" ");
}

const executeMock = vi.fn();
const returningMock = vi.fn();
const insertMock = vi.fn((_table: unknown) => ({
  values: (_values: unknown) => ({ returning: returningMock }),
}));

vi.mock("@/lib/db", () => ({
  db: {
    execute: (q: unknown) => executeMock(q),
    insert: (t: unknown) => insertMock(t),
  },
}));

const generateEmbeddingMock = vi.fn();
vi.mock("@/lib/ai/embeddings", () => ({
  generateEmbedding: (...args: unknown[]) => generateEmbeddingMock(...args),
  isEmbeddingConfiguredAsync: async () => true,
}));

vi.mock("@/lib/ai/embedding-dimensions", () => ({
  getActiveEmbeddingDimension: async () => 4,
}));

vi.mock("@/lib/logger", () => ({
  default: {
    error: vi.fn(),
    warn: vi.fn(),
    info: vi.fn(),
    debug: vi.fn(),
  },
}));

import { hashChunk, indexKbFromDisk, kbIndexVerdict, formatKbSummary } from "./kb";

/** Vecteur de la dimension attendue par la colonne (4 dans ces tests). */
const VALID_VECTOR = [0.1, 0.2, 0.3, 0.4];

let kbDir: string;

/** Rend le SELECT des chunks existants pour piloter le « déjà indexé ». */
function withExistingChunks(existing: Array<{ chunk_index: number; content_hash: string }>) {
  executeMock.mockImplementation(async (query: unknown) => {
    const text = sqlText(query);
    if (text.includes("SELECT chunk_index, content_hash")) {
      return { rows: existing, rowCount: existing.length };
    }
    if (text.includes("SELECT DISTINCT source")) {
      return { rows: [], rowCount: 0 };
    }
    return { rows: [], rowCount: 0 };
  });
}

beforeEach(() => {
  vi.clearAllMocks();
  kbDir = mkdtempSync(path.join(tmpdir(), "kb-index-test-"));
  writeFileSync(
    path.join(kbDir, "guide.md"),
    `---\ntitle: "Guide"\n---\nPremier paragraphe.\n\nDeuxième paragraphe.`,
    "utf8"
  );
  withExistingChunks([]);
  returningMock.mockResolvedValue([{ id: "chunk-id" }]);
  generateEmbeddingMock.mockResolvedValue(VALID_VECTOR);
});

afterEach(() => {
  rmSync(kbDir, { recursive: true, force: true });
});

describe("indexKbFromDisk — comptage des échecs", () => {
  it("compte tous les fragments en échec quand l'embedding est refusé", async () => {
    generateEmbeddingMock.mockRejectedValue(
      new Error("OPENAI_API_KEY requis pour les embeddings")
    );

    const summary = await indexKbFromDisk(kbDir);

    expect(summary.sources).toBe(1);
    expect(summary.chunksIndexed).toBe(0);
    expect(summary.chunksFailed).toBeGreaterThan(0);
    expect(kbIndexVerdict(summary).ok).toBe(false);
  });

  it("n'écrit rien et compte un échec si la dimension du vecteur ne correspond pas", async () => {
    // Colonne attendue en dimension 4, le fournisseur rend 3 valeurs.
    generateEmbeddingMock.mockResolvedValue([0.1, 0.2, 0.3]);

    const summary = await indexKbFromDisk(kbDir);

    expect(summary.chunksIndexed).toBe(0);
    expect(summary.chunksFailed).toBeGreaterThan(0);
    expect(insertMock).not.toHaveBeenCalled();
    expect(kbIndexVerdict(summary).ok).toBe(false);
  });

  it("compte zéro échec et zéro indexation quand rien n'a changé", async () => {
    const body = "Premier paragraphe.\n\nDeuxième paragraphe.";
    withExistingChunks([{ chunk_index: 0, content_hash: hashChunk(body) }]);

    const summary = await indexKbFromDisk(kbDir);

    expect(summary.chunksIndexed).toBe(0);
    expect(summary.chunksSkipped).toBe(1);
    expect(summary.chunksFailed).toBe(0);
    expect(generateEmbeddingMock).not.toHaveBeenCalled();
    expect(kbIndexVerdict(summary).ok).toBe(true);
  });

  it("compte un échec quand l'écriture du vecteur échoue, et retire la ligne orpheline", async () => {
    const deleted: string[] = [];
    executeMock.mockImplementation(async (query: unknown) => {
      const text = sqlText(query);
      if (text.includes("SELECT chunk_index, content_hash")) return { rows: [], rowCount: 0 };
      if (text.includes("SELECT DISTINCT source")) return { rows: [], rowCount: 0 };
      if (text.includes("UPDATE kb_chunks SET embedding")) {
        throw new Error("expected 4 dimensions, not 1536");
      }
      if (text.includes("DELETE FROM kb_chunks WHERE id")) {
        deleted.push(text);
      }
      return { rows: [], rowCount: 0 };
    });

    const summary = await indexKbFromDisk(kbDir);

    expect(summary.chunksIndexed).toBe(0);
    expect(summary.chunksFailed).toBe(1);
    // La ligne insérée avant l'échec porte le hash à jour sans vecteur : sans
    // nettoyage elle serait « ignorée » à jamais et jamais servie.
    expect(deleted).toHaveLength(1);
  });
});

describe("kbIndexVerdict", () => {
  const base = {
    sources: 3,
    chunksIndexed: 0,
    chunksSkipped: 0,
    chunksDeleted: 0,
    chunksFailed: 0,
  };

  it("échoue quand tous les fragments ont échoué", () => {
    const verdict = kbIndexVerdict({ ...base, chunksFailed: 42 });
    expect(verdict.ok).toBe(false);
    expect(verdict.reason).toContain("42");
  });

  it("échoue aussi sur un échec partiel", () => {
    const verdict = kbIndexVerdict({ ...base, chunksIndexed: 5, chunksFailed: 5 });
    expect(verdict.ok).toBe(false);
    expect(verdict.reason).toContain("partiel");
  });

  it("réussit quand rien n'a changé depuis la dernière indexation", () => {
    const verdict = kbIndexVerdict({ ...base, chunksSkipped: 120 });
    expect(verdict.ok).toBe(true);
    expect(verdict.reason).toContain("rien à faire");
  });

  it("réussit sur une indexation complète", () => {
    const verdict = kbIndexVerdict({ ...base, chunksIndexed: 12 });
    expect(verdict.ok).toBe(true);
  });

  it("échoue si des sources ont été lues sans aucun fragment retenu", () => {
    expect(kbIndexVerdict(base).ok).toBe(false);
  });

  it("réussit sur une base vide (aucune source)", () => {
    expect(kbIndexVerdict({ ...base, sources: 0 }).ok).toBe(true);
  });
});

describe("formatKbSummary", () => {
  it("rend le nombre d'échecs dans le résumé affiché", () => {
    const line = formatKbSummary({
      sources: 10,
      chunksIndexed: 0,
      chunksSkipped: 0,
      chunksDeleted: 0,
      chunksFailed: 41,
    });
    expect(line).toBe(
      "sources=10 indexés=0 ignorés=0 supprimés=0 échoués=41"
    );
  });
});
