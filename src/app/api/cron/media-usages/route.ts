import { NextResponse } from "next/server";
import { isValidInternalBearer } from "@/lib/security/secure-compare";
import { runMediaUsageSweep } from "@/lib/media/usage-sweep";
import logger from "@/lib/logger";

/**
 * POST /api/cron/media-usages
 * Balayage différé des usages médias (appelé par cron). Protégé par CRON_SECRET.
 */
export async function POST(request: Request) {
  // Fail-closed : sans CRON_SECRET configuré, la route refuse tout appel.
  if (!isValidInternalBearer(request.headers.get("authorization"), process.env.CRON_SECRET)) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }
  try {
    return NextResponse.json(await runMediaUsageSweep());
  } catch (error) {
    logger.error({ err: error }, "Erreur balayage usages médias (cron)");
    return NextResponse.json({ error: "Balayage échoué" }, { status: 500 });
  }
}
