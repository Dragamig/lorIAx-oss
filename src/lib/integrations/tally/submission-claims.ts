/**
 * Réservation atomique d'une réponse Tally par automatisme : la clé
 * (automation_id, submission_id) est insérée AVANT l'exécution, de sorte
 * qu'un import et un webhook concurrents ne rejouent jamais la même réponse.
 */
import { and, eq, sql } from "drizzle-orm";
import { db } from "@/lib/db";
import { tallyImportedSubmissions } from "@/lib/db/schema";

/** Une réservation plus ancienne est considérée abandonnée (processus mort) et reprenable. */
export const CLAIM_STALE_MS = 10 * 60_000;

/** Identifiant de réponse d'un corps de webhook de forme Tally, sinon null. */
export function tallyResponseIdFromBody(body: unknown): string | null {
  if (!body || typeof body !== "object") return null;
  const b = body as { eventType?: unknown; data?: { responseId?: unknown } };
  if (b.eventType !== "FORM_RESPONSE") return null;
  const id = b.data?.responseId;
  return typeof id === "string" && id.length > 0 && id.length <= 128 ? id : null;
}

/** true = réservée par cet appel ; false = déjà traitée ou en cours de traitement ailleurs. */
export async function reserveSubmission(
  automationId: string,
  submissionId: string,
  importId: string | null
): Promise<boolean> {
  const rows = await db
    .insert(tallyImportedSubmissions)
    .values({ automationId, submissionId, importId, state: "reserved" })
    .onConflictDoUpdate({
      target: [tallyImportedSubmissions.automationId, tallyImportedSubmissions.submissionId],
      set: { state: "reserved", importId, importedAt: new Date() },
      setWhere: sql`${tallyImportedSubmissions.state} = 'reserved' and ${tallyImportedSubmissions.importedAt} < ${new Date(Date.now() - CLAIM_STALE_MS)}`,
    })
    .returning({ id: tallyImportedSubmissions.submissionId });
  return rows.length > 0;
}

export async function markSubmissionDone(automationId: string, submissionId: string): Promise<void> {
  await db
    .update(tallyImportedSubmissions)
    .set({ state: "done" })
    .where(
      and(
        eq(tallyImportedSubmissions.automationId, automationId),
        eq(tallyImportedSubmissions.submissionId, submissionId)
      )
    );
}

/** Libère la réservation après un échec : la réponse pourra être rejouée. */
export async function releaseSubmission(automationId: string, submissionId: string): Promise<void> {
  await db
    .delete(tallyImportedSubmissions)
    .where(
      and(
        eq(tallyImportedSubmissions.automationId, automationId),
        eq(tallyImportedSubmissions.submissionId, submissionId),
        eq(tallyImportedSubmissions.state, "reserved")
      )
    );
}
