import { NextRequest, NextResponse } from "next/server";
import { getSessionUser } from "@/lib/auth/get-user";
import { getFileUrl } from "@/lib/storage/s3";
import { canReadStorageKey } from "@/lib/storage/attachment-access";
import { getMediaByStorageKey, getMediaFull } from "@/lib/media/access";
import { buildContentDisposition } from "@/lib/media/content-disposition";
import { serveContentType } from "@/lib/storage/serve-content-type";

/** Durée de vie de l'URL signée : l'usage constaté est un affichage immédiat. */
const SIGNED_URL_TTL_SECONDS = 120;

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

  // Une URL signée contourne toute autorisation ultérieure : le contrôle doit
  // avoir lieu AVANT de l'émettre.
  if (!(await canReadStorageKey(user, key))) {
    return NextResponse.json({ error: "Accès refusé" }, { status: 403 });
  }

  try {
    // Même disposition que la lecture en flux : pièce jointe hors liste blanche.
    const access = await getMediaByStorageKey(key);
    const row = access ? await getMediaFull(access.id) : null;
    // H9 : type et disposition recomposes cote serveur, y compris pour une cle
    // sans ligne media (SVG deja stocke avec un type declare par son deposant).
    const filename = row?.filename ?? key.split("/").pop() ?? "file";
    const served = serveContentType(row?.mimeType ?? "", filename);
    const url = await getFileUrl(key, SIGNED_URL_TTL_SECONDS, {
      contentDisposition: buildContentDisposition(filename, served.disposition === "inline"),
      contentType: served.contentType,
    });
    return NextResponse.json({ url });
  } catch {
    return NextResponse.json({ error: "Fichier introuvable" }, { status: 404 });
  }
}
