import { NextRequest, NextResponse } from "next/server";
import { z } from "zod";
import { getSessionUser } from "@/lib/auth/get-user";
import { checkRateLimitAsync, RATE_LIMITS } from "@/lib/rate-limit";
import { guardVoiceNotesModule } from "@/lib/voice-notes/guards";
import { loadVoiceNoteWithAccess } from "@/lib/voice-notes/access";
import { serializeVoiceNote } from "@/lib/voice-notes/store";
import { canProcess } from "@/lib/voice-notes/state-machine";
import {
  startVoiceNoteProcess,
  MAX_TRANSCRIPT_CHARS,
} from "@/lib/voice-notes/process";
import type { VoiceNoteStatus } from "@/lib/voice-notes/types";

const processSchema = z.object({
  kind: z.enum(["summary", "cleanup"]),
});

/**
 * POST /api/voice-notes/[id]/process : synthèse ou mise au propre.
 *
 * Refusé si la note n'est pas validée : le garde-fou est ici, côté serveur,
 * et pas seulement dans l'interface.
 *
 * Réponse immédiate (202) : la génération continue en tâche de fond et le bloc
 * suit l'avancement par `GET /api/voice-notes/[id]`. Attendre la fin dans la
 * requête la ferait couper par le proxy sur les transcripts longs, et
 * l'utilisateur verrait une erreur alors que le traitement aboutit.
 */
export async function POST(
  request: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  const user = await getSessionUser();
  if (!user) return NextResponse.json({ error: "Non authentifié" }, { status: 401 });

  const moduleBlocked = await guardVoiceNotesModule(user);
  if (moduleBlocked) return moduleBlocked;

  const limit = await checkRateLimitAsync(`voice-note-process:${user.id}`, RATE_LIMITS.ai);
  if (!limit.success) {
    return NextResponse.json(
      { error: "Trop de traitements, réessayez dans une minute" },
      { status: 429 }
    );
  }

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
  const parsed = processSchema.safeParse(body);
  if (!parsed.success) {
    return NextResponse.json(
      { error: "kind doit valoir summary ou cleanup" },
      { status: 400 }
    );
  }

  const status = access.note.status as VoiceNoteStatus;
  if (!canProcess(status)) {
    return NextResponse.json(
      { error: "Le transcript doit être validé avant tout traitement" },
      { status: 409 }
    );
  }

  // Un seul traitement à la fois : deux générations concurrentes écriraient
  // l'une sur l'autre, et la seconde ne serait pas suivable.
  if (access.note.processingKind) {
    return NextResponse.json(
      { error: "Un traitement est déjà en cours sur cette note" },
      { status: 409 }
    );
  }

  const transcript = access.note.transcript ?? "";
  if (transcript.trim() === "") {
    return NextResponse.json({ error: "Transcript vide" }, { status: 409 });
  }
  if (transcript.length > MAX_TRANSCRIPT_CHARS) {
    return NextResponse.json(
      { error: `Transcript trop long (${MAX_TRANSCRIPT_CHARS} caractères au maximum)` },
      { status: 413 }
    );
  }

  const note = await startVoiceNoteProcess({
    noteId: id,
    kind: parsed.data.kind,
    transcript,
    userId: user.id,
  });

  return NextResponse.json(serializeVoiceNote(note), { status: 202 });
}
