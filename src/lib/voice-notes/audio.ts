import { mkdir, writeFile, unlink } from "fs/promises";
import { tmpdir } from "os";
import { join, resolve, sep } from "path";
import { Readable } from "stream";
import type { ReadableStream as WebReadableStream } from "stream/web";
import logger from "@/lib/logger";

const log = logger.child({ module: "voice-notes-audio" });

/**
 * Plafond serveur.
 *
 * Le corps multipart est analysé par Next.js avant d'arriver ici : le fichier
 * existe donc entièrement en mémoire le temps de la requête, et rien ne
 * sérialise deux envois simultanés. 50 Mo borne franchement ce coût, tout en
 * laissant largement plus d'une heure d'audio compressé (un opus à 32 kbit/s
 * tient environ 3,5 heures dans 50 Mo).
 */
export const MAX_AUDIO_BYTES = 50 * 1024 * 1024;

/**
 * Marge accordée à l'enveloppe multipart (frontières, en têtes de partie) quand
 * on refuse un envoi sur la seule taille annoncée, avant d'avoir lu le corps.
 */
const MULTIPART_OVERHEAD_BYTES = 8 * 1024;

/** Nombre d'octets de tête suffisants pour identifier un conteneur média. */
export const AUDIO_SNIFF_BYTES = 4100;

/** Extensions réellement écrites sur disque, dérivées du type déclaré. */
export const ALLOWED_AUDIO_EXTENSIONS = [
  "mp3",
  "m4a",
  "ogg",
  "wav",
  "webm",
] as const;

export type AllowedAudioExtension = (typeof ALLOWED_AUDIO_EXTENSIONS)[number];

/**
 * Types MIME acceptés, y compris les variantes émises par MediaRecorder
 * (`audio/webm;codecs=opus`) et les alias historiques des navigateurs.
 * Le contrôle porte sur le type déclaré, jamais sur l'extension du nom de
 * fichier fourni par le client.
 */
const MIME_TO_EXTENSION: Record<string, AllowedAudioExtension> = {
  "audio/mpeg": "mp3",
  "audio/mp3": "mp3",
  "audio/mp4": "m4a",
  "audio/x-m4a": "m4a",
  "audio/m4a": "m4a",
  "audio/ogg": "ogg",
  "application/ogg": "ogg",
  "audio/vorbis": "ogg",
  "audio/opus": "ogg",
  "audio/wav": "wav",
  "audio/wave": "wav",
  "audio/x-wav": "wav",
  "audio/vnd.wave": "wav",
  "audio/webm": "webm",
  // MediaRecorder étiquette parfois une capture audio seule en conteneur vidéo.
  "video/webm": "webm",
};

/** Message unique, qui annonce ce qui est accepté (format ET taille). */
export const ACCEPTED_AUDIO_MESSAGE =
  "Format audio non accepté. Formats acceptés : mp3, m4a, ogg, wav, webm, 50 Mo au maximum.";

export const TOO_LARGE_AUDIO_MESSAGE =
  "Fichier audio trop volumineux. Formats acceptés : mp3, m4a, ogg, wav, webm, 50 Mo au maximum.";

export type AudioValidation =
  | { ok: true; extension: AllowedAudioExtension }
  | { ok: false; status: 400 | 413 | 415; message: string };

/**
 * Valide un envoi audio sur le type déclaré ET la taille réellement reçue.
 * `byteLength` doit provenir du corps effectivement lu, pas d'un champ client.
 */
export function validateAudioUpload(input: {
  declaredType: string | null | undefined;
  byteLength: number;
}): AudioValidation {
  const declared = (input.declaredType ?? "").split(";")[0].trim().toLowerCase();
  const extension = MIME_TO_EXTENSION[declared];

  if (!extension) {
    return { ok: false, status: 415, message: ACCEPTED_AUDIO_MESSAGE };
  }
  if (input.byteLength <= 0) {
    return { ok: false, status: 400, message: "Fichier audio vide." };
  }
  if (input.byteLength > MAX_AUDIO_BYTES) {
    return { ok: false, status: 413, message: TOO_LARGE_AUDIO_MESSAGE };
  }
  return { ok: true, extension };
}

