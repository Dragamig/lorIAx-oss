// AUTO-GÉNÉRÉ par scripts/generate-module-composition.ts — NE PAS ÉDITER À LA MAIN.
import type { AnyExtension } from "@tiptap/core";
import { DesignBlock } from "./design-block-node";
import { MeetingBlock } from "./meeting-block-node";
import { InPersonMeetingBlock } from "./meeting/in-person-meeting-block-node";
import { FileBlock } from "./file-block-node";
import { PresentationBlock } from "./presentation-block-node";
import { VoiceNoteBlock } from "./voice-note/voice-note-node";

export const OPTIONAL_EDITOR_EXTENSIONS: Record<string, AnyExtension> = {
  DesignBlock: DesignBlock,
  MeetingBlock: MeetingBlock,
  InPersonMeetingBlock: InPersonMeetingBlock,
  FileBlock: FileBlock,
  PresentationBlock: PresentationBlock,
  VoiceNoteBlock: VoiceNoteBlock,
};
