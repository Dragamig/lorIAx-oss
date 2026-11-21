import { fileTypeFromBuffer } from "file-type";

/**
 * Contrôle du type réel d'une image envoyée en upload, partagé entre toutes
 * les routes qui écrivent dans `media` (studio d'images et bibliothèque
 * d'images de l'admin).
 *
 * Constat d'audit (2026-08-19, INJ-03) : le type déclaré par le client était
 * repris tel quel comme type stocké et comme source de l'extension de la clé
 * de stockage, sans qu'aucun contrôle des octets réels du fichier ne soit
 * effectué. Une image vectorielle (SVG) porteuse d'un script entrait ainsi en
 * base sans filtre, et pouvait ressortir exécutable selon la route de
 * restitution. Ce module est le rempart d'entrée : les formats matriciels sont
 * confrontés à leurs octets de tête via `file-type`, comme le fait
 * `src/app/api/attachments/route.ts`, et le SVG, que `file-type` ne sait pas
 * reconnaître (c'est du XML texte), passe par un contrôle structurel dédié.
 *
 * Le SVG reste accepté : le logo de marque en SVG est un usage réel du
 * panneau « Marque » et du studio design. Sa neutralisation à la restitution
 * (nosniff, CSP verrouillée, téléchargement forcé) est posée côté route de
 * lecture, pas ici.
 *
 * Deuxième constat corrigé au passage : la route admin dérivait l'extension
 * de la clé S3 du nom de fichier fourni par le client. Ici, l'extension vient
 * uniquement du type canonique validé, jamais d'une chaîne fournie par
 * l'appelant.
 */

/**
 * Formats matriciels acceptés, et extensions que `file-type` doit détecter
 * dans les octets de tête pour chacun. Un PNG déclaré `image/jpeg` est
 * refusé, tout comme un document HTML déguisé en image.
 */
const RASTER_TYPES: Record<string, readonly string[]> = {
  "image/jpeg": ["jpg", "jpeg"],
  "image/png": ["png"],
  "image/webp": ["webp"],
  "image/gif": ["gif"],
};

const SVG_TYPE = "image/svg+xml";

/** Extension de la clé de stockage, dérivée du type canonique, jamais du nom client. */
const EXTENSION_BY_TYPE: Record<string, string> = {
  "image/jpeg": "jpg",
  "image/png": "png",
  "image/webp": "webp",
  "image/gif": "gif",
  [SVG_TYPE]: "svg",
};

/** Normalise `image/PNG; charset=utf-8` en `image/png`. */
function normalizeContentType(raw: string): string {
  return raw.split(";")[0]!.trim().toLowerCase();
}

/**
 * Contrôle structurel d'un SVG. Objectif premier : garantir que le contenu est
 * bien du XML dont la racine est `<svg>`, pour qu'un document HTML ne puisse
 * pas être stocké sous le type `image/svg+xml`.
 *
 * Le refus des gestes actifs (`<script>`, gestionnaires `on*`, `javascript:`,
 * `<foreignObject>`) est un filet SECONDAIRE, volontairement grossier : un
 * nettoyage XML exhaustif demanderait une dépendance de sanitisation que le
 * projet n'a pas et qu'il faudrait maintenir. La défense qui fait autorité est
 * la neutralisation à la restitution (nosniff + CSP verrouillée + téléchargement
 * forcé sur le seul SVG).
 */
export function validateSvg(buffer: Buffer): { ok: true } | { ok: false; error: string } {
  const text = buffer.toString("utf8").replace(/^﻿/, "");

  // Retirer déclaration XML, commentaires et DOCTYPE avant de lire la racine.
  const head = text
    .replace(/<\?xml[\s\S]*?\?>/gi, "")
    .replace(/<!--[\s\S]*?-->/g, "")
    .replace(/<!DOCTYPE[\s\S]*?>/gi, "")
    .trimStart();

  if (!/^<svg[\s>/]/i.test(head)) {
    return { ok: false, error: "Contenu SVG invalide (racine <svg> attendue)" };
  }

  if (
    /<\s*script[\s>]/i.test(text) ||
    /<\s*foreignObject[\s>]/i.test(text) ||
    /\son[a-z]+\s*=/i.test(text) ||
    /javascript\s*:/i.test(text)
  ) {
    return { ok: false, error: "SVG refusé : il contient du contenu actif (script ou gestionnaire d'événement)" };
  }

  return { ok: true };
}

export interface ImageValidationOk {
  ok: true;
  /** Contenu binaire du fichier, déjà lu, pour éviter de relire le flux plus loin. */
  buffer: Buffer;
  /** Type canonique validé : celui à stocker et à reservir, jamais la chaîne brute du client. */
  contentType: string;
  /** Extension dérivée du type canonique, jamais du nom de fichier fourni par le client. */
  ext: string;
}

export interface ImageValidationError {
  ok: false;
  status: number;
  error: string;
}

/**
 * Valide un fichier image envoyé en upload : type déclaré reconnu, octets de
 * tête cohérents (formats matriciels) ou structure XML saine (SVG).
 *
 * Point d'entrée unique à appeler par toute route qui écrit dans
 * `media`, avant tout appel de stockage ou d'insertion en base.
 */
export async function validateImageUpload(
  file: File
): Promise<ImageValidationOk | ImageValidationError> {
  // Type canonique : ce qui sera stocké et resservi, jamais la chaîne brute du
  // client (qui peut porter des paramètres ou une casse arbitraire).
  const declaredType = normalizeContentType(file.type ?? "");
  if (declaredType !== SVG_TYPE && !(declaredType in RASTER_TYPES)) {
    return { ok: false, status: 400, error: "Format non supporté (jpg, png, webp, gif, svg)" };
  }

  const buffer = Buffer.from(await file.arrayBuffer());

  if (declaredType === SVG_TYPE) {
    const verdict = validateSvg(buffer);
    if (!verdict.ok) return { ok: false, status: 400, error: verdict.error };
  } else {
    // Contrôle des octets de tête : le type déclaré doit correspondre au
    // contenu réel (constat INJ-03, audit du 2026-08-19).
    const detected = await fileTypeFromBuffer(buffer);
    if (!detected) return { ok: false, status: 415, error: "Type de fichier non reconnu" };
    if (!RASTER_TYPES[declaredType]!.includes(detected.ext)) {
      return {
        ok: false,
        status: 400,
        error: `Type de fichier incohérent : déclaré ${declaredType} mais contenu détecté comme .${detected.ext}`,
      };
    }
  }

  const ext = EXTENSION_BY_TYPE[declaredType]!;
  return { ok: true, buffer, contentType: declaredType, ext };
}
