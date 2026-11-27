import { NextResponse } from "next/server";
import { resolvePublicMediaAccess } from "@/lib/media/access";
import { serveMediaObject } from "@/lib/media/serve";
import { contentEtagSeed } from "@/lib/media/etag";

const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

/** Lecture publique d'un média intégré dans un document partagé. 404 uniforme pour tout refus. */
export async function GET(
  req: Request,
  { params }: { params: Promise<{ token: string; id: string }> }
) {
  const { token, id } = await params;
  const notFound = () => NextResponse.json({ error: "Média introuvable" }, { status: 404 });
  if (!token || !UUID_RE.test(id)) return notFound();

  const verdict = await resolvePublicMediaAccess(token, id);
  if (!verdict.allowed) return notFound();

  const { row } = verdict;
  return serveMediaObject({
    req,
    key: row.storageKey,
    mime: row.mimeType,
    filename: row.filename,
    etagSeed: contentEtagSeed(row),
    inline: true,
    maxAgeSeconds: 0,
    revalidate: true,
    cacheScope: "public",
    renderSvg: true,
  });
}
