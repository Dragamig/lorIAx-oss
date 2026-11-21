import { describe, it, expect } from "vitest";
import { stripModuleToggleFields } from "./module-toggles";

describe("stripModuleToggleFields", () => {
  it("laisse passer une clé qui ne porte aucun interrupteur de module", () => {
    const result = stripModuleToggleFields("general", { appName: "LorIAx" });
    expect(result).toEqual({ skip: false, value: { appName: "LorIAx" } });
  });

  it("retire le sous-champ de toggle et garde le reste de la config", () => {
    const result = stripModuleToggleFields("whisper", {
      whisperEnabled: true,
      whisperApiUrl: "x",
    });
    expect(result).toEqual({ skip: false, value: { whisperApiUrl: "x" } });
  });

  it("retire le sous-champ « enabled » des clés qui l'utilisent", () => {
    const result = stripModuleToggleFields("ai_global", {
      enabled: true,
      defaultProvider: "mistral",
    });
    expect(result).toEqual({ skip: false, value: { defaultProvider: "mistral" } });
  });

  it("ignore entièrement meeting_rooms_enabled en booléen nu", () => {
    expect(stripModuleToggleFields("meeting_rooms_enabled", true)).toEqual({ skip: true });
    expect(stripModuleToggleFields("meeting_rooms_enabled", false)).toEqual({ skip: true });
  });

  it("ignore entièrement meeting_rooms_enabled en forme objet canonique", () => {
    expect(stripModuleToggleFields("meeting_rooms_enabled", { enabled: true })).toEqual({
      skip: true,
    });
  });

  it("ignore la clé quand il ne reste plus rien après le strippage", () => {
    expect(stripModuleToggleFields("whisper", { whisperEnabled: false })).toEqual({ skip: true });
  });

  it("ignore une valeur non-objet sur une clé de toggle", () => {
    expect(stripModuleToggleFields("whisper", ["x"])).toEqual({ skip: true });
    expect(stripModuleToggleFields("collab", null)).toEqual({ skip: true });
  });

  it("ne mute pas le corps reçu", () => {
    const body = { whisperEnabled: true, whisperApiUrl: "x" };
    stripModuleToggleFields("whisper", body);
    expect(body).toEqual({ whisperEnabled: true, whisperApiUrl: "x" });
  });
});
