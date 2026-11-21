import { NextResponse } from "next/server";
import { db } from "@/lib/db";
import { userDatabaseAutomationRuns, userDatabaseAutomations } from "@/lib/db/schema";
import { eq, and } from "drizzle-orm";
import { requireOrgScoped, OrgScopeError } from "@/lib/auth/require-org-scoped";
import { getFileUrl } from "@/lib/storage/s3";

type RouteParams = {
  params: Promise<{ databaseId: string; automationId: string; runId: string }>;
};

/**
 * Téléchargement du document généré par un run d'action IA (C4).
 *
 * La clé S3 durable est stockée dans le payload du run (`aiResult.documentKey`).
 * On re-signe une URL à la volée (15 min) et on redirige — les URLs signées
 * expirant, on ne peut pas se contenter de celle générée à l'exécution.
 */
export async function GET(_request: Request, { params }: RouteParams) {
  const { databaseId, automationId, runId } = await params;

  try {
    await requireOrgScoped({
      resource: { type: "database", id: databaseId },
      minPermission: "editor",
    });
  } catch (e) {
    if (e instanceof OrgScopeError) return e.response;
    throw e;
  }

  // Le run doit appartenir à une automation de cette database (siloing).
  const [run] = await db
    .select({ payload: userDatabaseAutomationRuns.payload })
    .from(userDatabaseAutomationRuns)
    .innerJoin(
      userDatabaseAutomations,
      eq(userDatabaseAutomations.id, userDatabaseAutomationRuns.automationId)
    )
    .where(
      and(
        eq(userDatabaseAutomationRuns.id, runId),
        eq(userDatabaseAutomationRuns.automationId, automationId),
        eq(userDatabaseAutomations.databaseId, databaseId)
      )
    )
    .limit(1);

  if (!run) {
    return NextResponse.json({ error: "Introuvable" }, { status: 404 });
  }

  const aiResult = (run.payload as { aiResult?: { documentKey?: string } } | null)?.aiResult;
  const key = aiResult?.documentKey;
  if (!key) {
    return NextResponse.json({ error: "Aucun document pour ce run" }, { status: 404 });
  }

  const url = await getFileUrl(key, 900);
  return NextResponse.redirect(url);
}
