import { NextRequest, NextResponse } from "next/server";
import { db } from "@/lib/db";
import { attachments } from "@/lib/db/schema";
import { getSessionUser } from "@/lib/auth/get-user";
import { getSpacePermission } from "@/lib/auth/check-access";
import { uploadFile, getFileUrl } from "@/lib/storage/s3";
import { randomUUID } from "crypto";
import { fileTypeFromBuffer } from "file-type";

const ALLOWED_EXTENSIONS = new Set([
  "pdf", "doc", "docx", "xls", "xlsx", "ppt", "pptx", "odt", "ods", "odp",
  "txt", "csv", "json", "xml", "yaml", "yml", "md",
  "png", "jpg", "jpeg", "gif", "webp", "svg", "bmp", "ico",
  "mp4", "webm", "mp3", "wav", "ogg",
  "zip", "tar", "gz",
]);

// Extensions texte que file-type ne peut pas détecter (pas de magic bytes).
// H9 : `svg` a été retiré de cette liste : le SVG est un document actif (script,
// handlers, xlink), le laisser ici lui faisait sauter tout contrôle de contenu.
const TEXT_EXTENSIONS = new Set([
  "txt", "csv", "json", "xml", "yaml", "yml", "md",
]);

/**
 * H9 : Formats textuels que le navigateur peut exécuter s'il les rend en ligne
 * (SVG : balise script ; XML : feuille XSLT). Ils restent acceptés par le produit
 * mais sont stockés en binaire opaque : `application/octet-stream` +
 * `Content-Disposition: attachment` sur l'objet S3 lui-même, de sorte qu'une URL
 * signée ouverte directement sur l'origine de stockage déclenche un téléchargement
 * au lieu d'un rendu. Aucun XSS stocké n'est donc possible sur cette origine.
 */
const NEUTRALIZED_EXTENSIONS = new Set(["svg", "xml"]);

/** Content-Type sûr imposé par le serveur pour les extensions sans magic bytes. */
const TEXT_CONTENT_TYPES: Record<string, string> = {
  txt: "text/plain; charset=utf-8",
  csv: "text/csv; charset=utf-8",
  md: "text/plain; charset=utf-8",
  yaml: "text/plain; charset=utf-8",
  yml: "text/plain; charset=utf-8",
  json: "application/json; charset=utf-8",
};

/**
 * SEC-06 — Sanitise le nom de fichier pour empêcher path traversal et
 * caractères problématiques.
 */
function sanitizeFilename(name: string): string {
  return name
    // Supprimer les séquences de path traversal
    .replace(/\.\.\//g, "")
    .replace(/\.\.\\/g, "")
    // Supprimer les caractères de contrôle et problématiques
    .replace(/[<>:"/\\|?*\x00-\x1F]/g, "_")
    // Limiter la longueur
    .slice(0, 255)
    // Supprimer les points en début de nom (fichiers cachés)
    .replace(/^\.+/, "")
    || "fichier";
}

export async function POST(request: NextRequest) {
  const user = await getSessionUser();
  if (!user) return NextResponse.json({ error: "Non authentifié" }, { status: 401 });

  const formData = await request.formData();
  const file = formData.get("file") as File | null;
  const spaceId = formData.get("spaceId") as string | null;
  const documentId = formData.get("documentId") as string | null;

  if (!file || !spaceId) {
    return NextResponse.json({ error: "Fichier et spaceId requis" }, { status: 400 });
  }

  // Vérification de la permission sur l'espace
  const permission = await getSpacePermission(user.id, spaceId);
  if (!permission) {
    return NextResponse.json({ error: "Accès refusé à cet espace" }, { status: 403 });
  }

  // Validation de la taille (max 50 Mo)
  const MAX_FILE_SIZE = 50 * 1024 * 1024;
  if (file.size > MAX_FILE_SIZE) {
    return NextResponse.json(
      { error: "Fichier trop volumineux (max 50 Mo)" },
      { status: 413 }
    );
  }

  // Validation de l'extension
  const ext = file.name.split(".").pop()?.toLowerCase() || "";
  if (!ALLOWED_EXTENSIONS.has(ext)) {
    return NextResponse.json(
      { error: `Extension .${ext} non autorisée` },
      { status: 400 }
    );
  }

  const buffer = Buffer.from(await file.arrayBuffer());

  // H9 : Le Content-Type est décidé par le serveur, jamais repris de `file.type`
  // fourni par le client : c'est lui que S3 renverra ensuite sur son origine.
  let contentType: string;
  let contentDisposition: string | undefined;

  if (NEUTRALIZED_EXTENSIONS.has(ext)) {
    contentType = "application/octet-stream";
    contentDisposition = "attachment";
  } else if (TEXT_EXTENSIONS.has(ext)) {
    contentType = TEXT_CONTENT_TYPES[ext] ?? "application/octet-stream";
  } else {
    // SEC-05 : Vérification des magic bytes pour les fichiers binaires
    const detectedType = await fileTypeFromBuffer(buffer);

    if (!detectedType) {
      return NextResponse.json(
        { error: "Type de fichier non reconnu" },
        { status: 415 }
      );
    }

    // Vérifier que l'extension correspond au type MIME réel
    const detectedExt = detectedType.ext;
    // Normaliser jpg/jpeg
    const normalizedExt = ext === "jpg" ? "jpeg" : ext;
    const normalizedDetected = detectedExt === "jpg" ? "jpeg" : detectedExt;

    if (normalizedExt !== normalizedDetected) {
      return NextResponse.json(
        {
          error: `Type de fichier incohérent : extension .${ext} mais contenu détecté comme .${detectedExt}`,
        },
        { status: 400 }
      );
    }

    // Type MIME issu des octets réels, pas de la déclaration du client
    contentType = detectedType.mime;
  }

  // SEC-06 — Sanitiser le nom de fichier
  const safeName = sanitizeFilename(file.name);
  const key = `${spaceId}/${randomUUID()}.${ext}`;

  await uploadFile(key, buffer, contentType, { contentDisposition });

  const [attachment] = await db
    .insert(attachments)
    .values({
      documentId: documentId || undefined,
      spaceId,
      filename: safeName,
      mimeType: contentType,
      sizeBytes: file.size,
      storageKey: key,
      uploadedBy: user.id,
    })
    .returning();

  const url = await getFileUrl(key);

  // `key` et `size` sont les noms attendus par les cellules attachment de
  // l'éditeur (AttachmentMeta) ; les colonnes SQL s'appellent storageKey/sizeBytes.
  return NextResponse.json(
    { ...attachment, key: attachment.storageKey, size: attachment.sizeBytes, url },
    { status: 201 }
  );
}
