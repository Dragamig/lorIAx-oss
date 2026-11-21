import { NextRequest, NextResponse } from "next/server";
import { getSessionUser } from "@/lib/auth/get-user";
import { checkRateLimitAsync, RATE_LIMITS } from "@/lib/rate-limit";
import { guardVoiceNotesModule } from "@/lib/voice-notes/guards";
import { loadVoiceNoteWithAccess } from "@/lib/voice-notes/access";
import { serializeVoiceNote } from "@/lib/voice-notes/store";
import { canRetryTranscription } from "@/lib/voice-notes/state-machine";
import { startTranscription } from "@/lib/voice-notes/transcription";
import type { VoiceNoteStatus } from "@/lib/voice-notes/types";

/**
 * POST /api/voice-notes/[id]/retry : relance la transcription depuis l'audio
 * conservé. Possible tant que la note est en échec : l'audio n'est effacé qu'à
 * la validation du transcript.
 */
export async function POST(
  _request: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  const user = await getSessionUser();
  if (!user) return NextResponse.json({ error: "Non authentifié" }, { status: 401 });

  const moduleBlocked = await guardVoiceNotesModule(user);
  if (moduleBlocked) return moduleBlocked;

  const limit = await checkRateLimitAsync(`voice-note-retry:${user.id}`, RATE_LIMITS.meet);
  if (!limit.success) {
    return NextResponse.json(
      { error: "Trop de relances, réessayez dans une minute" },
      { status: 429 }
    );
  }

  const { id } = await params;
  const access = await loadVoiceNoteWithAccess(user, id, "edit");
  if (!access.ok) {
    return NextResponse.json({ error: access.error }, { status: access.status });
  }

  const status = access.note.status as VoiceNoteStatus;
  if (!canRetryTranscription(status)) {
    return NextResponse.json(
      { error: `Aucune relance possible dans l'état ${status}` },
      { status: 409 }
    );
  }
  if (!access.note.audioPath) {
    return NextResponse.json(
      { error: "Aucun audio conservé : réenregistrement nécessaire" },
      { status: 409 }
    );
  }

  await startTranscription(id, status);

  const refreshed = await loadVoiceNoteWithAccess(user, id, "view");
  return NextResponse.json(
    refreshed.ok ? serializeVoiceNote(refreshed.note) : { id, status: "transcribing" },
    { status: 202 }
  );
}
