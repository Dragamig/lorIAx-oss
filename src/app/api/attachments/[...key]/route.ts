import { NextRequest, NextResponse } from "next/server";
import { GetObjectCommand } from "@aws-sdk/client-s3";
import { getSessionUser } from "@/lib/auth/get-user";
import { s3Client, BUCKET } from "@/lib/storage/s3";
import { canReadStorageKey } from "@/lib/storage/attachment-access";
import { getMediaByStorageKey, getMediaFull } from "@/lib/media/access";
import { serveMediaObject } from "@/lib/media/serve";
import { buildContentDisposition } from "@/lib/media/content-disposition";
import { serveContentType } from "@/lib/storage/serve-content-type";

export async function GET(
  req: NextRequest,
  { params }: { params: Promise<{ key: string[] }> }
) {
  const user = await getSessionUser();
  if (!user) {
    return NextResponse.json({ error: "Non autorisé" }, { status: 401 });
  }

  const { key: segments } = await params;
  const key = segments.join("/");

  // Sans ce contrôle, la route sert n'importe quel objet du bucket à n'importe
  // quel utilisateur authentifié, toutes organisations confondues.
  if (!(await canReadStorageKey(user, key))) {
    return NextResponse.json({ error: "Accès refusé" }, { status: 403 });
  }

  // Alias permanent : une clé qui a une ligne media passe par le pipeline de
  // lecture en flux (Range, ETag). Inline seulement pour la liste blanche.
  const access = await getMediaByStorageKey(key);
  const row = access ? await getMediaFull(access.id) : null;
  if (row) {
    return serveMediaObject({
      req,
      key: row.storageKey,
      mime: row.mimeType,
      filename: row.filename,
      etagSeed: `${row.id}-${row.updatedAt.getTime()}`,
      inline: true,
      maxAgeSeconds: 300,
    });
  }

  // Clés sans ligne media (avatars, branding, video-editor/, repli UUID d'espace).
  try {
    const command = new GetObjectCommand({ Bucket: BUCKET, Key: key });
    const response = await s3Client.send(command);

    if (!response.Body) {
      return NextResponse.json({ error: "Fichier introuvable" }, { status: 404 });
    }

    const buffer = Buffer.from(await response.Body.transformToByteArray());
    const filename = segments[segments.length - 1] ?? "file";
    // H9 : type recompose cote serveur, jamais repris de l'objet stocke.
    const served = serveContentType(response.ContentType ?? "", filename);
    return new NextResponse(buffer, {
      status: 200,
      headers: {
        "Content-Type": served.contentType,
        "X-Content-Type-Options": "nosniff",
        "Cache-Control": "private, max-age=300",
        "Content-Disposition": buildContentDisposition(filename, false),
      },
    });
  } catch (err: unknown) {
    const code = (err as { name?: string }).name;
    if (code === "NoSuchKey") {
      return NextResponse.json({ error: "Fichier introuvable" }, { status: 404 });
    }
    return NextResponse.json({ error: "Erreur serveur" }, { status: 500 });
  }
}
