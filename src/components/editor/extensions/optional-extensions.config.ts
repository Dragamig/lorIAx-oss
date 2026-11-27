import type { ModuleId } from "@/lib/modules/types";

/**
 * Catalogue des extensions éditeur OPTIONNELLES (fournies par des modules licensed).
 * Strings uniquement : aucun import de code ici, sinon le tree-shaking serait cassé.
 * Consommé par scripts/generate-module-composition.ts pour émettre optional.generated.ts.
 * `importPath` est relatif au dossier extensions/. `exportName` = export nommé du module.
 */
export interface OptionalExtensionSource {
  key: string;
  moduleId: ModuleId;
  importPath: string;
  exportName: string;
}

export const OPTIONAL_EXTENSION_SOURCES: OptionalExtensionSource[] = [
  { key: "DesignBlock", moduleId: "studio", importPath: "./design-block-node", exportName: "DesignBlock" },
  { key: "MeetingBlock", moduleId: "livekit", importPath: "./meeting-block-node", exportName: "MeetingBlock" },
  { key: "InPersonMeetingBlock", moduleId: "meeting-rooms", importPath: "./meeting/in-person-meeting-block-node", exportName: "InPersonMeetingBlock" },
  { key: "FileBlock", moduleId: "library", importPath: "./file-block-node", exportName: "FileBlock" },
  { key: "PresentationBlock", moduleId: "presentations", importPath: "./presentation-block-node", exportName: "PresentationBlock" },
  { key: "VoiceNoteBlock", moduleId: "voice-notes", importPath: "./voice-note/voice-note-node", exportName: "VoiceNoteBlock" },
];
