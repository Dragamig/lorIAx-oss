import { NextRequest, NextResponse } from "next/server";
import { getSessionUser } from "@/lib/auth/get-user";
import { getFileUrl } from "@/lib/storage/s3";
import { resolveReadableAttachment } from "@/lib/storage/attachment-access";
import { presentationOverrides } from "@/lib/storage/safe-content-type";

/**
 * En-tête `Content-Disposition` complet, nom de fichier compris.
 *
 * Sans le paramètre `filename`, le téléchargement hérite du nom UUID de la clé S3
 * plutôt que du nom réel. Le nom est donné deux fois, en ASCII assaini puis en
 * `filename*` encodé RFC 5987, pour rester lisible quel que soit le navigateur.
 */
function contentDispositionHeader(disposition: string, filename: string): string {
  const fallback = filename.replace(/[^\x20-\x7E]/g, "_").replace(/["\\]/g, "_");
  return `${disposition}; filename="${fallback}"; filename*=UTF-8''${encodeURIComponent(filename)}`;
}

/**
 * Génère une URL signée Garage S3 pour un fichier attachment.
 * GET /api/attachments/signed?key={clé S3}
 */
export async function GET(req: NextRequest) {
  const user = await getSessionUser();
  if (!user) {
    return NextResponse.json({ error: "Non autorisé" }, { status: 401 });
  }

  const key = req.nextUrl.searchParams.get("key");
  if (!key) {
    return NextResponse.json({ error: "Paramètre key manquant" }, { status: 400 });
  }

  // H8 - Only keys registered in the attachments table, and readable by the caller,
  // may be turned into a presigned URL. Signing an arbitrary key would hand out a
  // credential-free read on the whole bucket.
  const access = await resolveReadableAttachment(user, key);
  if (!access.ok) {
    if (access.reason === "forbidden") {
      return NextResponse.json({ error: "Accès refusé" }, { status: 403 });
    }
    return NextResponse.json({ error: "Fichier introuvable" }, { status: 404 });
  }

  try {
    // H9 : les objets déposés avant le durcissement portent encore le type déclaré
    // par leur déposant. Un `image/svg+xml` d'époque reste un XSS stocké vivant sur
    // l'origine S3, que le `nosniff` de la route proxy ne couvre pas puisque cette
    // URL présignée s'ouvre directement sur le stockage. Le type et la disposition
    // sont donc imposés à la signature, ce qui referme le vecteur sur les
    // installations existantes sans reprise de données.
    const presentation = presentationOverrides(access.attachment.mimeType);

    // La clé signée est celle relue en base, pas la chaîne du paramètre : les deux
    // sont égales par construction, l'invariant devient structurel.
    const url = await getFileUrl(access.attachment.storageKey, 900, {
      responseContentType: presentation.contentType,
      responseContentDisposition: contentDispositionHeader(
        presentation.contentDisposition,
        access.attachment.filename
      ),
    });
    return NextResponse.json({ url });
  } catch {
    return NextResponse.json({ error: "Fichier introuvable" }, { status: 404 });
  }
}
