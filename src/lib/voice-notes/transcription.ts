import {
  transcribeWithEngine,
  formatTranscript,
  isTranscriptionEnabled,
} from "@/lib/meet/transcribe";
import logger from "@/lib/logger";
import { getVoiceNote, updateVoiceNote } from "./store";
import { assertTransition } from "./state-machine";
import { VOICE_NOTE_ERROR_CODES } from "./types";
import type { VoiceNoteStatus } from "./types";

const log = logger.child({ module: "voice-notes-transcription" });

/**
 * Transcrit l'audio conservé d'une note, puis la place en relecture.
 *
 * Lancée en tâche de fond par les routes `audio` et `retry` : le client suit
 * l'avancement via `GET /api/voice-notes/[id]`. L'audio n'est jamais effacé
 * ici, même en cas de succès : c'est la validation du transcript qui l'efface,
 * pour qu'un échec tardif reste rattrapable sans réenregistrement.
 */
export async function runTranscription(noteId: string): Promise<void> {
  const note = await getVoiceNote(noteId);
  if (!note) {
    log.warn({ noteId }, "Note vocale introuvable, transcription abandonnée");
    return;
  }

  if (!note.audioPath) {
    await updateVoiceNote(noteId, {
      status: "failed",
      errorCode: VOICE_NOTE_ERROR_CODES.audioMissing,
    });
    return;
  }

  if (!(await isTranscriptionEnabled())) {
    await updateVoiceNote(noteId, {
      status: "failed",
      errorCode: VOICE_NOTE_ERROR_CODES.noTranscriptionEngine,
    });
    return;
  }

  const startedAt = Date.now();
  try {
    const result = await transcribeWithEngine(note.audioPath);
    const text = formatTranscript(result).trim();

    if (!text) {
      await updateVoiceNote(noteId, {
        status: "failed",
        errorCode: VOICE_NOTE_ERROR_CODES.emptyTranscript,
      });
      return;
    }

    await updateVoiceNote(noteId, {
      status: "review",
      transcript: text,
      durationSeconds: result.duration
        ? Math.round(result.duration)
        : note.durationSeconds,
      errorCode: null,
    });

    log.info(
      { noteId, textLength: text.length, latencyMs: Date.now() - startedAt },
      "Transcription de note vocale terminée"
    );
  } catch (err) {
    log.error(
      { noteId, err: String(err) },
      "Transcription de note vocale échouée, audio conservé pour relance"
    );
    await updateVoiceNote(noteId, {
      status: "failed",
      errorCode: VOICE_NOTE_ERROR_CODES.transcriptionFailed,
    });
  }
}

/**
 * Passe la note en transcription puis lance le moteur en tâche de fond.
 * La transition est vérifiée avant tout effet de bord.
 */
export async function startTranscription(
  noteId: string,
  currentStatus: VoiceNoteStatus
): Promise<void> {
  assertTransition(currentStatus, "transcribing");
  await updateVoiceNote(noteId, { status: "transcribing", errorCode: null });
  void runTranscription(noteId).catch((err) => {
    log.error({ noteId, err: String(err) }, "Pipeline de transcription interrompu");
  });
}
