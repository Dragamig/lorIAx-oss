import { NextRequest, NextResponse } from "next/server";
import { readFile } from "fs/promises";
import { extname } from "path";
import { z } from "zod";
import { getSessionUser } from "@/lib/auth/get-user";
import { checkRateLimitAsync, RATE_LIMITS } from "@/lib/rate-limit";
import { guardVoiceNotesModule } from "@/lib/voice-notes/guards";
import { loadVoiceNoteWithAccess } from "@/lib/voice-notes/access";
import { serializeVoiceNote, updateVoiceNote } from "@/lib/voice-notes/store";
import { canAcceptAudio } from "@/lib/voice-notes/state-machine";
import { startTranscription } from "@/lib/voice-notes/transcription";
import {
  validateAudioUpload,
  isAudioContentPlausible,
  saveAudioStream,
  isInsideAudioDir,
  mimeTypeForExtension,
  exceedsDeclaredSize,
  AUDIO_SNIFF_BYTES,
  ACCEPTED_AUDIO_MESSAGE,
  TOO_LARGE_AUDIO_MESSAGE,
} from "@/lib/voice-notes/audio";
import type { VoiceNoteStatus } from "@/lib/voice-notes/types";

const durationSchema = z
  .number()
  .int()
  .min(0)
  .max(24 * 3600);

/**
 * POST /api/voice-notes/[id]/audio : reçoit l'audio (multipart), écrit un
 * fichier temporaire, passe la note en `transcribing` et lance la
 * transcription en tâche de fond. Le client suit l'avancement via GET.
 */
export async function POST(
  request: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  const user = await getSessionUser();
  if (!user) return NextResponse.json({ error: "Non authentifié" }, { status: 401 });

  const moduleBlocked = await guardVoiceNotesModule(user);
  if (moduleBlocked) return moduleBlocked;

  const limit = await checkRateLimitAsync(`voice-note-audio:${user.id}`, RATE_LIMITS.meet);
  if (!limit.success) {
    return NextResponse.json(
      { error: "Trop d'envois audio, réessayez dans une minute" },
      { status: 429 }
    );
  }

  const { id } = await params;
  const access = await loadVoiceNoteWithAccess(user, id, "edit");
  if (!access.ok) {
    return NextResponse.json({ error: access.error }, { status: access.status });
  }

  const status = access.note.status as VoiceNoteStatus;
  if (!canAcceptAudio(status)) {
    return NextResponse.json(
      { error: `Aucun audio ne peut être reçu dans l'état ${status}` },
      { status: 409 }
    );
  }

  // Refus avant lecture du corps : un envoi manifestement hors plafond ne doit
  // pas être chargé en mémoire pour être ensuite rejeté.
  if (exceedsDeclaredSize(request.headers.get("content-length"))) {
    return NextResponse.json({ error: TOO_LARGE_AUDIO_MESSAGE }, { status: 413 });
  }

  let formData: FormData;
  try {
    formData = await request.formData();
  } catch {
    return NextResponse.json({ error: "Corps multipart invalide" }, { status: 400 });
  }

  const file = formData.get("audio") ?? formData.get("file");
  if (!(file instanceof File)) {
    return NextResponse.json({ error: "Champ audio manquant" }, { status: 400 });
  }

  // `file.size` est la taille réellement reçue, mesurée à l'analyse du corps,
  // pas une valeur annoncée par le client.
  const validation = validateAudioUpload({
    declaredType: file.type,
    byteLength: file.size,
  });
  if (!validation.ok) {
    return NextResponse.json({ error: validation.message }, { status: validation.status });
  }
  // Seuls les octets de tête servent à identifier le conteneur : inutile de
  // recopier le fichier entier en mémoire pour ce contrôle.
  const head = Buffer.from(await file.slice(0, AUDIO_SNIFF_BYTES).arrayBuffer());
  if (!(await isAudioContentPlausible(head))) {
    return NextResponse.json({ error: ACCEPTED_AUDIO_MESSAGE }, { status: 415 });
  }

  const rawDuration = formData.get("durationSeconds");
  let durationSeconds: number | null = null;
  if (typeof rawDuration === "string" && rawDuration !== "") {
    const parsed = durationSchema.safeParse(Number(rawDuration));
    if (!parsed.success) {
      return NextResponse.json({ error: "durationSeconds invalide" }, { status: 400 });
    }
    durationSeconds = parsed.data;
  }

  // Écriture en flux : le contenu part vers le disque sans seconde copie.
  const audioPath = await saveAudioStream(id, validation.extension, file.stream());
  await updateVoiceNote(id, { audioPath, durationSeconds, errorCode: null });
  await startTranscription(id, status);

  const note = await loadVoiceNoteWithAccess(user, id, "view");
  return NextResponse.json(
    note.ok ? serializeVoiceNote(note.note) : { id, status: "transcribing" },
    { status: 202 }
  );
}

/**
 * GET /api/voice-notes/[id]/audio : télécharge l'audio encore conservé.
 * Sert l'état d'échec : l'utilisateur récupère sa prise de son avant relance.
 */
export async function GET(
  _request: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  const user = await getSessionUser();
  if (!user) return NextResponse.json({ error: "Non authentifié" }, { status: 401 });

  const moduleBlocked = await guardVoiceNotesModule(user);
  if (moduleBlocked) return moduleBlocked;

  const { id } = await params;
  const access = await loadVoiceNoteWithAccess(user, id, "view");
  if (!access.ok) {
    return NextResponse.json({ error: access.error }, { status: access.status });
  }

  const audioPath = access.note.audioPath;
  if (!audioPath || !isInsideAudioDir(audioPath)) {
    return NextResponse.json({ error: "Aucun audio conservé" }, { status: 404 });
  }

  let data: Buffer;
  try {
    data = await readFile(audioPath);
  } catch {
    return NextResponse.json({ error: "Aucun audio conservé" }, { status: 404 });
  }

  const extension = extname(audioPath).replace(".", "");
  return new NextResponse(new Uint8Array(data), {
    headers: {
      "Content-Type": mimeTypeForExtension(extension),
      "Content-Disposition": `attachment; filename="note-vocale-${id}.${extension}"`,
      "Content-Length": String(data.byteLength),
    },
  });
}
