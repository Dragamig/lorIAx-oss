import { NextResponse } from "next/server";
import { isValidInternalBearer } from "@/lib/security/secure-compare";
import { runMediaPurgeJob } from "@/lib/media/purge-job";

/**
 * POST /api/cron/media-purge
 * Purge de la corbeille médias puis notifications J-7 (appelé par cron).
 * Protégé par CRON_SECRET, fail-closed ; passe par runMediaPurgeJob (garde `running`, coupe-circuit MEDIA_PURGE_DISABLED).
 */
export async function POST(request: Request) {
  if (!isValidInternalBearer(request.headers.get("authorization"), process.env.CRON_SECRET)) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }
  const result = await runMediaPurgeJob();
  if (result.status === "failed") {
    return NextResponse.json({ error: "Purge échouée" }, { status: 500 });
  }
  if (result.status === "skipped") {
    return NextResponse.json({ skipped: result.skipped });
  }
  const { status: _status, ...run } = result;
  return NextResponse.json(run);
}
