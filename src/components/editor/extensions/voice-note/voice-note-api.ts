"use client";

/**
 * Contrat client de l'API des notes vocales.
 *
 * Le backend est ecrit en parallele : ce module reste tolerant sur la forme des
 * reponses (champs derives optionnels, codes d'erreur a plusieurs orthographes)
 * pour que l'interface ne casse pas si une variante est retenue.
 */

export type VoiceNoteStatus =
  | "recording"
  | "transcribing"
  | "review"
  | "validated"
  | "failed";

export type VoiceNoteProcessKind = "summary" | "cleanup";

export interface VoiceNoteState {
  id: string;
  status: VoiceNoteStatus;
  durationSeconds: number | null;
  transcript: string | null;
  transcriptValidatedAt: string | null;
  summary: string | null;
  cleanedText: string | null;
  /**
   * Traitement IA en cours cote serveur, s'il y en a un. Porte par la reponse
   * de l'API : l'attente survit ainsi a la fermeture du document.
   */
  processingKind?: VoiceNoteProcessKind | null;
  errorCode: string | null;
  createdAt?: string | null;
  updatedAt?: string | null;
  /** Vrai tant que le fichier audio est conserve cote serveur. */
  hasAudio?: boolean;
  /** Empreintes : servent a signaler un compte rendu anterieur a une correction. */
  transcriptHash?: string | null;
  summaryTranscriptHash?: string | null;
  cleanedTranscriptHash?: string | null;
  /** Si le serveur calcule lui meme l'obsolescence, ces champs font foi. */
  summaryStale?: boolean;
  cleanedStale?: boolean;
  /** Faux quand aucun moteur de transcription n'est configure sur l'instance. */
  transcriptionAvailable?: boolean;
}

/** Formats et taille acceptes, repris de la specification. */
export const ACCEPTED_AUDIO_EXTENSIONS = ["mp3", "m4a", "ogg", "wav", "webm"] as const;
/** Plafond serveur, repris ici pour refuser avant l'envoi (`audio.ts`). */
export const MAX_AUDIO_BYTES = 50 * 1024 * 1024;
export const AUDIO_INPUT_ACCEPT =
  ".mp3,.m4a,.ogg,.wav,.webm,audio/mpeg,audio/mp4,audio/ogg,audio/wav,audio/x-wav,audio/webm";

/** Codes renvoyes quand aucun moteur n'est configure, toutes variantes admises. */
const UNAVAILABLE_CODES = new Set([
  "transcription_unavailable",
  "transcription_disabled",
  "no_transcription_engine",
  "engine_not_configured",
  "module_disabled",
]);

/** Codes signalant un fichier hors format ou hors taille. */
const REJECTED_FILE_CODES = new Set([
  "invalid_audio_format",
  "unsupported_media_type",
  "invalid_format",
  "file_too_large",
  "payload_too_large",
]);

export class VoiceNoteApiError extends Error {
  readonly httpStatus: number;
  readonly code: string | null;

  constructor(httpStatus: number, code: string | null, message?: string) {
    super(message ?? code ?? `Erreur ${httpStatus}`);
    this.name = "VoiceNoteApiError";
    this.httpStatus = httpStatus;
    this.code = code;
  }

  get meansTranscriptionUnavailable(): boolean {
    return (
      this.httpStatus === 503 ||
      this.httpStatus === 501 ||
      (!!this.code && UNAVAILABLE_CODES.has(this.code))
    );
  }

  get meansFileRejected(): boolean {
    return (
      this.httpStatus === 413 ||
      this.httpStatus === 415 ||
      (!!this.code && REJECTED_FILE_CODES.has(this.code))
    );
  }
}

export function isTranscriptionUnavailableCode(code: string | null | undefined): boolean {
  return !!code && UNAVAILABLE_CODES.has(code);
}

function readCode(payload: unknown): string | null {
  if (!payload || typeof payload !== "object") return null;
  const record = payload as Record<string, unknown>;
  if (typeof record.code === "string") return record.code;
  if (typeof record.errorCode === "string") return record.errorCode;
  const nested = record.error;
  if (typeof nested === "string") return nested;
  if (nested && typeof nested === "object") {
    const nestedCode = (nested as Record<string, unknown>).code;
    if (typeof nestedCode === "string") return nestedCode;
  }
  return null;
}

async function parseBody(response: Response): Promise<unknown> {
  try {
    return await response.json();
  } catch {
    return null;
  }
}

async function request(input: string, init?: RequestInit): Promise<unknown> {
  const response = await fetch(input, init);
  const body = await parseBody(response);
  if (!response.ok) {
    throw new VoiceNoteApiError(response.status, readCode(body));
  }
  return body;
}

