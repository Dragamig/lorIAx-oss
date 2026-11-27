import { NextRequest, NextResponse } from "next/server";
import { z } from "zod";
import { MULTIPART_NOT_FOUND, completeMultipart } from "@/lib/media/multipart";
import { getMediaDetail } from "@/lib/media/metadata";
import { NO_STORE, authContext, isUploadId, jsonError, notFound, readBody } from "@/lib/media/multipart-http";

export const dynamic = "force-dynamic";

const bodySchema = z
  .object({
    parts: z
      .array(z.object({ partNumber: z.number().int().min(1).max(10_000), etag: z.string().min(1).max(200) }).strict())
      .min(1)
      .max(10_000),
  })
  .strict();

export async function POST(req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const ctx = await authContext();
  if (ctx instanceof NextResponse) return ctx;
  const { id } = await params;
  if (!isUploadId(id)) return notFound();

  const raw = await readBody(req);
  const parsed = raw ? bodySchema.safeParse(raw) : null;
  if (!parsed?.success) return jsonError("Parts invalides", 400);

  const result = await completeMultipart(ctx.user, ctx.orgId, id, parsed.data.parts);
  if (!result.ok) {
    if (result.error === MULTIPART_NOT_FOUND) return notFound();
    return NextResponse.json(
      { error: result.error, ...(result.quota ? { quota: result.quota } : {}) },
      { status: result.status, headers: NO_STORE },
    );
  }
  const detail = await getMediaDetail(ctx.user, ctx.orgId, result.media.id);
  if (!detail) return notFound();
  return NextResponse.json({ media: detail }, { status: 200, headers: NO_STORE });
}
