import { NextResponse } from "next/server";
import { isValidInternalBearer } from "@/lib/security/secure-compare";
import { runMediaIndexJob } from "@/lib/media/ai/index-job";

/**
 * POST /api/cron/media-index
 * Traite la file d'indexation IA des médias (appelé par cron).
 * Protégé par CRON_SECRET, fail-closed ; passe par runMediaIndexJob (non réentrant, coupe-circuit MEDIA_INDEX_DISABLED).
 */
export async function POST(request: Request) {
  if (!isValidInternalBearer(request.headers.get("authorization"), process.env.CRON_SECRET)) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }
  const result = await runMediaIndexJob();
  if (result.status === "skipped") return NextResponse.json({ skipped: result.skipped });
  const { status: _status, ...run } = result;
  return NextResponse.json(run);
}
