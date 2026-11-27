/**
 * Réessai d'un mail en échec depuis le fil Activité. Le mail repasse `scheduled`,
 * échu immédiatement : le tick de file le reprend. `messageId` est conservé (pas de
 * doublon côté destinataire). `delivery_unknown` est refusé : le mail a pu partir.
 * Le quota est consommé à la programmation (checkMailQuota) ; l'envoi ne fait que
 * le lire (peekMailQuota). Le réessai suit donc l'envoi : lecture seule, sans
 * double comptage.
 */
import { and, eq, sql } from "drizzle-orm";
import { db } from "@/lib/db";
import { mailMessages } from "@/lib/db/schema-mailing";
import { peekMailQuota } from "./quota";

export type RetryResult =
  | { ok: true }
  | { ok: false; reason: "not_found" | "not_failed" | "delivery_unknown" | "no_account" }
  | { ok: false; reason: "quota"; code: "quota_plan" | "quota_abuse"; limit: number | null };

export async function retryFailed(orgId: string, userId: string, id: string): Promise<RetryResult> {
  const [message] = await db
    .select({
      id: mailMessages.id,
      status: mailMessages.status,
      lastError: mailMessages.lastError,
      accountId: mailMessages.accountId,
    })
    .from(mailMessages)
    .where(
      and(
        eq(mailMessages.id, id),
        eq(mailMessages.organizationId, orgId),
        eq(mailMessages.userId, userId),
        eq(mailMessages.direction, "out"),
      ),
    )
    .limit(1);
  if (!message) return { ok: false, reason: "not_found" };
  if (message.status !== "failed") return { ok: false, reason: "not_failed" };
  if (message.lastError === "delivery_unknown") return { ok: false, reason: "delivery_unknown" };
  if (!message.accountId) return { ok: false, reason: "no_account" };
  const quota = await peekMailQuota(orgId, userId);
  // Sans plafond d'offre (limit null), seul le garde-fou anti-abus a pu se déclencher.
  if (quota.exceeded) {
    return { ok: false, reason: "quota", code: quota.limit === null ? "quota_abuse" : "quota_plan", limit: quota.limit };
  }

  const rows = await db
    .update(mailMessages)
    .set({ status: "scheduled", scheduledAt: sql`now()`, lastError: null, attempts: 0, updatedAt: sql`now()` })
    .where(
      and(
        eq(mailMessages.id, id),
        eq(mailMessages.organizationId, orgId),
        eq(mailMessages.userId, userId),
        eq(mailMessages.status, "failed"),
        eq(mailMessages.direction, "out"),
      ),
    )
    .returning({ id: mailMessages.id });
  return rows.length === 0 ? { ok: false, reason: "not_failed" } : { ok: true };
}
