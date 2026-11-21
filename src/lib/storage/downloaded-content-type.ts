import { fileTypeFromBuffer } from "file-type";
import { serveContentType } from "@/lib/storage/serve-content-type";

/**
 * H9 : type et extension a stocker pour un corps recupere sur une URL tierce
 * (synchro Airtable / Notion). Ni le `Content-Type` du serveur distant ni le nom
 * de fichier ne font foi : l'URL est saisie librement dans la base externe.
 * La decision part des octets reels ; tout ce qui n'est pas positivement un
 * format inerte (SVG, HTML, XML, inconnu) est stocke en binaire opaque. Aucun
 * fichier n'est refuse, il est neutralise, pour ne pas vider la cellule synchronisee.
 */

export interface DownloadedStorageType {
  ext: string;
  contentType: string;
  /** Vrai quand le format reel n'a pas pu etre conserve (stocke en binaire opaque). */
  neutralized: boolean;
}

const TEXT_TYPES: Record<string, string> = {
  txt: "text/plain",
  csv: "text/csv",
  md: "text/plain",
};

export async function resolveDownloadedStorageType(
  filenameHint: string,
  buffer: Buffer
): Promise<DownloadedStorageType> {
  const detected = await fileTypeFromBuffer(buffer);
  if (detected) {
    const served = serveContentType(detected.mime, `x.${detected.ext}`);
    if (served.disposition === "inline") {
      return { ext: detected.ext, contentType: served.contentType, neutralized: false };
    }
    // Formats bureautiques et archives : inertes, mais servis en piece jointe.
    if (!/svg|xml|html/.test(detected.mime) && !/svg|xml|html/.test(detected.ext)) {
      return { ext: detected.ext, contentType: detected.mime, neutralized: false };
    }
    return { ext: "bin", contentType: "application/octet-stream", neutralized: true };
  }

  const hintExt = filenameHint.includes(".")
    ? (filenameHint.split(".").pop() ?? "").toLowerCase()
    : "";
  const textType = TEXT_TYPES[hintExt];
  // Un texte sans octets magiques n'est conserve que s'il ne ressemble pas a du
  // balisage actif, sans quoi un `.txt` portant du HTML resterait ambigu.
  if (textType && !/<\s*(script|svg|html|iframe)/i.test(buffer.toString("utf8", 0, 4096))) {
    return { ext: hintExt, contentType: textType, neutralized: false };
  }
  return { ext: "bin", contentType: "application/octet-stream", neutralized: true };
}
