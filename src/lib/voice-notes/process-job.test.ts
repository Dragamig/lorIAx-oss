import { describe, it, expect, vi, beforeEach } from "vitest";
import type { VoiceNote } from "@/lib/db/schema";

const generateText = vi.fn();
const logAIUsage = vi.fn();
const updateVoiceNote = vi.fn(
  async (_id: string, _patch: Record<string, unknown>) => ({}) as VoiceNote
);
const orgIdForVoiceNote = vi.fn(async (_noteId: string) => null as string | null);

vi.mock("ai", () => ({
  generateText: (...args: unknown[]) => generateText(...args),
}));

vi.mock("@/lib/ai/provider-resolver", () => ({
  getLanguageModelForUsageInOrg: async () => ({
    languageModel: {},
    providerId: "provider-1",
    model: "modele-a-raisonnement",
  }),
}));

vi.mock("@/lib/ai/org-scope", () => ({
  orgIdForVoiceNote: (noteId: string) => orgIdForVoiceNote(noteId),
}));

vi.mock("@/lib/ai/prompt-resolver", async (importOriginal) => ({
  ...(await importOriginal<typeof import("@/lib/ai/prompt-resolver")>()),
  resolvePrompt: async () => null,
}));

vi.mock("@/lib/ai/usage-logger", () => ({
  logAIUsage: (params: Record<string, unknown>) => logAIUsage(params),
}));

vi.mock("./store", () => ({
  updateVoiceNote: (id: string, patch: Record<string, unknown>) =>
    updateVoiceNote(id, patch),
}));

import {
  emptyOutputCode,
  runVoiceNoteProcess,
  runVoiceNoteProcessJob,
  startVoiceNoteProcess,
  VoiceNoteProcessError,
} from "./process";

const TRANSCRIPT = "Rappeler le fournisseur et relire le devis avant vendredi.";

/** Dernier appel enregistré dans le suivi d'usage IA. */
const lastUsage = () =>
  logAIUsage.mock.calls.at(-1)?.[0] as Record<string, unknown>;

/** Dernier patch écrit sur la note. */
const lastPatch = () =>
  updateVoiceNote.mock.calls.at(-1)?.[1] as Record<string, unknown>;

beforeEach(() => {
  vi.clearAllMocks();
});

describe("qualification d'une sortie vide", () => {
  it("le plafond de jetons atteint désigne un défaut de réglage du modèle", () => {
    expect(
      emptyOutputCode({ finishReason: "length", maxOutputTokens: 2000 })
    ).toBe("ai_empty_token_limit");
  });

  it("des jetons produits au niveau du plafond suffisent, sans motif d'arrêt", () => {
    // Le relevé de production montrait `tokens_out` égal au plafond sans que le
    // motif d'arrêt soit exploitable : la comparaison au budget doit trancher.
    expect(
      emptyOutputCode({ outputTokens: 200, maxOutputTokens: 200 })
    ).toBe("ai_empty_token_limit");
  });

  it("une sortie vide sans plafond atteint reste un aléa relançable", () => {
    expect(
      emptyOutputCode({
        finishReason: "stop",
        outputTokens: 12,
        maxOutputTokens: 2000,
      })
    ).toBe("ai_empty_output");
  });
});

