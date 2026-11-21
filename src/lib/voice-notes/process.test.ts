import { describe, it, expect } from "vitest";
import { buildVoiceNotePrompt, maxOutputTokensFor } from "./process";
import { getBuiltinPromptsByUsageType } from "@/lib/ai/builtin-prompts";

const TRANSCRIPT = "Il faut rappeler le fournisseur et relire le devis.";

describe("prompts natifs des notes vocales", () => {
  it("un prompt natif existe pour chaque type d'usage", () => {
    expect(getBuiltinPromptsByUsageType("voice_note_summary")).toHaveLength(1);
    expect(getBuiltinPromptsByUsageType("voice_note_cleanup")).toHaveLength(1);
  });

  it("la synthèse interdit d'inventer participants et décisions", () => {
    const { system } = buildVoiceNotePrompt("summary", TRANSCRIPT);
    expect(system).toContain("N'invente jamais de participants");
    expect(system).toContain("## Actions");
  });

  it("la mise au propre interdit de résumer, réordonner ou ajouter", () => {
    const { system } = buildVoiceNotePrompt("cleanup", TRANSCRIPT);
    expect(system).toContain("Ne résume pas");
    expect(system).toContain("Ne réordonne pas");
    expect(system).toContain("N'ajoute aucun mot");
  });
});

describe("buildVoiceNotePrompt", () => {
  it("interpole le transcript dans le prompt utilisateur", () => {
    for (const kind of ["summary", "cleanup"] as const) {
      const { user } = buildVoiceNotePrompt(kind, TRANSCRIPT);
      expect(user).toContain(TRANSCRIPT);
      expect(user).not.toContain("{{transcription}}");
    }
  });

  it("un prompt configuré en base prend le pas sur le prompt natif", () => {
    const built = buildVoiceNotePrompt("summary", TRANSCRIPT, {
      systemPrompt: "Prompt administrateur",
      userPromptTemplate: "Texte : {{transcription}}",
      versionId: "version-1",
    });
    expect(built.system).toBe("Prompt administrateur");
    expect(built.user).toBe(`Texte : ${TRANSCRIPT}`);
    expect(built.versionId).toBe("version-1");
  });

  it("un prompt configuré sans gabarit utilisateur retombe sur le gabarit natif", () => {
    const built = buildVoiceNotePrompt("cleanup", TRANSCRIPT, {
      systemPrompt: "Prompt administrateur",
      userPromptTemplate: null,
      versionId: "version-2",
    });
    expect(built.user).toContain(TRANSCRIPT);
  });
});

describe("maxOutputTokensFor", () => {
  it("la synthèse est bornée plus bas que la mise au propre", () => {
    const long = "mot ".repeat(5000);
    expect(maxOutputTokensFor("summary", long)).toBeLessThan(
      maxOutputTokensFor("cleanup", long)
    );
  });

  it("un transcript court garde de quoi réfléchir puis répondre", () => {
    // Le plancher couvre la réflexion interne d'un modèle à raisonnement, qui
    // précède le premier mot écrit. Trop bas, elle épuise le budget et la
    // génération s'arrête sur un texte vide.
    expect(maxOutputTokensFor("summary", "trois mots ici")).toBeGreaterThanOrEqual(2000);
    expect(maxOutputTokensFor("cleanup", "trois mots ici")).toBeGreaterThanOrEqual(4000);
  });

  it("le budget ne suit plus la longueur d'une note d'une minute", () => {
    // Le transcript de l'incident : 238 caractères donnaient 200 jetons.
    const incident = "a".repeat(238);
    expect(maxOutputTokensFor("summary", incident)).toBe(2000);
  });

  it("un transcript long obtient davantage de place", () => {
    const long = "mot ".repeat(5000);
    expect(maxOutputTokensFor("summary", long)).toBeGreaterThan(
      maxOutputTokensFor("summary", "trois mots ici")
    );
    expect(maxOutputTokensFor("cleanup", long)).toBeGreaterThan(
      maxOutputTokensFor("cleanup", "trois mots ici")
    );
  });
});
