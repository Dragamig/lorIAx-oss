/**
 * Tick de rattrapage des mails (minute, branché sur le croner des automatisations).
 * 1. Mails `scheduled` échus dont la minuterie mémoire a été perdue (redémarrage) : remise.
 * 2. Mails `sending` bloqués : JAMAIS renvoyés (au plus une fois). Après 5 min ils passent en
 *    `failed` / `delivery_unknown` ; l'interface renvoie au dossier Envoyés.
 * 3. Réconciliation : mails `sent` sans Interaction, trace rejouée (10 essais au plus).
 */
import { and, eq, isNull, sql } from "drizzle-orm";
import { db } from "@/lib/db";
import { crmConnections } from "@/lib/db/schema";
import { mailMessages, type MailMessageRow } from "@/lib/db/schema-mailing";
import logger from "@/lib/logger";
import { arm, claimDue, deliver, touchSending } from "./outbox";
import { CrmDisconnectedError, CrmTraceForbiddenError, ensureDossierForMail, writeMailInteraction } from "./crm-trace";

export const SENDING_STUCK_MS = 5 * 60_000;
export const TRACE_MIN_AGE_MS = 60_000;
export const TRACE_MAX_ATTEMPTS = 10;
const DELIVER_BATCH = 5;
const TRACE_BATCH = 20;

function errMessage(err: unknown): string {
  return String((err as { message?: string } | null)?.message ?? err).split("\n")[0].slice(0, 500);
}

async function failStuckSending(now: Date): Promise<number> {
  const rows = await db
    .update(mailMessages)
    .set({ status: "failed", lastError: "delivery_unknown", updatedAt: new Date() })
    .where(
      and(
        eq(mailMessages.status, "sending"),
        eq(mailMessages.direction, "out"),
        sql`${mailMessages.updatedAt} < ${new Date(now.getTime() - SENDING_STUCK_MS)}`,
      ),
    )
    .returning({ id: mailMessages.id });
  if (rows.length) logger.error({ count: rows.length }, "[mailing] sending mails stuck, marked delivery_unknown");
  return rows.length;
}

/** Vrai tant qu'un deliverDue tourne : un tick qui a dépassé son délai n'est pas doublé par le suivant. */
let delivering = false;

export async function deliverDue(): Promise<number> {
  if (delivering) return 0;
  delivering = true;
  try {
    return await deliverBatch();
  } finally {
    delivering = false;
  }
}

async function deliverBatch(): Promise<number> {
  let delivered = 0;
  // Un mail par itération : un serveur lent ne bloque pas un lot entier, toutes organisations.
  for (let i = 0; i < DELIVER_BATCH; i++) {
    const [message] = await claimDue(1);
    if (!message) break;
    try {
      if (!(await touchSending(message))) continue;
      await deliver(message);
      const [after] = await db
        .select({ status: mailMessages.status })
        .from(mailMessages)
        .where(and(eq(mailMessages.id, message.id), eq(mailMessages.organizationId, message.organizationId)))
        .limit(1);
      if (after?.status === "sent") delivered++;
    } catch (err) {
      logger.error({ err, messageRowId: message.id }, "[mailing] tick deliver crashed");
      await db
        .update(mailMessages)
        .set({ status: "failed", lastError: errMessage(err), updatedAt: new Date() })
        .where(
          and(
            eq(mailMessages.id, message.id),
            eq(mailMessages.organizationId, message.organizationId),
            eq(mailMessages.status, "sending"),
          ),
        )
        .catch(() => {});
    }
  }
  return delivered;
}

/** Prise atomique des mails à réconcilier : l'essai est compté avant d'être tenté. */
async function claimForTrace(now: Date, limit: number): Promise<{ message: MailMessageRow; attempt: number }[]> {
  const due = db
    .select({ id: mailMessages.id })
    .from(mailMessages)
    .where(
      and(
        eq(mailMessages.status, "sent"),
        eq(mailMessages.direction, "out"),
        isNull(mailMessages.interactionRowId),
        sql`${mailMessages.contactRowId} IS NOT NULL`,
        sql`${mailMessages.updatedAt} < ${new Date(now.getTime() - TRACE_MIN_AGE_MS)}`,
        sql`${mailMessages.traceAttempts} < ${TRACE_MAX_ATTEMPTS}`,
        sql`${mailMessages.lastError} IS DISTINCT FROM 'trace'`,
      ),
    )
    .orderBy(mailMessages.updatedAt)
    .limit(limit)
    .for("update", { skipLocked: true });
  const rows = await db
    .update(mailMessages)
    .set({ traceAttempts: sql`${mailMessages.traceAttempts} + 1`, updatedAt: new Date() })
    .where(and(eq(mailMessages.status, "sent"), sql`${mailMessages.id} IN (${due})`))
    .returning();
  return rows.map((message) => ({
    message,
    attempt: message.traceAttempts,
  }));
}

