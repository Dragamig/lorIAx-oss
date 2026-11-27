import { describe, it, expect } from "vitest";
import { chunkMediaText } from "./chunking";
import { MAX_CHUNKS } from "./limits";

describe("chunkMediaText", () => {
  it("texte vide : aucun bloc", () => {
    expect(chunkMediaText("   ", "pdf")).toEqual([]);
  });

  it("texte ordinaire : découpage de chunkText", () => {
    const out = chunkMediaText("a".repeat(2500), "pdf");
    expect(out.length).toBeGreaterThan(2);
    expect(out[0]).toHaveLength(1000);
  });

  it("borne le nombre de blocs à MAX_CHUNKS", () => {
    expect(chunkMediaText("x".repeat(500_000), "office")).toHaveLength(MAX_CHUNKS);
    const lines = Array.from({ length: 40_000 }, (_, i) => `[00:${String(i % 60).padStart(2, "0")}] ligne ${i} avec du texte`);
    expect(chunkMediaText(lines.join("\n"), "transcript").length).toBeLessThanOrEqual(MAX_CHUNKS);
  });

  it("transcription : chaque bloc commence par une ligne horodatée et ne coupe jamais une ligne", () => {
    const lines = Array.from({ length: 120 }, (_, i) => `[${String(Math.floor(i / 60)).padStart(2, "0")}:${String(i % 60).padStart(2, "0")}] phrase numéro ${i} ${"mot ".repeat(10)}`);
    const out = chunkMediaText(lines.join("\n"), "transcript");
    expect(out.length).toBeGreaterThan(1);
    for (const c of out) {
      expect(c).toMatch(/^\[\d{2}:\d{2}\] /);
      expect(c.length).toBeLessThanOrEqual(1200);
      for (const l of c.split("\n")) expect(l).toMatch(/^\[\d{2}:\d{2}\] phrase/);
    }
    expect(out.join("\n")).toBe(lines.join("\n"));
  });

  it("transcription : une ligne démesurée est coupée par chunkText", () => {
    const out = chunkMediaText(`[00:01] ${"a".repeat(3000)}`, "transcript");
    expect(out.length).toBeGreaterThan(1);
  });
});
