import { describe, it, expect } from "vitest";
import { collectCapabilities } from "./capabilities";
import type { ModuleManifest } from "./types";

const base: Omit<ModuleManifest, "id"> = {
  name: "",
  description: "",
  dependencies: [],
  entitlement: "core",
  defaultEnabled: false,
  category: "contenu",
  icon: "brain",
  manageRole: "admin",
  nav: [],
};

const livekit: ModuleManifest = {
  ...base,
  id: "livekit",
  editorExtensions: ["MeetingBlock"],
  slashCommands: ["Réunion"],
};
const studiovideo: ModuleManifest = {
  ...base,
  id: "studiovideo",
  editorExtensions: ["VideoEditorBlock", "VideoEmbed"],
  slashCommands: ["Montage vidéo", "Vidéo"],
};
const collab: ModuleManifest = { ...base, id: "collab" }; // aucune capacité éditeur

describe("collectCapabilities", () => {
  it("agrège extensions et commandes des modules actifs", () => {
    const caps = collectCapabilities(["livekit", "studiovideo"], [livekit, studiovideo, collab]);
    expect(caps.modules.sort()).toEqual(["livekit", "studiovideo"]);
    expect(caps.editorExtensions.sort()).toEqual(["MeetingBlock", "VideoEditorBlock", "VideoEmbed"]);
    expect(caps.slashCommands.sort()).toEqual(["Montage vidéo", "Réunion", "Vidéo"]);
  });

  it("ignore les modules inactifs", () => {
    const caps = collectCapabilities(["collab"], [livekit, studiovideo, collab]);
    expect(caps.modules).toEqual(["collab"]);
    expect(caps.editorExtensions).toEqual([]);
    expect(caps.slashCommands).toEqual([]);
  });

  it("ignore un id actif sans manifeste correspondant", () => {
    const caps = collectCapabilities(["inconnu"], [livekit]);
    expect(caps.modules).toEqual([]);
    expect(caps.editorExtensions).toEqual([]);
  });

  it("déduplique les extensions partagées par deux modules", () => {
    const a: ModuleManifest = { ...base, id: "studio", editorExtensions: ["Shared"] };
    const b: ModuleManifest = { ...base, id: "images", editorExtensions: ["Shared"] };
    const caps = collectCapabilities(["studio", "images"], [a, b]);
    expect(caps.editorExtensions).toEqual(["Shared"]);
  });
});
