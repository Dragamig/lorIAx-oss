import { spawn } from "child_process";
import { createWriteStream } from "fs";
import { mkdtemp, rm, stat } from "fs/promises";
import { tmpdir } from "os";
import { join } from "path";
import { pipeline } from "stream/promises";
import { Transform } from "stream";
import logger from "@/lib/logger";
import { getFileStream } from "@/lib/storage/s3";
import { isTranscriptionEnabled, transcribeWithEngine } from "@/lib/meet/transcribe";
import { getMediaAiSettings } from "./settings";
import { MAX_TEXT_CHARS, MAX_TRANSCRIBE_BYTES, MAX_TRANSCRIBE_SECONDS } from "./limits";

const log = logger.child({ module: "media-ai-transcribe" });

const PROBE_TIMEOUT_MS = 30_000;
const EXTRACT_TIMEOUT_MS = 10 * 60_000;

export type TranscribeMediaInput = {
  orgId: string;
  mediaId: string;
  storageKey: string;
  sizeBytes: number;
  mimeType: string;
  kind: "audio" | "video";
  /** Secondes encore disponibles aujourd'hui pour l'organisation (plafond calculé par l'appelant). */
  remainingDailySeconds?: number;
};

export type TranscribeMediaResult =
  | { ok: true; text: string; seconds: number; truncated: boolean }
  | {
      ok: false;
      reason: "no_engine" | "disabled" | "quota" | "too_large" | "too_long" | "no_audio" | "empty" | "error";
    };

/** `no_engine`, `quota` et `disabled` sont transitoires (l'appelant repousse), les autres définitifs. */

function ffmpegBin(): string {
  return process.env.FFMPEG_PATH || "ffmpeg";
}
function ffprobeBin(): string {
  return process.env.FFPROBE_PATH || "ffprobe";
}

/** Lance un processus (jamais via un shell), le tue à l'échéance. */
function run(cmd: string, args: string[], timeoutMs: number): Promise<string> {
  return new Promise((resolve, reject) => {
    const child = spawn(cmd, args, { stdio: ["ignore", "pipe", "ignore"] });
    let out = "";
    let done = false;
    const timer = setTimeout(() => {
      if (done) return;
      done = true;
      child.kill("SIGKILL");
      reject(new Error(`${cmd} : échéance dépassée`));
    }, timeoutMs);
    child.stdout?.on("data", (d) => {
      if (out.length < 1_000_000) out += String(d);
    });
    child.on("error", (e) => {
      if (done) return;
      done = true;
      clearTimeout(timer);
      reject(e);
    });
    child.on("close", (code) => {
      if (done) return;
      done = true;
      clearTimeout(timer);
      code === 0 ? resolve(out) : reject(new Error(`${cmd} a échoué (code ${code})`));
    });
  });
}

async function probe(file: string): Promise<{ seconds: number; hasAudio: boolean }> {
  const out = await run(
    ffprobeBin(),
    ["-v", "error", "-show_entries", "format=duration:stream=codec_type", "-of", "json", file],
    PROBE_TIMEOUT_MS,
  );
  const data = JSON.parse(out) as { format?: { duration?: string }; streams?: { codec_type?: string }[] };
  return {
    seconds: Number(data.format?.duration) || 0,
    hasAudio: (data.streams ?? []).some((s) => s.codec_type === "audio"),
  };
}

function isNetworkError(err: unknown): boolean {
  if (!(err instanceof Error)) return false;
  if (err.name === "TimeoutError" || err.name === "AbortError") return true;
  const code = (err.cause as { code?: string } | undefined)?.code ?? (err as { code?: string }).code;
  return err instanceof TypeError || ["ECONNREFUSED", "ENOTFOUND", "ECONNRESET", "EAI_AGAIN", "ETIMEDOUT"].includes(code ?? "");
}

function stamp(seconds: number): string {
  const total = Math.max(0, Math.floor(seconds));
  const m = Math.floor(total / 60);
  const s = total % 60;
  return `${String(m).padStart(2, "0")}:${String(s).padStart(2, "0")}`;
}