export async function reconcileTraces(limit = TRACE_BATCH, now = new Date()): Promise<number> {
  const claimed = await claimForTrace(now, limit);
  let reconciled = 0;
  for (const { message, attempt } of claimed) {
    try {
      const { dossierRowId } = await ensureDossierForMail(
        { orgId: message.organizationId, userId: message.userId },
        { contactRowId: message.contactRowId!, dossierRowId: message.dossierRowId },
      );
      let traced = message;
      if (dossierRowId !== message.dossierRowId) {
        await db
          .update(mailMessages)
          .set({ dossierRowId, updatedAt: new Date() })
          .where(and(eq(mailMessages.id, message.id), eq(mailMessages.organizationId, message.organizationId)));
        traced = { ...message, dossierRowId };
      }
      await writeMailInteraction(traced);
      reconciled++;
    } catch (err) {
      logger.warn({ err, messageRowId: message.id, attempt }, "[mailing] trace reconciliation failed");
      if (err instanceof CrmDisconnectedError) {
        // CRM non raccordé : ce n'est pas un essai de trace, une panne de raccordement n'abandonne rien.
        await db
          .update(mailMessages)
          .set({ traceAttempts: sql`GREATEST(${mailMessages.traceAttempts} - 1, 0)` })
          .where(and(eq(mailMessages.id, message.id), eq(mailMessages.organizationId, message.organizationId)))
          .catch(() => {});
      } else if (err instanceof CrmTraceForbiddenError) {
        // Expéditeur sans droit d'écriture : trace abandonnée d'emblée, jamais rejouée.
        logger.warn({ messageRowId: message.id }, "[mailing] trace abandoned: sender lacks CRM edit right");
        await db
          .update(mailMessages)
          .set({ lastError: "trace", updatedAt: new Date() })
          .where(and(eq(mailMessages.id, message.id), eq(mailMessages.organizationId, message.organizationId)))
          .catch(() => {});
      } else if (attempt >= TRACE_MAX_ATTEMPTS) {
        logger.error({ messageRowId: message.id }, "[mailing] trace abandoned after 10 attempts");
        await db
          .update(mailMessages)
          .set({ lastError: "trace", updatedAt: new Date() })
          .where(and(eq(mailMessages.id, message.id), eq(mailMessages.organizationId, message.organizationId)))
          .catch(() => {});
      }
    }
  }
  return reconciled;
}

export async function mailingTick(now: Date = new Date()): Promise<{ delivered: number; reconciled: number }> {
  await failStuckSending(now);
  const delivered = await deliverDue();
  const reconciled = await reconcileTraces(TRACE_BATCH, now);
  return { delivered, reconciled };
}

/** Au démarrage : réarme les minuteries des mails `scheduled` futurs (les échus passent par le tick). */
export async function armTimers(): Promise<void> {
  const rows = await db
    .select({ id: mailMessages.id, delayMs: sql<number>`GREATEST(0, (EXTRACT(EPOCH FROM (${mailMessages.scheduledAt} - now())) * 1000))::float8` })
    .from(mailMessages)
    .where(
      and(
        eq(mailMessages.status, "scheduled"),
        eq(mailMessages.direction, "out"),
        sql`${mailMessages.scheduledAt} > now()`,
      ),
    )
    .limit(1000);
  for (const r of rows) arm(r.id, Number(r.delayMs));
}

/** Alimente l'alerte de l'onglet Mails : traces en attente ou abandonnées, CRM non raccordé. */
export async function getTraceAlert(orgId: string, userId: string): Promise<{ pending: number; crmDisconnected: boolean }> {
  const [count] = await db
    .select({ n: sql<number>`count(*)::int` })
    .from(mailMessages)
    .where(
      and(
        eq(mailMessages.organizationId, orgId),
        eq(mailMessages.userId, userId),
        eq(mailMessages.status, "sent"),
        eq(mailMessages.direction, "out"),
        isNull(mailMessages.interactionRowId),
        sql`${mailMessages.contactRowId} IS NOT NULL`,
      ),
    );
  const [conn] = await db
    .select({ interactionsDatabaseId: crmConnections.interactionsDatabaseId })
    .from(crmConnections)
    .where(eq(crmConnections.organizationId, orgId))
    .limit(1);
  return { pending: count?.n ?? 0, crmDisconnected: !conn?.interactionsDatabaseId };
}
