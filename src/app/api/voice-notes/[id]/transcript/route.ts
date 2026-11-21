import { NextRequest, NextResponse } from "next/server";
import { z } from "zod";
import { getSessionUser } from "@/lib/auth/get-user";
import { guardVoiceNotesModule } from "@/lib/voice-notes/guards";
import { loadVoiceNoteWithAccess } from "@/lib/voice-notes/access";
import { serializeVoiceNote, updateVoiceNote } from "@/lib/voice-notes/store";
import {
  canEditTranscript,
  statusAfterTranscriptEdit,
} from "@/lib/voice-notes/state-machine";
import { MAX_TRANSCRIPT_CHARS } from "@/lib/voice-notes/process";
import type { VoiceNoteStatus } from "@/lib/voice-notes/types";

const patchSchema = z.object({
  transcript: z
    .string()
    .max(MAX_TRANSCRIPT_CHARS, `Transcript trop long (${MAX_TRANSCRIPT_CHARS} caractères au maximum)`),
  /** Reprise explicite d'une note déjà validée : elle repasse en relecture. */
  reopen: z.boolean().optional(),
});

/**
 * PATCH /api/voice-notes/[id]/transcript : enregistre une correction.
 * Refusée sur une note validée sans reprise explicite ; avec reprise, la note
 * retourne en relecture et devra être revalidée avant tout traitement IA.
 */
export async function PATCH(
  request: NextRequest,
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

  let body: unknown;
  try {
    body = await request.json();
  } catch {
    return NextResponse.json({ error: "JSON invalide" }, { status: 400 });
  }
  const parsed = patchSchema.safeParse(body);
  if (!parsed.success) {
    return NextResponse.json({ error: parsed.error.issues[0].message }, { status: 400 });
  }

  const status = access.note.status as VoiceNoteStatus;
  if (!canEditTranscript(status, { reopen: parsed.data.reopen })) {
    const message =
      status === "validated"
        ? "Transcript validé : reprise explicite requise pour le corriger"
        : `Le transcript n'est pas corrigeable dans l'état ${status}`;
    return NextResponse.json({ error: message }, { status: 409 });
  }

  const nextStatus = statusAfterTranscriptEdit(status);
  const note = await updateVoiceNote(id, {
    transcript: parsed.data.transcript,
    status: nextStatus,
    // Une reprise annule la validation : les traitements IA redeviennent
    // inaccessibles tant que le transcript n'est pas revalidé.
    transcriptValidatedAt: nextStatus === "review" ? null : access.note.transcriptValidatedAt,
  });

  return NextResponse.json(serializeVoiceNote(note));
}
