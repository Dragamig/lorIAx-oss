import { Worker } from "node:worker_threads";

export type PdfFirstPage = { webp: Buffer; width: number; height: number; pageCount: number };

const DEFAULT_WIDTH = 480;
const DEFAULT_TIMEOUT_MS = 15_000;
/** Mémoire du worker de rendu (tas JS) : un PDF hostile ne fait pas tomber le process. */
const WORKER_LIMITS = { maxOldGenerationSizeMb: 512, maxYoungGenerationSizeMb: 64, stackSizeMb: 4 };

/**
 * Le fichier worker est du JS pur, jamais bundlé. Chemin relatif au répertoire
 * de travail (Node le résout ainsi pour un Worker) : racine de l'app en dev, test
 * et script ; racine de l'image standalone en production (fichier copié par
 * `outputFileTracingIncludes`). Aucun accès disque ni `process.cwd()` ici :
 * Turbopack tenterait d'embarquer tout le projet. Fichier absent : l'événement
 * `error` du worker donne « pas de miniature ».
 */
const WORKER_FILE = "./src/lib/media/pdf-thumbnail-worker.mjs";

/**
 * Rend la 1re page d'un PDF en WebP (fond blanc). Retourne null pour tout PDF
 * illisible, protégé, trop gros, trop lent ou si le moteur est indisponible :
 * jamais d'exception. Le rendu tourne dans un worker_thread à mémoire bornée,
 * tué à l'échéance (le décodage pdfjs est synchrone : seul un thread séparé
 * protège la boucle principale). Aucun JavaScript PDF exécuté, aucune ressource
 * réseau (polices et CMap lus sur le disque, `eval` désactivé).
 */
export async function renderPdfFirstPage(
  buffer: Buffer,
  opts: { width?: number; timeoutMs?: number } = {},
): Promise<PdfFirstPage | null> {
  if (!buffer || buffer.length < 8) return null;
  const width = opts.width ?? DEFAULT_WIDTH;
  const timeoutMs = opts.timeoutMs ?? DEFAULT_TIMEOUT_MS;
  const data = new Uint8Array(buffer).buffer;

  return new Promise<PdfFirstPage | null>((resolve) => {
    let settled = false;
    let worker: Worker;
    const done = (r: PdfFirstPage | null) => {
      if (settled) return;
      settled = true;
      clearTimeout(timer);
      void worker?.terminate().catch(() => undefined);
      resolve(r);
    };
    const timer = setTimeout(() => done(null), timeoutMs);
    try {
      worker = new Worker(WORKER_FILE, {
        workerData: { data, width },
        transferList: [data],
        resourceLimits: WORKER_LIMITS,
      });
    } catch {
      done(null);
      return;
    }
    worker.on("message", (m: { ok: boolean; webp?: Uint8Array; width?: number; height?: number; pageCount?: number }) => {
      if (!m?.ok || !m.webp) return done(null);
      done({
        webp: Buffer.from(m.webp),
        width: m.width as number,
        height: m.height as number,
        pageCount: m.pageCount as number,
      });
    });
    worker.on("error", () => done(null));
    worker.on("exit", () => done(null));
  });
}
