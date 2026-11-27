import JSZip from "jszip";
import { MAX_UNZIPPED_BYTES, MAX_ZIP_ENTRIES, MAX_ZIP_ENTRY_BYTES } from "./limits";

/** Archive hostile : trop d'entrées ou trop volumineuse une fois décompressée. */
export class ZipLimitError extends Error {}

export type SafeZip = {
  has(name: string): boolean;
  names(): string[];
  /** Lit une entrée avec décompte réel des octets ; ZipLimitError au dépassement. */
  read(name: string): Promise<Buffer | null>;
};

/** Seuls les noms relatifs sans `..`, sans `\` ni `/` initial sont lisibles. */
function isSafeName(name: string): boolean {
  if (!name || name.startsWith("/") || name.includes("\\")) return false;
  return !name.split("/").includes("..");
}

/**
 * Ouvre une archive sans rien décompresser : seul l'annuaire central est lu.
 * Chaque entrée n'est décompressée qu'à la demande, en flux, avec un compteur
 * d'octets réellement produits (la taille annoncée peut mentir) : arrêt dès
 * qu'une entrée dépasse `MAX_ZIP_ENTRY_BYTES` ou que le cumul dépasse
 * `MAX_UNZIPPED_BYTES`. Lève ZipLimitError (trop d'entrées) ou l'erreur de
 * jszip (archive illisible).
 */
export async function openSafeZip(buffer: Buffer): Promise<SafeZip> {
  const zip = await JSZip.loadAsync(buffer, { checkCRC32: false });
  const all = Object.keys(zip.files);
  if (all.length > MAX_ZIP_ENTRIES) throw new ZipLimitError("too many entries");
  const state = { total: 0 };
  // jszip neutralise les noms à `..` mais garde l'original : entrée suspecte, ignorée.
  const unsafe = new Set(
    all.filter((n) => {
      const orig = (zip.files[n] as unknown as { unsafeOriginalName?: string }).unsafeOriginalName;
      return orig !== undefined && orig !== n;
    }),
  );

  return {
    has: (name) => isSafeName(name) && !unsafe.has(name) && !!zip.file(name),
    names: () => all.filter((n) => isSafeName(n) && !unsafe.has(n) && !zip.files[n].dir),
    read(name) {
      if (!isSafeName(name) || unsafe.has(name)) return Promise.resolve(null);
      const entry = zip.file(name);
      if (!entry) return Promise.resolve(null);
      const declared = (entry as unknown as { _data?: { uncompressedSize?: number } })._data
        ?.uncompressedSize;
      if (typeof declared === "number" && declared > MAX_ZIP_ENTRY_BYTES) {
        return Promise.reject(new ZipLimitError("entry too large"));
      }
      return new Promise<Buffer | null>((resolve, reject) => {
        const chunks: Buffer[] = [];
        let size = 0;
        const stream = entry.nodeStream("nodebuffer") as import("node:stream").Readable;
        stream.on("data", (chunk: Buffer) => {
          size += chunk.length;
          state.total += chunk.length;
          if (size > MAX_ZIP_ENTRY_BYTES || state.total > MAX_UNZIPPED_BYTES) {
            stream.destroy();
            reject(new ZipLimitError("decompressed size limit"));
            return;
          }
          chunks.push(chunk);
        });
        stream.on("end", () => resolve(Buffer.concat(chunks)));
        stream.on("error", reject);
      });
    },
  };
}
