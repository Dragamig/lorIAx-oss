import { serveMediaObject } from "@/lib/media/serve";
import { guardMediaRead } from "@/lib/media/route-guard";
import { contentEtagSeed } from "@/lib/media/etag";

async function serve(req: Request, { params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const g = await guardMediaRead(id);
  if (!g.ok) return g.res;
  const { row } = g;
  // ?download=1 : téléchargement forcé. Le cadrage (frame-policy) ne dépend que du chemin.
  const download = new URL(req.url).searchParams.get("download") === "1";
  return serveMediaObject({
    req,
    key: row.storageKey,
    mime: row.mimeType,
    filename: row.filename,
    etagSeed: contentEtagSeed(row),
    inline: !download,
    maxAgeSeconds: 0,
    revalidate: true,
    renderSvg: true,
  });
}

/** GET : contenu. HEAD : mêmes contrôles d'accès et mêmes en-têtes, sans lecture de l'objet. */
export const GET = serve;
export const HEAD = serve;
