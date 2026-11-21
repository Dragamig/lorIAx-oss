import { describe, it, expect } from "vitest";
import { transcriptFingerprint, isOutputStale } from "./fingerprint";

describe("transcriptFingerprint", () => {
  it("est stable et long de 64 caractères hexadécimaux", () => {
    const hash = transcriptFingerprint("Bonjour, ceci est une note.");
    expect(hash).toMatch(/^[0-9a-f]{64}$/);
    expect(transcriptFingerprint("Bonjour, ceci est une note.")).toBe(hash);
  });

  it("ignore les seules variations d'espaces", () => {
    expect(transcriptFingerprint("  deux   mots \n")).toBe(
      transcriptFingerprint("deux mots")
    );
  });

  it("change dès qu'un mot change", () => {
    expect(transcriptFingerprint("appeler Paul")).not.toBe(
      transcriptFingerprint("appeler Pauline")
    );
  });
});

describe("isOutputStale", () => {
  const transcript = "Rappeler le fournisseur demain matin.";
  const hash = transcriptFingerprint(transcript);

  it("une sortie produite depuis le transcript courant n'est pas périmée", () => {
    expect(isOutputStale(transcript, "Synthèse", hash)).toBe(false);
  });

  it("une correction du transcript marque la sortie comme antérieure", () => {
    expect(isOutputStale(transcript + " Et lundi.", "Synthèse", hash)).toBe(true);
  });

  it("sans sortie ou sans empreinte, on ne prétend rien", () => {
    expect(isOutputStale(transcript, null, hash)).toBe(false);
    expect(isOutputStale(transcript, "Synthèse", null)).toBe(false);
  });

  it("une sortie sans transcript courant est périmée", () => {
    expect(isOutputStale(null, "Synthèse", hash)).toBe(true);
  });
});