describe("runVoiceNoteProcess face à une sortie vide", () => {
  it("un texte vide est un échec, jamais un succès", async () => {
    generateText.mockResolvedValue({
      text: "",
      finishReason: "length",
      usage: { inputTokens: 235, outputTokens: 200 },
    });

    await expect(
      runVoiceNoteProcess({
        kind: "summary",
        transcript: TRANSCRIPT,
        userId: "user-1",
        organizationId: null,
      })
    ).rejects.toBeInstanceOf(VoiceNoteProcessError);

    // Le relevé de production journalisait ce cas en réussite : la panne était
    // invisible dans le suivi d'usage.
    expect(lastUsage().status).toBe("error");
    expect(lastUsage().tokensOut).toBe(200);
  });

  it("un texte réduit à des espaces est traité comme vide", async () => {
    generateText.mockResolvedValue({
      text: "   \n\t  ",
      finishReason: "stop",
      usage: { inputTokens: 235, outputTokens: 4 },
    });

    await expect(
      runVoiceNoteProcess({
        kind: "cleanup",
        transcript: TRANSCRIPT,
        userId: "user-1",
        organizationId: null,
      })
    ).rejects.toMatchObject({ code: "ai_empty_output" });
    expect(lastUsage().status).toBe("error");
  });

  it("un seul appel est journalisé pour une seule requête au modèle", async () => {
    generateText.mockResolvedValue({
      text: "",
      finishReason: "length",
      usage: { inputTokens: 235, outputTokens: 200 },
    });

    await expect(
      runVoiceNoteProcess({
        kind: "summary",
        transcript: TRANSCRIPT,
        userId: "user-1",
        organizationId: null,
      })
    ).rejects.toBeTruthy();
    expect(logAIUsage).toHaveBeenCalledTimes(1);
  });

  it("une vraie sortie reste un succès, texte rogné de ses blancs", async () => {
    generateText.mockResolvedValue({
      text: "  ## Actions\n- Rappeler le fournisseur  ",
      finishReason: "stop",
      usage: { inputTokens: 235, outputTokens: 42 },
    });

    const output = await runVoiceNoteProcess({
      kind: "summary",
      transcript: TRANSCRIPT,
      userId: "user-1",
      organizationId: null,
    });
    expect(output).toBe("## Actions\n- Rappeler le fournisseur");
    expect(lastUsage().status).toBe("success");
  });
});

describe("runVoiceNoteProcessJob", () => {
  it("une sortie vide laisse la note sans compte rendu, avec son code d'erreur", async () => {
    generateText.mockResolvedValue({
      text: "",
      finishReason: "length",
      usage: { inputTokens: 235, outputTokens: 200 },
    });

    await runVoiceNoteProcessJob({
      noteId: "note-1",
      kind: "summary",
      transcript: TRANSCRIPT,
      userId: "user-1",
    });

    const patch = lastPatch();
    // Le code précis survit jusqu'au bloc : « relancez » et « changez de
    // modèle » ne sont pas le même conseil.
    expect(patch.errorCode).toBe("ai_empty_token_limit");
    // Le marqueur d'attente est effacé dans tous les cas, sinon le bloc
    // sonderait indéfiniment.
    expect(patch.processingKind).toBeNull();
    expect(patch.processingStartedAt).toBeNull();
    // Aucune sortie vide n'est enregistrée : une chaîne vide passerait pour un
    // compte rendu généré.
    expect(patch).not.toHaveProperty("summary");
  });

  it("une panne du service garde le code générique", async () => {
    generateText.mockRejectedValue(new Error("502 Bad Gateway"));

    await runVoiceNoteProcessJob({
      noteId: "note-1",
      kind: "cleanup",
      transcript: TRANSCRIPT,
      userId: "user-1",
    });

    expect(lastPatch().errorCode).toBe("ai_failed");
  });

  it("une génération réussie enregistre la sortie et son empreinte", async () => {
    generateText.mockResolvedValue({
      text: "Texte remis au propre.",
      finishReason: "stop",
      usage: { inputTokens: 235, outputTokens: 42 },
    });

    await runVoiceNoteProcessJob({
      noteId: "note-1",
      kind: "cleanup",
      transcript: TRANSCRIPT,
      userId: "user-1",
    });

    const patch = lastPatch();
    expect(patch.cleanedText).toBe("Texte remis au propre.");
    expect(patch.cleanedTranscriptHash).toEqual(expect.any(String));
    expect(patch.errorCode).toBeNull();
    expect(patch.processingKind).toBeNull();
  });
});

describe("startVoiceNoteProcess", () => {
  it("pose le marqueur d'attente avant tout travail", async () => {
    generateText.mockImplementation(
      () => new Promise(() => {}) // génération qui ne rend jamais la main
    );

    await startVoiceNoteProcess({
      noteId: "note-1",
      kind: "summary",
      transcript: TRANSCRIPT,
      userId: "user-1",
    });

    // Un seul patch a été écrit, celui de l'engagement : la réponse HTTP part
    // sans attendre la génération.
    expect(updateVoiceNote).toHaveBeenCalledTimes(1);
    const patch = lastPatch();
    expect(patch.processingKind).toBe("summary");
    expect(patch.processingStartedAt).toBeInstanceOf(Date);
    // L'échec précédent est effacé : on n'affiche pas l'erreur d'hier pendant
    // la tentative d'aujourd'hui.
    expect(patch.errorCode).toBeNull();
  });
});
