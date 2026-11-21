import { NextResponse } from "next/server";
import { isValidInternalBearer } from "@/lib/security/secure-compare";
import { executeKbIndex } from "@/lib/kb/kb-scheduler";
import logger from "@/lib/logger";

/**
 * POST /api/cron/kb-index
 * (Ré)indexe la base de connaissances depuis le disque (appelé par cron).
 * Protégé par un secret partagé pour empêcher tout accès non autorisé.
 */
export async function POST(request: Request) {
  const authHeader = request.headers.get("authorization");
  const cronSecret = process.env.CRON_SECRET;

  // Fail-closed : sans CRON_SECRET configuré, la route refuse tout appel.
  if (!isValidInternalBearer(authHeader, cronSecret)) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  try {
    const { summary, verdict } = await executeKbIndex();

    // Une indexation qui n'écrit rien ne doit pas se rendre en succès. Sans ce
    // verdict, un travail planifié voyait un 200 alors que tous les fragments
    // avaient échoué, et la base de connaissances restait périmée sans que
    // personne ne le sache. C'est la cause racine que le rapport d'audit du
    // 2026-08-19 nomme : un défaut de configuration qui ne se voit jamais.
    if (!verdict.ok) {
      logger.error({ ...summary, reason: verdict.reason }, "Indexation KB (cron) en échec");
      return NextResponse.json(
        { ...summary, error: verdict.reason },
        { status: 500 }
      );
    }

    return NextResponse.json({ ...summary, reason: verdict.reason });
  } catch (error) {
    logger.error({ err: error }, "Erreur indexation KB (cron)");
    return NextResponse.json(
      { error: "Indexation KB échouée" },
      { status: 500 }
    );
  }
}
