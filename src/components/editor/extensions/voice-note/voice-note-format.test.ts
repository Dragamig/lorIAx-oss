import { describe, it, expect } from "vitest";
import {
  countWords,
  formatClock,
  formatDuration,
  formatNoteTitle,
  formatWordCount,
} from "./voice-note-format";
import {
  isAcceptableAudioFile,
  isOutputStale,
  type VoiceNoteState,
} from "./voice-note-api";

describe("formatClock", () => {
  it("affiche minutes et secondes", () => {
    expect(formatClock(134)).toBe("02:14");
    expect(formatClock(0)).toBe("00:00");
  });

  it("ajoute les heures au dela de soixante minutes", () => {
    expect(formatClock(3735)).toBe("1:02:15");
  });
});

describe("formatDuration", () => {
  it("rend une duree lisible", () => {
    expect(formatDuration(45)).toBe("45 s");
    expect(formatDuration(161)).toBe("2 min 41 s");
    expect(formatDuration(120)).toBe("2 min");
    expect(formatDuration(3780)).toBe("1 h 03 min");
  });

  it("ne fabrique pas de duree quand elle est inconnue", () => {
    expect(formatDuration(null)).toBe("durée inconnue");
  });
});

describe("compte de mots", () => {
  it("compte les mots separes par n'importe quel blanc", () => {
    expect(countWords("Note pour la  réunion\nde jeudi")).toBe(6);
    expect(countWords("")).toBe(0);
    expect(countWords(null)).toBe(0);
  });

  it("accorde le libelle", () => {
    expect(formatWordCount("bonjour")).toBe("1 mot");
    expect(formatWordCount("bonjour tout le monde")).toBe("4 mots");
  });
});

describe("formatNoteTitle", () => {
  it("date la note sans jamais montrer d'identifiant technique", () => {
    expect(formatNoteTitle("2026-08-17T10:00:00.000Z")).toBe("Note vocale du 17 août");
    expect(formatNoteTitle(null)).toBe("Note vocale");
    expect(formatNoteTitle("pas une date")).toBe("Note vocale");
  });
});

function makeFile(name: string, size: number, type = "audio/mpeg"): File {
  const file = new File(["x"], name, { type });
  Object.defineProperty(file, "size", { value: size });
  return file;
}

describe("isAcceptableAudioFile", () => {
  it("accepte les formats annonces", () => {
    for (const extension of ["mp3", "m4a", "ogg", "wav", "webm"]) {
      expect(isAcceptableAudioFile(makeFile(`note.${extension}`, 1024))).toBe(true);
    }
  });

  it("refuse un format hors liste et un fichier trop lourd", () => {
    expect(isAcceptableAudioFile(makeFile("note.txt", 1024, "text/plain"))).toBe(false);
    expect(isAcceptableAudioFile(makeFile("note.mp3", 201 * 1024 * 1024))).toBe(false);
    expect(isAcceptableAudioFile(makeFile("note.mp3", 0))).toBe(false);
  });
});

function makeState(overrides: Partial<VoiceNoteState>): VoiceNoteState {
  return {
    id: "note",
    status: "validated",
    durationSeconds: 10,
    transcript: "texte",
    transcriptValidatedAt: null,
    summary: null,
    cleanedText: null,
    errorCode: null,
    ...overrides,
  };
}

describe("isOutputStale", () => {
  it("suit l'avis du serveur quand il le donne", () => {
    expect(isOutputStale(makeState({ summaryStale: true }), "summary")).toBe(true);
    expect(
      isOutputStale(
        makeState({ summaryStale: false, transcriptHash: "a", summaryTranscriptHash: "b" }),
        "summary"
      )
    ).toBe(false);
  });

  it("compare les empreintes a defaut", () => {
    expect(
      isOutputStale(
        makeState({ transcriptHash: "a", summaryTranscriptHash: "b" }),
        "summary"
      )
    ).toBe(true);
    expect(
      isOutputStale(
        makeState({ transcriptHash: "a", cleanedTranscriptHash: "a" }),
        "cleanup"
      )
    ).toBe(false);
  });

  it("ne crie pas au loup quand une empreinte manque", () => {
    expect(isOutputStale(makeState({ transcriptHash: "a" }), "summary")).toBe(false);
  });
});
