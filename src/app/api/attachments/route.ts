import { NextRequest, NextResponse } from "next/server";
import { db } from "@/lib/db";
import { attachments, documents } from "@/lib/db/schema";
import { eq } from "drizzle-orm";
import { getSessionUser } from "@/lib/auth/get-user";
import { getSpacePermission, checkDocumentEditAccess } from "@/lib/auth/check-access";
import { uploadFile, getFileUrl } from "@/lib/storage/s3";
import { randomUUID } from "crypto";
import {
  ALLOWED_UPLOAD_EXTENSIONS,
  extensionOf,
  resolveSafeStorageType,
} from "@/lib/storage/safe-content-type";

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
  const ext = extensionOf(file.name);
  if (!ALLOWED_UPLOAD_EXTENSIONS.has(ext)) {
    return NextResponse.json(
      { error: `Extension .${ext} non autorisée` },
      { status: 400 }
    );
  }

  // Le document porteur gouverne desormais la lisibilite de la piece jointe
  // (`resolveReadableAttachment`). Accrocher un fichier a un document arbitraire
  // reviendrait donc a s'en priver soi-meme, ou a le deposer dans un espace tiers.
  if (documentId) {
    const [doc] = await db
      .select({ id: documents.id, spaceId: documents.spaceId })
      .from(documents)
      .where(eq(documents.id, documentId))
      .limit(1);

    if (!doc || doc.spaceId !== spaceId) {
      return NextResponse.json(
        { error: "Document introuvable dans cet espace" },
        { status: 404 }
      );
    }

    const canEdit = await checkDocumentEditAccess(user, doc.spaceId, doc.id);
    if (!canEdit) {
      return NextResponse.json({ error: "Accès refusé à ce document" }, { status: 403 });
    }
  }

  const buffer = Buffer.from(await file.arrayBuffer());

  // H9 : le Content-Type est decide par le serveur, jamais repris de `file.type`
  // fourni par le client : c'est lui que S3 renverra ensuite sur son origine.
  const storageType = await resolveSafeStorageType(ext, buffer);

  if (!storageType.ok) {
    if (storageType.reason === "unrecognized") {
      return NextResponse.json(
        { error: "Type de fichier non reconnu" },
        { status: 415 }
      );
    }
    if (storageType.reason === "mismatch") {
      return NextResponse.json(
        {
          error: `Type de fichier incohérent : extension .${ext} mais contenu détecté comme .${storageType.detectedExt}`,
        },
        { status: 400 }
      );
    }
    return NextResponse.json(
      { error: `Extension .${ext} non autorisée` },
      { status: 400 }
    );
  }

  const { contentType, contentDisposition } = storageType;

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
