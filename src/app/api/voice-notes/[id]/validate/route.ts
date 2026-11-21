import { NextRequest, NextResponse } from "next/server";
import { getSessionUser } from "@/lib/auth/get-user";
import { guardVoiceNotesModule } from "@/lib/voice-notes/guards";
import { loadVoiceNoteWithAccess } from "@/lib/voice-notes/access";
import { serializeVoiceNote, updateVoiceNote } from "@/lib/voice-notes/store";
import { canValidate } from "@/lib/voice-notes/state-machine";
import { deleteAudioFile } from "@/lib/voice-notes/audio";
import type { VoiceNoteStatus } from "@/lib/voice-notes/types";

/**
 * POST /api/voice-notes/[id]/validate : validation humaine du transcript.
 * Horodate la validation et efface l'audio : c'est ici, et pas à la
 * transcription, que la prise de son disparaît.
 */
export async function POST(
  _request: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  const user = await getSessionUser();
  if (!user) return NextResponse.json({ error: "Non authentifié" }, { status: 401 });

  const moduleBlocked = await guardVoiceNotesModule(user);
  if (moduleBlocked) return moduleBlocked;

  const { id } = await params;
  const access = await loadVoiceNoteWithAccess(user, id, "edit");
  if (!access.ok) {
    return NextResponse.json({ error: access.error }, { status: access.status });
  }

  const status = access.note.status as VoiceNoteStatus;
  if (!canValidate(status)) {
    return NextResponse.json(
      { error: `Une note dans l'état ${status} ne peut pas être validée` },
      { status: 409 }
    );
  }

  if (!access.note.transcript || access.note.transcript.trim() === "") {
    return NextResponse.json(
      { error: "Transcript vide : rien à valider" },
      { status: 409 }
    );
  }

  if (access.note.audioPath) {
    await deleteAudioFile(access.note.audioPath);
  }

  const note = await updateVoiceNote(id, {
    status: "validated",
    transcriptValidatedAt: new Date(),
    audioPath: null,
    errorCode: null,
  });

  return NextResponse.json(serializeVoiceNote(note));
}
