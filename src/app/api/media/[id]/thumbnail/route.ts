import { NextResponse } from "next/server";
import { serveMediaObject } from "@/lib/media/serve";
import { guardMediaRead } from "@/lib/media/route-guard";
import { thumbnailEtagSeed } from "@/lib/media/etag";

export async function GET(req: Request, { params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const g = await guardMediaRead(id);
  if (!g.ok) return g.res;
  const { row } = g;
  if (!row.thumbnailKey) {
    return NextResponse.json({ error: "Pas de miniature" }, { status: 404 });
  }
  return serveMediaObject({
    req,
    key: row.thumbnailKey,
    mime: "image/webp",
    filename: `${row.id}.webp`,
    etagSeed: thumbnailEtagSeed(row),
    inline: true,
    maxAgeSeconds: 0,
    revalidate: true,
  });
}
