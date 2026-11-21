import { describe, it, expect, vi, beforeEach } from "vitest";
import type { VoiceNote } from "@/lib/db/schema";

const transcribeWithEngine = vi.fn();
const isTranscriptionEnabled = vi.fn();
const getVoiceNote = vi.fn();
const updateVoiceNote = vi.fn(
  async (_id: string, _patch: Record<string, unknown>) => ({}) as VoiceNote
);

vi.mock("@/lib/meet/transcribe", () => ({
  transcribeWithEngine: (...args: unknown[]) => transcribeWithEngine(...args),
  isTranscriptionEnabled: () => isTranscriptionEnabled(),
  formatTranscript: (result: { text: string }) => result.text,
}));

vi.mock("./store", () => ({
  getVoiceNote: (...args: unknown[]) => getVoiceNote(...args),
  updateVoiceNote: (id: string, patch: Record<string, unknown>) =>
    updateVoiceNote(id, patch),
}));

const noteWithAudio = (overrides: Partial<VoiceNote> = {}) =>
  ({
    id: "note-1",
    status: "transcribing",
    audioPath: "/tmp/loriax-voice-notes/note-1.webm",
    durationSeconds: null,
    transcript: null,
    ...overrides,
  }) as VoiceNote;

beforeEach(() => {
  vi.clearAllMocks();
  isTranscriptionEnabled.mockResolvedValue(true);
});

describe("runTranscription", () => {
  it("place la note en relecture avec le texte du moteur simulé", async () => {
    getVoiceNote.mockResolvedValue(noteWithAudio());
    transcribeWithEngine.mockResolvedValue({
      text: "Rappeler le fournisseur.",
      segments: [],
      language: "fr",
      duration: 12.4,
    });

    const { runTranscription } = await import("./transcription");
    await runTranscription("note-1");

    expect(updateVoiceNote).toHaveBeenCalledWith("note-1", {
      status: "review",
      transcript: "Rappeler le fournisseur.",
      durationSeconds: 12,
      errorCode: null,
    });
  });

  it("garde l'audio et marque l'échec quand le moteur tombe", async () => {
    getVoiceNote.mockResolvedValue(noteWithAudio());
    transcribeWithEngine.mockRejectedValue(new Error("moteur injoignable"));

    const { runTranscription } = await import("./transcription");
    await runTranscription("note-1");

    expect(updateVoiceNote).toHaveBeenCalledWith("note-1", {
      status: "failed",
      errorCode: "transcription_failed",
    });
    // Aucun effacement d'audio : la relance doit rester possible.
    const patches = updateVoiceNote.mock.calls.map((call) => call[1]);
    expect(patches.some((patch) => "audioPath" in patch)).toBe(false);
  });

  it("échoue proprement sans moteur configuré", async () => {
    getVoiceNote.mockResolvedValue(noteWithAudio());
    isTranscriptionEnabled.mockResolvedValue(false);

    const { runTranscription } = await import("./transcription");
    await runTranscription("note-1");

    expect(transcribeWithEngine).not.toHaveBeenCalled();
    expect(updateVoiceNote).toHaveBeenCalledWith("note-1", {
      status: "failed",
      errorCode: "no_transcription_engine",
    });
  });

  it("échoue quand l'audio a disparu", async () => {
    getVoiceNote.mockResolvedValue(noteWithAudio({ audioPath: null }));

    const { runTranscription } = await import("./transcription");
    await runTranscription("note-1");

    expect(updateVoiceNote).toHaveBeenCalledWith("note-1", {
      status: "failed",
      errorCode: "audio_missing",
    });
  });

  it("refuse un transcript vide", async () => {
    getVoiceNote.mockResolvedValue(noteWithAudio());
    transcribeWithEngine.mockResolvedValue({
      text: "   ",
      segments: [],
      language: "fr",
      duration: 3,
    });

    const { runTranscription } = await import("./transcription");
    await runTranscription("note-1");

    expect(updateVoiceNote).toHaveBeenCalledWith("note-1", {
      status: "failed",
      errorCode: "empty_transcript",
    });
  });
});

describe("startTranscription", () => {
  it("refuse de démarrer depuis un état interdit", async () => {
    const { startTranscription } = await import("./transcription");
    await expect(startTranscription("note-1", "validated")).rejects.toThrow(
      /Transition interdite/
    );
    expect(updateVoiceNote).not.toHaveBeenCalled();
  });

  it("passe la note en transcription avant de lancer le moteur", async () => {
    getVoiceNote.mockResolvedValue(noteWithAudio());
    transcribeWithEngine.mockResolvedValue({
      text: "Texte",
      segments: [],
      language: "fr",
      duration: 1,
    });

    const { startTranscription } = await import("./transcription");
    await startTranscription("note-1", "failed");

    expect(updateVoiceNote).toHaveBeenCalledWith("note-1", {
      status: "transcribing",
      errorCode: null,
    });
  });
});
