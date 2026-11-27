import { NextResponse } from "next/server";
import { getSessionUser } from "@/lib/auth/get-user";
import {
  MULTIPART_MAX_BYTES,
  MULTIPART_PART_SIZE,
  multipartEnabled,
} from "@/lib/media/multipart";
import { VIDEO_MAX_UPLOAD_BYTES } from "@/lib/media/upload-limits";
import { NO_STORE, jsonError } from "@/lib/media/multipart-http";

export const dynamic = "force-dynamic";

export async function GET() {
  const user = await getSessionUser();
  if (!user) return jsonError("Non authentifié", 401);
  return NextResponse.json(
    {
      enabled: multipartEnabled(),
      thresholdBytes: VIDEO_MAX_UPLOAD_BYTES,
      partSize: MULTIPART_PART_SIZE,
      maxBytes: MULTIPART_MAX_BYTES,
    },
    { headers: NO_STORE },
  );
}
