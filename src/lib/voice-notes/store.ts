import { db } from "@/lib/db";
import { voiceNotes, type VoiceNote } from "@/lib/db/schema";
import { eq } from "drizzle-orm";
import logger from "@/lib/logger";
import { isOutputStale } from "./fingerprint";
import { isProcessingStalled, isTranscriptionStalled } from "./state-machine";
import { isVoiceNoteTranscriptionAvailable } from "./availability";
import { VOICE_NOTE_ERROR_CODES } from "./types";
import type {
  VoiceNoteProcessKind,
  VoiceNoteStatus,
  VoiceNoteView,
} from "./types";

const log = logger.child({ module: "voice-notes-store" });

/** Crée une note vide rattachée à un document. */
export async function createVoiceNote(input: {
  documentId: string;
  createdBy: string;
}): Promise<VoiceNote> {
  const [note] = await db
    .insert(voiceNotes)
    .values({
      documentId: input.documentId,
      createdBy: input.createdBy,
      status: "recording",
    })
    .returning();
  return note;
}

export async function getVoiceNote(id: string): Promise<VoiceNote | null> {
  const [note] = await db
    .select()
    .from(voiceNotes)
    .where(eq(voiceNotes.id, id))
    .limit(1);
  return note ?? null;
}

type VoiceNotePatch = Partial<{
  status: VoiceNoteStatus;
  audioPath: string | null;
  durationSeconds: number | null;
  transcript: string | null;
  transcriptValidatedAt: Date | null;
  summary: string | null;
  cleanedText: string | null;
  summaryTranscriptHash: string | null;
  cleanedTranscriptHash: string | null;
  processingKind: VoiceNoteProcessKind | null;
  processingStartedAt: Date | null;
  errorCode: string | null;
}>;

/** Applique une modification et remonte la note à jour. `updated_at` suit. */
export async function updateVoiceNote(
  id: string,
  patch: VoiceNotePatch
): Promise<VoiceNote> {
  const [note] = await db
    .update(voiceNotes)
    .set({ ...patch, updatedAt: new Date() })
    .where(eq(voiceNotes.id, id))
    .returning();
  return note;
}

/**
 * Sort une note abandonnée en `transcribing` : le processus de fond censé la
 * faire avancer a disparu, on la déclare en échec récupérable. L'audio est
 * laissé intact, donc la relance et le téléchargement redeviennent possibles.
 *
 * Appelée au chargement de la note, donc sur toutes les routes : la relance,
 * l'envoi d'un nouvel audio et la validation cessent de renvoyer 409, et le
 * bloc arrête de sonder dans le vide.
 */
export async function reconcileStalledTranscription(
  note: VoiceNote
): Promise<VoiceNote> {
  if (!isTranscriptionStalled(note.status as VoiceNoteStatus, note.updatedAt)) {
    return note;
  }

  log.warn(
    { noteId: note.id, since: note.updatedAt.toISOString() },
    "Transcription restée en cours trop longtemps, note repassée en échec"
  );
  await updateVoiceNote(note.id, {
    status: "failed",
    errorCode: VOICE_NOTE_ERROR_CODES.transcriptionStalled,
  });

  // On rend la note telle qu'on vient de l'écrire, sans dépendre de ce que la
  // mise à jour a renvoyé : l'appelant décide sur un état certain.
  return {
    ...note,
    status: "failed",
    errorCode: VOICE_NOTE_ERROR_CODES.transcriptionStalled,
    updatedAt: new Date(),
  };
}

/**
 * Sort une note d'un traitement IA abandonné : la génération de fond a disparu
 * sans jamais écrire son résultat. On efface le marqueur et on pose un code
 * d'erreur explicite, pour que le bloc propose une relance au lieu de sonder
 * indéfiniment. La sortie précédente, si elle existe, n'est pas touchée.
 */
export async function reconcileStalledProcessing(
  note: VoiceNote
): Promise<VoiceNote> {
  if (!isProcessingStalled(note.processingKind, note.processingStartedAt)) {
    return note;
  }

  log.warn(
    { noteId: note.id, kind: note.processingKind },
    "Traitement IA resté en cours trop longtemps, marqueur effacé"
  );
  await updateVoiceNote(note.id, {
    processingKind: null,
    processingStartedAt: null,
    errorCode: VOICE_NOTE_ERROR_CODES.aiStalled,
  });

  return {
    ...note,
    processingKind: null,
    processingStartedAt: null,
    errorCode: VOICE_NOTE_ERROR_CODES.aiStalled,
    updatedAt: new Date(),
  };
}

/**
 * Requalifie les deux formes de travail de fond abandonné, transcription et
 * traitement IA. Point d'entrée unique du chargement d'une note : toutes les
 * routes repartent ainsi du même état réel.
 */
export async function reconcileStalledVoiceNote(
  note: VoiceNote
): Promise<VoiceNote> {
  return reconcileStalledProcessing(await reconcileStalledTranscription(note));
}

/**
 * Projection destinée au bloc : jamais le chemin serveur de l'audio, et les
 * deux drapeaux de péremption calculés à partir des empreintes.
 */
export function serializeVoiceNote(note: VoiceNote): VoiceNoteView {
  return {
    id: note.id,
    documentId: note.documentId,
    status: note.status as VoiceNoteStatus,
    durationSeconds: note.durationSeconds,
    transcript: note.transcript,
    transcriptValidatedAt: note.transcriptValidatedAt
      ? note.transcriptValidatedAt.toISOString()
      : null,
    summary: note.summary,
    cleanedText: note.cleanedText,
    summaryStale: isOutputStale(
      note.transcript,
      note.summary,
      note.summaryTranscriptHash
    ),
    cleanedStale: isOutputStale(
      note.transcript,
      note.cleanedText,
      note.cleanedTranscriptHash
    ),
    processingKind: (note.processingKind as VoiceNoteProcessKind | null) ?? null,
    hasAudio: !!note.audioPath,
    errorCode: note.errorCode,
    createdAt: note.createdAt.toISOString(),
    updatedAt: note.updatedAt.toISOString(),
  };
}

/**
 * Même projection, augmentée de la disponibilité du moteur de transcription.
 *
 * Réservée aux deux entrées du bloc, création et lecture : ce sont elles qui
 * décident de l'écran initial, donc du bloc désactivé d'emblée quand aucun
 * moteur n'est configuré. La vérification est mise en cache quelques secondes
 * (voir `availability.ts`), elle ne coûte donc pas une lecture de configuration
 * à chaque sondage.
 */
export async function serializeVoiceNoteWithAvailability(
  note: VoiceNote
): Promise<VoiceNoteView> {
  return {
    ...serializeVoiceNote(note),
    transcriptionAvailable: await isVoiceNoteTranscriptionAvailable(),
  };
}
