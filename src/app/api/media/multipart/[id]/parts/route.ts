import { NextRequest, NextResponse } from "next/server";
import { z } from "zod";
import { MULTIPART_MAX_SIGN_PARTS, signParts } from "@/lib/media/multipart";
import { RATE_LIMITS } from "@/lib/rate-limit";
import {
  NO_STORE,
  authContext,
  inputErrorResponse,
  isUploadId,
  jsonError,
  limited,
  notFound,
  readBody,
} from "@/lib/media/multipart-http";

export const dynamic = "force-dynamic";

const bodySchema = z
  .object({ partNumbers: z.array(z.number().int().min(1).max(10_000)).min(1).max(MULTIPART_MAX_SIGN_PARTS) })
  .strict();

export async function POST(req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const ctx = await authContext();
  if (ctx instanceof NextResponse) return ctx;
  const { id } = await params;
  if (!isUploadId(id)) return notFound();

  const blocked = await limited("media-multipart-sign", ctx.user.id, RATE_LIMITS.mediaMultipartSign);
  if (blocked) return blocked;

  const raw = await readBody(req);
  const parsed = raw ? bodySchema.safeParse(raw) : null;
  if (!parsed?.success) return jsonError("Numéros de parts invalides", 400);

  try {
    const urls = await signParts(ctx.user, ctx.orgId, id, parsed.data.partNumbers);
    if (!urls) return notFound();
    return NextResponse.json({ parts: urls }, { headers: NO_STORE });
  } catch (e) {
    return inputErrorResponse(e);
  }
}
