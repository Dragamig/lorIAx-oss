import { describe, it, expect } from "vitest";
import {
  validateAudioUpload,
  MAX_AUDIO_BYTES,
  exceedsDeclaredSize,
  isInsideAudioDir,
  getAudioDir,
  mimeTypeForExtension,
} from "./audio";
import { join } from "path";

describe("validateAudioUpload", () => {
  it("accepte les cinq formats annoncés", () => {
    const cases: Array<[string, string]> = [
      ["audio/mpeg", "mp3"],
      ["audio/mp4", "m4a"],
      ["audio/ogg", "ogg"],
      ["audio/wav", "wav"],
      ["audio/webm", "webm"],
    ];
    for (const [declaredType, extension] of cases) {
      const result = validateAudioUpload({ declaredType, byteLength: 1024 });
      expect(result.ok).toBe(true);
      if (result.ok) expect(result.extension).toBe(extension);
    }
  });

  it("accepte le type MediaRecorder avec ses codecs", () => {
    const result = validateAudioUpload({
      declaredType: "audio/webm;codecs=opus",
      byteLength: 2048,
    });
    expect(result.ok).toBe(true);
  });

  it("refuse un type non audio, quelle que soit l'extension du nom de fichier", () => {
    const result = validateAudioUpload({
      declaredType: "application/pdf",
      byteLength: 1024,
    });
    expect(result.ok).toBe(false);
    if (!result.ok) {
      expect(result.status).toBe(415);
      expect(result.message).toContain("mp3");
    }
  });

  it("refuse un type absent", () => {
    expect(validateAudioUpload({ declaredType: null, byteLength: 10 }).ok).toBe(false);
    expect(validateAudioUpload({ declaredType: "", byteLength: 10 }).ok).toBe(false);
  });

  it("refuse au delà du plafond de 50 Mo, sur la taille réellement reçue", () => {
    const result = validateAudioUpload({
      declaredType: "audio/mpeg",
      byteLength: MAX_AUDIO_BYTES + 1,
    });
    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.status).toBe(413);
  });

  it("accepte exactement la taille limite", () => {
    expect(
      validateAudioUpload({ declaredType: "audio/mpeg", byteLength: MAX_AUDIO_BYTES }).ok
    ).toBe(true);
  });

  it("refuse un fichier vide", () => {
    const result = validateAudioUpload({ declaredType: "audio/mpeg", byteLength: 0 });
    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.status).toBe(400);
  });
});

describe("exceedsDeclaredSize", () => {
  it("laisse passer un envoi annoncé sous le plafond", () => {
    expect(exceedsDeclaredSize(String(MAX_AUDIO_BYTES))).toBe(false);
  });

  it("refuse un envoi annoncé franchement au dessus du plafond", () => {
    expect(exceedsDeclaredSize(String(MAX_AUDIO_BYTES * 2))).toBe(true);
  });

  it("ne conclut rien sans en tête exploitable", () => {
    expect(exceedsDeclaredSize(null)).toBe(false);
    expect(exceedsDeclaredSize("")).toBe(false);
    expect(exceedsDeclaredSize("beaucoup")).toBe(false);
  });

  it("tolère l'enveloppe multipart d'un fichier à la taille limite", () => {
    expect(exceedsDeclaredSize(String(MAX_AUDIO_BYTES + 512))).toBe(false);
  });
});

describe("confinement des fichiers audio", () => {
  it("accepte un chemin du dossier des notes vocales", () => {
    expect(isInsideAudioDir(join(getAudioDir(), "note.webm"))).toBe(true);
  });

  it("refuse une remontée hors du dossier", () => {
    expect(isInsideAudioDir(join(getAudioDir(), "..", "etc", "passwd"))).toBe(false);
  });
});

describe("mimeTypeForExtension", () => {
  it("rend le type de téléchargement attendu", () => {
    expect(mimeTypeForExtension("mp3")).toBe("audio/mpeg");
    expect(mimeTypeForExtension("WEBM")).toBe("audio/webm");
    expect(mimeTypeForExtension("txt")).toBe("application/octet-stream");
  });
});
