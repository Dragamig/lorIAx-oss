import { Worker } from "node:worker_threads";
import { MAX_PDF_PAGES, MAX_TEXT_CHARS } from "./limits";

export type PdfText = { text: string; pages: number; truncated: boolean };

const DEFAULT_TIMEOUT_MS = 30_000;
/** Mémoire du worker (tas JS) : un PDF hostile ne fait pas tomber le process. */
const WORKER_LIMITS = { maxOldGenerationSizeMb: 512, maxYoungGenerationSizeMb: 64, stackSizeMb: 4 };
/** Chemin relatif au répertoire de travail, voir pdf-thumbnail.ts (même raison). */
const WORKER_FILE = "./src/lib/media/ai/pdf-text-worker.mjs";

/**
 * Extrait le texte d'un PDF dans un worker borné (mémoire, délai, pas de script
 * ni de réseau). `null` pour tout PDF illisible, chiffré, trop lent ou si le
 * moteur est indisponible : jamais d'exception. Un scan sans couche texte rend
 * `{ text: "" }`.
 */
export async function extractPdfText(
  buffer: Buffer,
  opts: { timeoutMs?: number; maxChars?: number } = {},
): Promise<PdfText | null> {
  if (!buffer || buffer.length < 8) return null;
  const timeoutMs = opts.timeoutMs ?? DEFAULT_TIMEOUT_MS;
  const data = new Uint8Array(buffer).buffer;

  return new Promise<PdfText | null>((resolve) => {
    let settled = false;
    let worker: Worker | undefined;
    const done = (r: PdfText | null) => {
      if (settled) return;
      settled = true;
      clearTimeout(timer);
      void worker?.terminate().catch(() => undefined);
      resolve(r);
    };
    const timer = setTimeout(() => done(null), timeoutMs);
    try {
      worker = new Worker(WORKER_FILE, {
        workerData: { data, maxPages: MAX_PDF_PAGES, maxChars: Math.min(opts.maxChars ?? MAX_TEXT_CHARS, MAX_TEXT_CHARS) },
        transferList: [data],
        resourceLimits: WORKER_LIMITS,
      });
    } catch {
      done(null);
      return;
    }
    worker.on("message", (m: { ok: boolean } & Partial<PdfText>) => {
      if (!m?.ok || typeof m.text !== "string") return done(null);
      done({ text: m.text, pages: m.pages as number, truncated: Boolean(m.truncated) });
    });
    worker.on("error", () => done(null));
    worker.on("exit", () => done(null));
  });
}
