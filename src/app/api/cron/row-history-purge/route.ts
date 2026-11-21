import { NextResponse } from "next/server";
import { isValidInternalBearer } from "@/lib/security/secure-compare";
import { purgeDeletedRowHistory } from "@/lib/databases/row-history-purge";
import logger from "@/lib/logger";

/**
 * POST /api/cron/row-history-purge
 * Purge à 30 jours de l'historique des lignes supprimées. Protégé par CRON_SECRET.
 */
export async function POST(request: Request) {
  // Fail-closed : sans CRON_SECRET configuré, la route refuse tout appel.
  if (!isValidInternalBearer(request.headers.get("authorization"), process.env.CRON_SECRET)) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }
  try {
    return NextResponse.json(await purgeDeletedRowHistory());
  } catch (error) {
    logger.error({ err: error }, "Erreur purge historique des lignes (cron)");
    return NextResponse.json({ error: "Purge échouée" }, { status: 500 });
  }
}
