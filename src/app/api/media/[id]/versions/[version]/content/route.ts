import { NextResponse } from "next/server";
import { serveMediaObject } from "@/lib/media/serve";
import { guardMediaRead } from "@/lib/media/route-guard";
import { listVersions } from "@/lib/media/versions";
import { versionEtagSeed } from "@/lib/media/etag";
import { parseVersionParam } from "@/lib/media/versions-http";

async function serve(req: Request, { params }: { params: Promise<{ id: string; version: string }> }) {
  const { id, version } = await params;
  const g = await guardMediaRead(id);
  if (!g.ok) return g.res;
  const n = parseVersionParam(version);
  const found = n === null ? undefined : (await listVersions(id, g.row.organizationId)).find((v) => v.version === n);
  if (!found) return NextResponse.json({ error: "Version introuvable" }, { status: 404 });
  const download = new URL(req.url).searchParams.get("download") === "1";
  return serveMediaObject({
    req,
    key: found.storageKey,
    mime: found.mimeType,
    filename: found.filename,
    etagSeed: versionEtagSeed(id, found),
    inline: !download,
    // Le contenu d'une URL peut changer (réécriture, rétention) : ETag + revalidation.
    maxAgeSeconds: 0,
    revalidate: true,
    renderSvg: true,
  });
}

export const GET = serve;
export const HEAD = serve;
