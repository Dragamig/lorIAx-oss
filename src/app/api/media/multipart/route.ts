import { NextRequest, NextResponse } from "next/server";
import { z } from "zod";
import { UUID_RE } from "@/lib/media/folders-http";
import { openMultipart } from "@/lib/media/multipart";
import { RATE_LIMITS } from "@/lib/rate-limit";
import { NO_STORE, authContext, jsonError, limited, readBody } from "@/lib/media/multipart-http";

export const dynamic = "force-dynamic";

const bodySchema = z
  .object({
    spaceId: z.string().regex(UUID_RE).nullable().optional(),
    folderId: z.string().regex(UUID_RE).nullable().optional(),
    name: z.string().min(1).max(255),
    size: z.number().int().positive(),
    type: z.string().min(1).max(100),
    tags: z.array(z.string().max(500)).max(100).optional(),
  })
  .strict();

export async function POST(req: NextRequest) {
  const ctx = await authContext();
  if (ctx instanceof NextResponse) return ctx;
  const { user, orgId } = ctx;

  const blocked = await limited("media-multipart-open", user.id, RATE_LIMITS.mediaMultipartOpen);
  if (blocked) return blocked;

  const raw = await readBody(req);
  const parsed = raw ? bodySchema.safeParse(raw) : null;
  if (!parsed?.success) return jsonError("Requête invalide", 400);
  const { name, size, type } = parsed.data;

  const result = await openMultipart(user, orgId, {
    spaceId: parsed.data.spaceId ?? null,
    folderId: parsed.data.folderId ?? null,
    name,
    size,
    type,
    tags: parsed.data.tags,
  });
  if (!result.ok) return jsonError(result.error, result.status);
  return NextResponse.json(
    { uploadId: result.uploadId, partSize: result.partSize, partCount: result.partCount },
    { status: 201, headers: NO_STORE },
  );
}
