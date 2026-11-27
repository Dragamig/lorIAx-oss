import { describe, it, expect } from "vitest";
import {
  dimensionForModel,
  KNOWN_EMBEDDING_DIMENSIONS,
  DEFAULT_EMBEDDING_DIMENSION,
  requestedEmbeddingDimensions,
} from "./embedding-dimensions";

describe("dimensionForModel", () => {
  it("résout les modèles connus exacts", () => {
    expect(dimensionForModel("mistral-embed")).toBe(1024);
    expect(dimensionForModel("text-embedding-3-small")).toBe(1536);
    expect(dimensionForModel("text-embedding-3-large")).toBe(3072);
    expect(dimensionForModel("text-embedding-ada-002")).toBe(1536);
    expect(dimensionForModel("bge-m3")).toBe(1024);
    expect(dimensionForModel("multilingual-e5-large")).toBe(1024);
    expect(dimensionForModel("nomic-embed-text")).toBe(768);
  });

  it("résout les modèles Infomaniak", () => {
    expect(dimensionForModel("qwen3-embedding-8b")).toBe(1024);
    expect(dimensionForModel("Qwen/Qwen3-Embedding-8B")).toBe(1024);
    expect(dimensionForModel("bge_multilingual_gemma2")).toBe(3584);
    expect(dimensionForModel("mini_lm_l12_v2")).toBe(384);
  });

  it("est insensible à la casse", () => {
    expect(dimensionForModel("Mistral-Embed")).toBe(1024);
    expect(dimensionForModel("TEXT-EMBEDDING-3-LARGE")).toBe(3072);
  });

  it("tolère les préfixes fournisseur", () => {
    expect(dimensionForModel("openai/text-embedding-3-small")).toBe(1536);
    expect(dimensionForModel("mistral/mistral-embed")).toBe(1024);
    expect(dimensionForModel("BAAI/bge-m3")).toBe(1024);
  });

  it("tolère les suffixes de tag/quantization", () => {
    expect(dimensionForModel("bge-m3:latest")).toBe(1024);
    expect(dimensionForModel("nomic-embed-text:v1.5")).toBe(768);
  });

  it("renvoie null pour un modèle inconnu", () => {
    expect(dimensionForModel("modele-maison-inconnu")).toBeNull();
    expect(dimensionForModel("")).toBeNull();
    expect(dimensionForModel(null)).toBeNull();
    expect(dimensionForModel(undefined)).toBeNull();
  });

  it("expose une table et un défaut cohérents", () => {
    expect(KNOWN_EMBEDDING_DIMENSIONS["mistral-embed"]).toBe(1024);
    expect(DEFAULT_EMBEDDING_DIMENSION).toBe(1024);
  });
});

describe("requestedEmbeddingDimensions", () => {
  it("demande 1024 pour qwen3-embedding-8b, casse et préfixe ignorés", () => {
    expect(requestedEmbeddingDimensions("qwen3-embedding-8b")).toBe(1024);
    expect(requestedEmbeddingDimensions("Qwen/Qwen3-Embedding-8B")).toBe(1024);
  });

  it("ne demande rien pour les autres modèles", () => {
    expect(requestedEmbeddingDimensions("mistral-embed")).toBeUndefined();
    expect(requestedEmbeddingDimensions("text-embedding-3-small")).toBeUndefined();
    expect(requestedEmbeddingDimensions("bge_multilingual_gemma2")).toBeUndefined();
    expect(requestedEmbeddingDimensions(null)).toBeUndefined();
  });
});