/** Normalise une reponse en etat exploitable, quelle que soit son enveloppe. */
export function toVoiceNoteState(payload: unknown, fallbackId?: string): VoiceNoteState | null {
  if (!payload || typeof payload !== "object") return null;
  const record = payload as Record<string, unknown>;
  const inner =
    record.voiceNote && typeof record.voiceNote === "object"
      ? (record.voiceNote as Record<string, unknown>)
      : record.note && typeof record.note === "object"
        ? (record.note as Record<string, unknown>)
        : record;

  const id = typeof inner.id === "string" ? inner.id : fallbackId;
  if (!id) return null;

  const status = typeof inner.status === "string" ? inner.status : "recording";

  return {
    id,
    status: status as VoiceNoteStatus,
    durationSeconds:
      typeof inner.durationSeconds === "number" ? inner.durationSeconds : null,
    transcript: typeof inner.transcript === "string" ? inner.transcript : null,
    transcriptValidatedAt:
      typeof inner.transcriptValidatedAt === "string"
        ? inner.transcriptValidatedAt
        : null,
    summary: typeof inner.summary === "string" ? inner.summary : null,
    cleanedText: typeof inner.cleanedText === "string" ? inner.cleanedText : null,
    processingKind:
      inner.processingKind === "summary" || inner.processingKind === "cleanup"
        ? inner.processingKind
        : null,
    errorCode: typeof inner.errorCode === "string" ? inner.errorCode : null,
    createdAt: typeof inner.createdAt === "string" ? inner.createdAt : null,
    updatedAt: typeof inner.updatedAt === "string" ? inner.updatedAt : null,
    hasAudio: typeof inner.hasAudio === "boolean" ? inner.hasAudio : undefined,
    transcriptHash:
      typeof inner.transcriptHash === "string" ? inner.transcriptHash : null,
    summaryTranscriptHash:
      typeof inner.summaryTranscriptHash === "string"
        ? inner.summaryTranscriptHash
        : null,
    cleanedTranscriptHash:
      typeof inner.cleanedTranscriptHash === "string"
        ? inner.cleanedTranscriptHash
        : null,
    summaryStale:
      typeof inner.summaryStale === "boolean" ? inner.summaryStale : undefined,
    cleanedStale:
      typeof inner.cleanedStale === "boolean" ? inner.cleanedStale : undefined,
    transcriptionAvailable:
      typeof inner.transcriptionAvailable === "boolean"
        ? inner.transcriptionAvailable
        : undefined,
  };
}

export async function createVoiceNote(documentId: string): Promise<VoiceNoteState> {
  const body = await request("/api/voice-notes", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ documentId }),
  });
  const state = toVoiceNoteState(body);
  if (!state) throw new VoiceNoteApiError(500, "invalid_response");
  return state;
}

export async function fetchVoiceNote(id: string): Promise<VoiceNoteState> {
  const body = await request(`/api/voice-notes/${id}`);
  const state = toVoiceNoteState(body, id);
  if (!state) throw new VoiceNoteApiError(500, "invalid_response");
  return state;
}

export async function uploadVoiceNoteAudio(
  id: string,
  file: Blob,
  fileName: string,
  durationSeconds?: number
): Promise<VoiceNoteState | null> {
  const form = new FormData();
  form.append("audio", file, fileName);
  if (typeof durationSeconds === "number") {
    form.append("durationSeconds", String(Math.round(durationSeconds)));
  }
  const body = await request(`/api/voice-notes/${id}/audio`, {
    method: "POST",
    body: form,
  });
  return toVoiceNoteState(body, id);
}

/**
 * Enregistre une correction du transcript. Apres validation, la route refuse la
 * correction sans reprise explicite : `resumeCorrection` porte ce consentement.
 */
export async function saveVoiceNoteTranscript(
  id: string,
  transcript: string,
  resumeCorrection = false
): Promise<VoiceNoteState | null> {
  const body = await request(`/api/voice-notes/${id}/transcript`, {
    method: "PATCH",
    headers: { "Content-Type": "application/json" },
    // Le serveur nomme ce consentement `reopen` (voir la route transcript).
    body: JSON.stringify({ transcript, reopen: resumeCorrection }),
  });
  return toVoiceNoteState(body, id);
}

export async function validateVoiceNote(id: string): Promise<VoiceNoteState | null> {
  const body = await request(`/api/voice-notes/${id}/validate`, { method: "POST" });
  return toVoiceNoteState(body, id);
}

export async function processVoiceNote(
  id: string,
  kind: VoiceNoteProcessKind
): Promise<VoiceNoteState | null> {
  const body = await request(`/api/voice-notes/${id}/process`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ kind }),
  });
  return toVoiceNoteState(body, id);
}

export async function retryVoiceNote(id: string): Promise<VoiceNoteState | null> {
  const body = await request(`/api/voice-notes/${id}/retry`, { method: "POST" });
  return toVoiceNoteState(body, id);
}

export function voiceNoteAudioUrl(id: string): string {
  return `/api/voice-notes/${id}/audio`;
}

/** Le fichier est il recevable avant meme d'etre envoye ? */
export function isAcceptableAudioFile(file: File): boolean {
  if (file.size <= 0 || file.size > MAX_AUDIO_BYTES) return false;
  const extension = file.name.split(".").pop()?.toLowerCase() ?? "";
  if ((ACCEPTED_AUDIO_EXTENSIONS as readonly string[]).includes(extension)) return true;
  // Certains systemes deposent un fichier sans extension : on retombe sur le type.
  return !extension && file.type.startsWith("audio/");
}

/** Une sortie est elle anterieure a la derniere correction du transcript ? */
export function isOutputStale(
  state: VoiceNoteState,
  kind: VoiceNoteProcessKind
): boolean {
  const serverSide = kind === "summary" ? state.summaryStale : state.cleanedStale;
  if (typeof serverSide === "boolean") return serverSide;
  const outputHash =
    kind === "summary" ? state.summaryTranscriptHash : state.cleanedTranscriptHash;
  if (!outputHash || !state.transcriptHash) return false;
  return outputHash !== state.transcriptHash;
}