/**
 * Transcrit un audio ou une vidéo de la médiathèque avec le moteur déjà utilisé par
 * les notes vocales et les réunions. Fichiers temporaires dans un dossier créé par
 * `mkdtemp`, noms fixes, supprimés dans `finally`.
 */
export async function transcribeMedia(input: TranscribeMediaInput): Promise<TranscribeMediaResult> {
  if (!(await getMediaAiSettings(input.orgId)).transcribeEnabled) return { ok: false, reason: "disabled" };
  if (input.sizeBytes > MAX_TRANSCRIBE_BYTES) return { ok: false, reason: "too_large" };
  if (!(await isTranscriptionEnabled())) return { ok: false, reason: "no_engine" };
  if (input.remainingDailySeconds !== undefined && input.remainingDailySeconds <= 0) {
    return { ok: false, reason: "quota" };
  }

  let dir: string | null = null;
  try {
    dir = await mkdtemp(join(tmpdir(), "loriax-media-ai-"));
    const source = join(dir, "source.bin");
    const audio = join(dir, "audio.wav");

    let written = 0;
    const guard = new Transform({
      transform(chunk, _enc, cb) {
        written += chunk.length;
        if (written > MAX_TRANSCRIBE_BYTES) return cb(new Error("too_large"));
        cb(null, chunk);
      },
    });
    try {
      await pipeline(await getFileStream(input.storageKey), guard, createWriteStream(source));
    } catch (err) {
      if (err instanceof Error && err.message === "too_large") return { ok: false, reason: "too_large" };
      throw err;
    }

    const info = await probe(source);
    if (!info.hasAudio) return { ok: false, reason: "no_audio" };
    if (info.seconds > MAX_TRANSCRIBE_SECONDS) return { ok: false, reason: "too_long" };
    if (input.remainingDailySeconds !== undefined && info.seconds > input.remainingDailySeconds) {
      return { ok: false, reason: "quota" };
    }

    // La durée du conteneur est déclarative : on borne ce que ffmpeg produit, pas ce qu'il annonce.
    const maxSeconds = Math.floor(
      Math.min(MAX_TRANSCRIBE_SECONDS, input.remainingDailySeconds ?? Infinity),
    );
    await run(
      ffmpegBin(),
      ["-v", "error", "-nostdin", "-y", "-i", source, "-t", String(maxSeconds), "-vn", "-ac", "1", "-ar", "16000", "-c:a", "pcm_s16le", audio],
      EXTRACT_TIMEOUT_MS,
    );

    let result;
    try {
      result = await transcribeWithEngine(audio, { diarize: false });
    } catch (err) {
      if (isNetworkError(err)) return { ok: false, reason: "no_engine" };
      throw err;
    }

    let text = result.segments.length
      ? result.segments
          .map((s) => `[${stamp(s.start)}] ${s.text.trim()}`)
          .filter((l) => l.replace(/^\[\d+:\d+\]\s*/, ""))
          .join("\n")
      : result.text.trim();
    if (!text.trim()) return { ok: false, reason: "empty" };
    const truncated = text.length > MAX_TEXT_CHARS;
    if (truncated) text = text.slice(0, MAX_TEXT_CHARS);
    // Durée réelle de l'audio produit (WAV PCM 16 kHz mono 16 bits : 32 000 octets/s, en-tête de 44 octets).
    const wavBytes = await stat(audio).then((st) => st.size, () => 0);
    const seconds =
      wavBytes > 44 ? Math.ceil((wavBytes - 44) / 32_000) : result.duration || Math.min(info.seconds, maxSeconds);
    log.info({ mediaId: input.mediaId, orgId: input.orgId, seconds, chars: text.length }, "Transcription de média terminée");
    return { ok: true, text, seconds, truncated };
  } catch (err) {
    log.warn({ mediaId: input.mediaId, err: String(err) }, "Transcription de média échouée");
    return { ok: false, reason: "error" };
  } finally {
    if (dir) await rm(dir, { recursive: true, force: true }).catch(() => undefined);
  }
}
