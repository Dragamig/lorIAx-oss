import { createHash } from "crypto";
import sharp from "sharp";

const PROCESSABLE = new Set(["image/png", "image/jpeg", "image/webp", "image/gif", "image/avif"]);
const THUMBNAIL_WIDTH = 320;
const TAG_GPS_INFO = 0x8825;

export type ProcessedImage = {
  width: number | null;
  height: number | null;
  thumbnail: Buffer | null;
  thumbnailMime: "image/webp" | null;
  hasLocationExif: boolean;
};

export function sha256Hex(buffer: Buffer): string {
  return createHash("sha256").update(buffer).digest("hex");
}

/**
 * Vrai si le tampon EXIF (TIFF, tel que fourni par sharp) contient un IFD GPS
 * non vide. Lecture seule : l'original n'est jamais réencodé (choix B88).
 */
function exifHasGps(exif: Buffer | undefined): boolean {
  try {
    if (!exif || exif.length < 8) return false;
    // Certains tampons gardent le préfixe "Exif\0\0".
    const start = exif.subarray(0, 6).toString("latin1") === "Exif\0\0" ? 6 : 0;
    const tiff = exif.subarray(start);
    const order = tiff.subarray(0, 2).toString("latin1");
    if (order !== "II" && order !== "MM") return false;
    const le = order === "II";
    const u16 = (o: number) => (le ? tiff.readUInt16LE(o) : tiff.readUInt16BE(o));
    const u32 = (o: number) => (le ? tiff.readUInt32LE(o) : tiff.readUInt32BE(o));

    const ifd0 = u32(4);
    const count = u16(ifd0);
    for (let i = 0; i < count; i++) {
      const entry = ifd0 + 2 + i * 12;
      if (u16(entry) !== TAG_GPS_INFO) continue;
      const gpsIfd = u32(entry + 8);
      if (gpsIfd <= 0 || gpsIfd + 2 > tiff.length) return false;
      return u16(gpsIfd) > 0;
    }
    return false;
  } catch {
    return false;
  }
}

export async function processImage(buffer: Buffer, mime: string): Promise<ProcessedImage> {
  const empty: ProcessedImage = {
    width: null,
    height: null,
    thumbnail: null,
    thumbnailMime: null,
    hasLocationExif: false,
  };
  if (!PROCESSABLE.has(mime.toLowerCase())) return empty;

  const image = sharp(buffer, { failOn: "none" });
  const meta = await image.metadata();
  const thumbnail = await sharp(buffer, { failOn: "none" })
    .rotate()
    .resize({ width: THUMBNAIL_WIDTH, withoutEnlargement: true })
    .webp({ quality: 80 })
    .toBuffer();

  // EXIF orientation 5 à 8 : l'image est affichée pivotée de 90 degrés.
  const swap = (meta.orientation ?? 1) >= 5;
  const w = meta.width ?? null;
  const h = meta.height ?? null;
  return {
    width: swap ? h : w,
    height: swap ? w : h,
    thumbnail,
    thumbnailMime: "image/webp",
    hasLocationExif: exifHasGps(meta.exif),
  };
}
