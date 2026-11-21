import { NextResponse } from "next/server";
import { getFileUrl } from "@/lib/storage/s3";
import { serveContentType } from "@/lib/storage/serve-content-type";
import { buildContentDisposition } from "@/lib/media/content-disposition";
import { guardMediaRead } from "@/lib/media/route-guard";

const SIGNED_URL_TTL_SECONDS = 120;

export async function GET(_req: Request, { params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  // L'URL signée contourne tout contrôle ultérieur : accès vérifié avant émission.
  const g = await guardMediaRead(id);
  if (!g.ok) return g.res;
  try {
    const served = serveContentType(g.row.mimeType, g.row.filename);
    const url = await getFileUrl(g.row.storageKey, SIGNED_URL_TTL_SECONDS, {
      contentDisposition: buildContentDisposition(g.row.filename, served.disposition === "inline"),
      contentType: served.contentType,
    });
    return NextResponse.json({ url });
  } catch {
    return NextResponse.json({ error: "Fichier introuvable" }, { status: 404 });
  }
}