/**
 * Refus au vu du seul en tête `Content-Length`, avant d'analyser le corps.
 * Évite de charger en mémoire un envoi que la validation rejettera de toute
 * façon. Un en tête absent ou illisible ne conclut rien : la taille réellement
 * reçue reste seule juge.
 */
export function exceedsDeclaredSize(contentLength: string | null): boolean {
  if (!contentLength) return false;
  const declared = Number(contentLength);
  if (!Number.isFinite(declared)) return false;
  return declared > MAX_AUDIO_BYTES + MULTIPART_OVERHEAD_BYTES;
}

/**
 * Contrôle de contenu complémentaire : les octets de tête doivent décrire un
 * média. Un conteneur non reconnu (flux MediaRecorder tronqué, par exemple) ne
 * fait pas échouer l'envoi, le type déclaré et la taille réelle ont déjà
 * tranché ; seul un contenu formellement identifié comme non média est refusé.
 */
export async function isAudioContentPlausible(data: Buffer): Promise<boolean> {
  try {
    const { fileTypeFromBuffer } = await import("file-type");
    const detected = await fileTypeFromBuffer(data);
    if (!detected) return true;
    return (
      detected.mime.startsWith("audio/") ||
      detected.mime.startsWith("video/") ||
      detected.mime === "application/ogg"
    );
  } catch {
    return true;
  }
}

/**
 * Dossier des fichiers audio temporaires. Ces fichiers vivent le temps de la
 * relecture du transcript : la validation les efface.
 */
export function getAudioDir(): string {
  return (
    process.env.VOICE_NOTES_AUDIO_DIR || join(tmpdir(), "loriax-voice-notes")
  );
}

/** Vrai si le chemin est bien contenu dans le dossier des notes vocales. */
export function isInsideAudioDir(filePath: string): boolean {
  const dir = resolve(getAudioDir());
  const target = resolve(filePath);
  return target === dir || target.startsWith(dir + sep);
}

/**
 * Écrit l'audio reçu et renvoie son chemin. Un seul fichier par note.
 *
 * L'écriture se fait en flux : le fichier n'est pas recopié une seconde fois en
 * mémoire, contrairement à un `arrayBuffer()` suivi d'un `writeFile`.
 */
export async function saveAudioStream(
  noteId: string,
  extension: AllowedAudioExtension,
  data: ReadableStream<Uint8Array>
): Promise<string> {
  const dir = getAudioDir();
  await mkdir(dir, { recursive: true });
  const filePath = join(dir, `${noteId}.${extension}`);
  await writeFile(
    filePath,
    Readable.fromWeb(data as WebReadableStream<Uint8Array>)
  );
  return filePath;
}

/** Efface l'audio, au mieux : un échec d'effacement ne bloque pas l'appelant. */
export async function deleteAudioFile(filePath: string): Promise<void> {
  if (!isInsideAudioDir(filePath)) {
    log.warn({ filePath }, "Chemin audio hors du dossier des notes vocales, effacement ignoré");
    return;
  }
  try {
    await unlink(filePath);
  } catch (err) {
    const code = (err as NodeJS.ErrnoException).code;
    if (code !== "ENOENT") {
      log.warn({ err: String(err), filePath }, "Effacement de l'audio impossible");
    }
  }
}

/** Type MIME renvoyé au téléchargement, dérivé de l'extension stockée. */
export function mimeTypeForExtension(extension: string): string {
  switch (extension.toLowerCase()) {
    case "mp3":
      return "audio/mpeg";
    case "m4a":
      return "audio/mp4";
    case "ogg":
      return "audio/ogg";
    case "wav":
      return "audio/wav";
    case "webm":
      return "audio/webm";
    default:
      return "application/octet-stream";
  }
}
