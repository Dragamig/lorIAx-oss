import { describe, it, expect } from "vitest";
import {
  canTransition,
  assertTransition,
  canAcceptAudio,
  canEditTranscript,
  canValidate,
  canProcess,
  canRetryTranscription,
  statusAfterTranscriptEdit,
  isTranscriptionStalled,
  isProcessingStalled,
  TRANSCRIPTION_STALL_MS,
  PROCESS_STALL_MS,
  VoiceNoteTransitionError,
} from "./state-machine";
import type { VoiceNoteStatus } from "./types";

const ALL_STATUSES: VoiceNoteStatus[] = [
  "recording",
  "transcribing",
  "review",
  "validated",
  "failed",
];

describe("aucune transition ne saute la validation", () => {
  it("seul le statut validated autorise un traitement IA", () => {
    for (const status of ALL_STATUSES) {
      expect(canProcess(status)).toBe(status === "validated");
    }
  });

  it("seul review mène à validated", () => {
    for (const status of ALL_STATUSES) {
      expect(canTransition(status, "validated")).toBe(status === "review");
    }
  });

  it("aucun chemin ne mène à un traitement sans passer par validated", () => {
    // Parcours exhaustif depuis l'état initial : tout état où le traitement est
    // permis doit avoir validated dans son chemin.
    const seen = new Set<string>();
    const queue: Array<{ status: VoiceNoteStatus; path: VoiceNoteStatus[] }> = [
      { status: "recording", path: ["recording"] },
    ];

    while (queue.length > 0) {
      const current = queue.shift()!;
      if (canProcess(current.status)) {
        expect(current.path).toContain("validated");
      }
      for (const next of ALL_STATUSES) {
        if (!canTransition(current.status, next)) continue;
        const key = `${current.status}>${next}`;
        if (seen.has(key)) continue;
        seen.add(key);
        queue.push({ status: next, path: [...current.path, next] });
      }
    }
    expect(seen.size).toBeGreaterThan(0);
  });
});

describe("transitions", () => {
  it("le cycle nominal est complet", () => {
    expect(canTransition("recording", "transcribing")).toBe(true);
    expect(canTransition("transcribing", "review")).toBe(true);
    expect(canTransition("review", "validated")).toBe(true);
  });

  it("un échec est rattrapable par une relance", () => {
    expect(canTransition("transcribing", "failed")).toBe(true);
    expect(canTransition("failed", "transcribing")).toBe(true);
    expect(canRetryTranscription("failed")).toBe(true);
    expect(canRetryTranscription("review")).toBe(false);
  });

  it("une note validée ne repart qu'en relecture", () => {
    expect(canTransition("validated", "review")).toBe(true);
    expect(canTransition("validated", "transcribing")).toBe(false);
    expect(canTransition("validated", "failed")).toBe(false);
  });

  it("assertTransition lève sur une transition interdite", () => {
    expect(() => assertTransition("recording", "validated")).toThrow(
      VoiceNoteTransitionError
    );
    expect(() => assertTransition("failed", "transcribing")).not.toThrow();
  });
});

describe("garde-fous des routes", () => {
  it("l'audio n'est reçu ni pendant la transcription ni après validation", () => {
    expect(canAcceptAudio("recording")).toBe(true);
    expect(canAcceptAudio("review")).toBe(true);
    expect(canAcceptAudio("failed")).toBe(true);
    expect(canAcceptAudio("transcribing")).toBe(false);
    expect(canAcceptAudio("validated")).toBe(false);
  });

  it("le transcript validé exige une reprise explicite", () => {
    expect(canEditTranscript("review")).toBe(true);
    expect(canEditTranscript("validated")).toBe(false);
    expect(canEditTranscript("validated", { reopen: true })).toBe(true);
    expect(canEditTranscript("transcribing", { reopen: true })).toBe(false);
  });

  it("la reprise ramène en relecture, une correction en relecture n'y change rien", () => {
    expect(statusAfterTranscriptEdit("validated")).toBe("review");
    expect(statusAfterTranscriptEdit("review")).toBe("review");
  });

  it("seule une note en relecture est validable", () => {
    expect(canValidate("review")).toBe(true);
    expect(canValidate("transcribing")).toBe(false);
    expect(canValidate("failed")).toBe(false);
  });
});

describe("transcription abandonnée", () => {
  const now = new Date("2026-08-17T12:00:00Z");
  const ago = (ms: number) => new Date(now.getTime() - ms);

  it("laisse tranquille une transcription récente", () => {
    expect(isTranscriptionStalled("transcribing", ago(60_000), now)).toBe(false);
    expect(
      isTranscriptionStalled("transcribing", ago(TRANSCRIPTION_STALL_MS - 1), now)
    ).toBe(false);
  });

  it("déclare perdue une transcription au delà du délai", () => {
    expect(
      isTranscriptionStalled("transcribing", ago(TRANSCRIPTION_STALL_MS), now)
    ).toBe(true);
    expect(isTranscriptionStalled("transcribing", ago(3 * 3600_000), now)).toBe(true);
  });

  it("ne concerne que la transcription en cours", () => {
    for (const status of ALL_STATUSES) {
      expect(isTranscriptionStalled(status, ago(3 * 3600_000), now)).toBe(
        status === "transcribing"
      );
    }
  });

  it("rend la relance possible, puisque la note repasse en échec", () => {
    // Requalifiée en `failed`, la note redevient relançable et peut recevoir un
    // nouvel audio : c'est toute la sortie de secours.
    expect(canRetryTranscription("failed")).toBe(true);
    expect(canAcceptAudio("failed")).toBe(true);
  });
});

describe("traitement IA abandonné", () => {
  const now = new Date("2026-08-17T12:00:00Z");
  const ago = (ms: number) => new Date(now.getTime() - ms);

  it("laisse tourner un traitement récent", () => {
    expect(isProcessingStalled("summary", ago(60_000), now)).toBe(false);
    expect(isProcessingStalled("cleanup", ago(PROCESS_STALL_MS - 1), now)).toBe(
      false
    );
  });

  it("déclare perdu un traitement au delà du délai", () => {
    expect(isProcessingStalled("summary", ago(PROCESS_STALL_MS), now)).toBe(true);
    expect(isProcessingStalled("cleanup", ago(3 * 3600_000), now)).toBe(true);
  });

  it("sans traitement engagé, il n'y a rien à requalifier", () => {
    expect(isProcessingStalled(null, ago(3 * 3600_000), now)).toBe(false);
    expect(isProcessingStalled(null, null, now)).toBe(false);
  });

  it("un marqueur sans date de départ est tenu pour perdu", () => {
    // Écriture incomplète : sans cette porte de sortie, la note resterait
    // bloquée pour toujours, aucun traitement ne pouvant plus être engagé.
    expect(isProcessingStalled("summary", null, now)).toBe(true);
  });
});
