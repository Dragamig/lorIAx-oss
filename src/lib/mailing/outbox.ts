/**
 * Envoi différé des mails : programmation (avec délai d'annulation), annulation, prise atomique
 * des mails échus et remise SMTP. Exactement une fois : `claimDue` fait passer `scheduled` en
 * `sending` par un UPDATE ... RETURNING atomique. La minuterie mémoire n'est qu'un déclencheur ;
 * le rattrapage (redémarrage, minuterie perdue) revient au tick de T11.
 */
import { SEND_TIMEOUT_MS } from "./timeouts";
import { randomUUID } from "node:crypto";
import MailComposer from "nodemailer/lib/mail-composer";
import { and, eq, inArray, lte, or, sql } from "drizzle-orm";
import { db } from "@/lib/db";
import { mailAccounts, mailMessages, type MailAccountRow, type MailMessageRow } from "@/lib/db/schema-mailing";
import { auditLog } from "@/lib/audit/log";
import logger from "@/lib/logger";
import { getAccountFor } from "./accounts";
import { resolveAttachments } from "./attachments";
import { buildMimeOptions, computeThreadKey, htmlToText, type ComposeInput } from "./compose";
import { ensureDossierForMail, resolveFicheContext, writeMailInteraction, type FicheContext } from "./crm-trace";
import { checkMailQuota, peekMailQuota } from "./quota";
import { appendToSent, getTransport } from "./transport";

export type MailErrorCode = "no_account" | "account_unverified" | "account_error" | "quota" | "fiche_forbidden" | "dossier_mismatch" | "invalid_header";

export class MailError extends Error {
  constructor(
    public readonly code: MailErrorCode,
    message: string = code,
    public readonly detail?: { reason?: "plan" | "abuse"; limit?: number; statusMessage?: string },
  ) {
    super(message);
    this.name = "MailError";
  }
}

export const RETRY_DELAY_MS = 60_000;
export { SEND_TIMEOUT_MS };
const CLAIM_BATCH = 5;

const timers = new Map<string, ReturnType<typeof setTimeout>>();

export function arm(id: string, delayMs: number): void {
  clearTimer(id);
  const t = setTimeout(() => {
    timers.delete(id);
    void processDue().catch((err) => logger.error({ err }, "[mailing] processDue failed"));
  }, Math.max(0, delayMs));
  t.unref?.();
  timers.set(id, t);
}

function clearTimer(id: string): void {
  const t = timers.get(id);
  if (t) clearTimeout(t);
  timers.delete(id);
}

/** CR et LF dans une valeur d'en-tête permettraient d'injecter des en-têtes. */
export function assertHeaderSafe(name: string, value: string | null | undefined): void {
  if (value && /[\r\n]/.test(value)) throw new MailError("invalid_header", `${name} contient un saut de ligne`);
}

function toError(err: unknown): string {
  return String((err as { message?: string } | null)?.message ?? err).split("\n")[0].slice(0, 500);
}

export interface ScheduleInput {
  orgId: string;
  userId: string;
  compose: ComposeInput;
  /** Indicatif : la fiche est relue et vérifiée côté serveur, jamais crue sur parole. */
  ctx: FicheContext;
}

export async function scheduleMail(input: ScheduleInput): Promise<{
  messageId: string;
  rowId: string;
  scheduledAt: Date;
  cancelDelaySeconds: number;
}> {
  const { orgId, userId, compose } = input;
  const account = await getAccountFor(orgId, userId);
  if (!account) throw new MailError("no_account", "Aucune boîte mail configurée");
  // Une boîte jamais testée (ou dont le dernier test a échoué) n'envoie rien : l'échec SMTP arriverait après coup.
  if (account.status === "error") {
    throw new MailError("account_error", "Dernier test de la boîte mail en échec", {
      statusMessage: (account.statusMessage ?? "").slice(0, 300),
    });
  }
  if (account.status !== "ok") throw new MailError("account_unverified", "Boîte mail non vérifiée");

  assertHeaderSafe("subject", compose.subject);
  assertHeaderSafe("inReplyToMessageId", compose.inReplyToMessageId);

  const fiche = await resolveFicheContext(orgId, userId, { databaseId: compose.databaseId, rowId: compose.rowId });
  if (!fiche) throw new MailError("fiche_forbidden", "Fiche introuvable ou non lisible");
  const dossierRowId = compose.dossierRowId ?? fiche.fixedDossierRowId ?? null;
  if (
    dossierRowId &&
    dossierRowId !== fiche.fixedDossierRowId &&
    !fiche.dossiers.some((d) => d.rowId === dossierRowId)
  ) {
    throw new MailError("dossier_mismatch", "Ce dossier n'appartient pas au contact");
  }
  if (fiche.fixedDossierRowId && compose.dossierRowId && compose.dossierRowId !== fiche.fixedDossierRowId) {
    throw new MailError("dossier_mismatch", "Ce dossier n'appartient pas au contact");
  }

  const existing = await findByClientKey(account.id, compose.clientKey);
  if (existing) return summary(existing, account);

  // Valide les pièces (appartenance, taille) avant de consommer le quota.
  await resolveAttachments(orgId, userId, compose.attachments);

  const cc = compose.cc ?? [];
  const bcc = compose.bcc ?? [];
  const quota = await checkMailQuota(orgId, userId, compose.to.length + cc.length + bcc.length);
  if (!quota.ok) throw new MailError("quota", "Quota d'envoi atteint", { reason: quota.reason, limit: quota.limit });

  const domain = account.address.split("@")[1] ?? "localhost";
  const messageId = `<${randomUUID()}@${domain}>`;
  const inReplyTo = compose.inReplyToMessageId?.trim() || null;
  const references = inReplyTo ? [inReplyTo] : [];
  const scheduledAt = new Date(Date.now() + account.cancelDelaySeconds * 1000);

  const [row] = await db
    .insert(mailMessages)
    .values({
      organizationId: account.organizationId,
      accountId: account.id,
      userId: account.userId,
      direction: "out",
      status: "scheduled",
      messageId,
      inReplyTo,
      references,
      threadKey: computeThreadKey({ inReplyTo, references, messageId }),
      fromAddress: account.address.trim().toLowerCase(),
      toAddresses: compose.to,
      ccAddresses: cc,
      bccAddresses: bcc,
      subject: compose.subject,
      bodyHtml: compose.bodyHtml,
      bodyText: htmlToText(compose.bodyHtml),
      attachments: compose.attachments,
      scheduledAt,
      clientKey: compose.clientKey,
      contactDatabaseId: fiche.contactDatabaseId,
      contactRowId: fiche.contactRowId,
      dossierDatabaseId: null,
      dossierRowId,
    })
    .onConflictDoNothing()
    .returning();

  if (!row) {
    // Double clic concurrent : l'autre requête a gagné, on rend sa ligne.
    const winner = await findByClientKey(account.id, compose.clientKey);
    if (!winner) throw new Error("Programmation du mail impossible");
    return summary(winner, account);
  }

  arm(row.id, account.cancelDelaySeconds * 1000);
  auditLog("mail.send.scheduled", userId, { organizationId: account.organizationId, messageRowId: row.id });
  return summary(row, account);
}

async function findByClientKey(accountId: string, clientKey: string): Promise<MailMessageRow | null> {
  const [row] = await db
    .select()
    .from(mailMessages)
    .where(and(eq(mailMessages.accountId, accountId), eq(mailMessages.clientKey, clientKey)))
    .limit(1);
  return row ?? null;
}

function summary(row: MailMessageRow, account: Pick<MailAccountRow, "cancelDelaySeconds">) {
  return {
    messageId: row.messageId ?? "",
    rowId: row.id,
    scheduledAt: row.scheduledAt ?? new Date(),
    cancelDelaySeconds: account.cancelDelaySeconds,
  };
}

export async function cancelScheduled(orgId: string, userId: string, id: string): Promise<boolean> {
  const rows = await db
    .update(mailMessages)
    .set({ status: "cancelled", updatedAt: new Date() })
    .where(
      and(
        eq(mailMessages.id, id),
        eq(mailMessages.organizationId, orgId),
        eq(mailMessages.userId, userId),
        eq(mailMessages.status, "scheduled"),
      ),
    )
    .returning({ id: mailMessages.id });
  if (rows.length === 0) return false;
  clearTimer(id);
  return true;
}

/** Prise atomique des mails échus : chacun n'est rendu qu'à un seul appelant. */
export async function claimDue(limit: number): Promise<MailMessageRow[]> {
  // Deux temps dans une transaction : un sous-select LIMIT ... FOR UPDATE SKIP LOCKED placé dans un
  // IN peut être réévalué ligne à ligne par le planificateur et prendre plus de lignes que `limit`.
  return db.transaction(async (tx) => {
    const due = await tx
      .select({ id: mailMessages.id })
      .from(mailMessages)
      .where(
        and(
          eq(mailMessages.status, "scheduled"),
          eq(mailMessages.direction, "out"),
          lte(mailMessages.scheduledAt, sql`now()`),
        ),
      )
      .orderBy(mailMessages.scheduledAt)
      .limit(limit)
      .for("update", { skipLocked: true });
    if (due.length === 0) return [];
    return tx
      .update(mailMessages)
      .set({ status: "sending", attempts: sql`${mailMessages.attempts} + 1`, updatedAt: new Date() })
      .where(
        and(
          eq(mailMessages.status, "scheduled"),
          inArray(
            mailMessages.id,
            due.map((d) => d.id),
          ),
        ),
      )
      .returning();
  });
}

/**
 * Juste avant la remise : rafraîchit `updated_at` du mail « sending » (le lot est livré en série,
 * le compte à rebours « bloqué » de 5 min repart). Zéro ligne : le mail a été basculé entre-temps
 * (ex. failed/delivery_unknown), on n'envoie pas.
 */
export async function touchSending(message: MailMessageRow): Promise<boolean> {
  const rows = await db
    .update(mailMessages)
    .set({ updatedAt: new Date() })
    .where(
      and(
        eq(mailMessages.id, message.id),
        eq(mailMessages.organizationId, message.organizationId),
        eq(mailMessages.status, "sending"),
      ),
    )
    .returning({ id: mailMessages.id });
  return rows.length > 0;
}

/**
 * Prend puis remet les mails échus, UN à la fois : un serveur lent ne garde en « sending » que
 * son propre mail, jamais un lot entier d'autres organisations.
 */
export async function processDue(limit = CLAIM_BATCH): Promise<number> {
  let processed = 0;
  for (let i = 0; i < limit; i++) {
    const [message] = await claimDue(1);
    if (!message) break;
    processed++;
    try {
      if (!(await touchSending(message))) continue;
      await deliver(message);
    } catch (err) {
      logger.error({ err, messageRowId: message.id }, "[mailing] deliver crashed");
      await finish(message, { status: "failed", lastError: toError(err) });
    }
  }
  return processed;
}

type Finish = { status: "failed"; lastError: string };

async function finish(message: MailMessageRow, patch: Finish): Promise<void> {
  await db
    .update(mailMessages)
    .set({ ...patch, updatedAt: new Date() })
    .where(
      and(
        eq(mailMessages.id, message.id),
        eq(mailMessages.organizationId, message.organizationId),
        eq(mailMessages.status, "sending"),
      ),
    );
}

function isTemporary(err: unknown): boolean {
  const code = Number((err as { responseCode?: number } | null)?.responseCode);
  return code >= 400 && code < 500;
}

export async function deliver(message: MailMessageRow): Promise<void> {
  // Boîte supprimée entre-temps (account_id mis à NULL) : rien à envoyer.
  if (!message.accountId) return finish(message, { status: "failed", lastError: "account_missing" });
  const [account] = await db
    .select()
    .from(mailAccounts)
    .where(
      and(
        eq(mailAccounts.id, message.accountId),
        eq(mailAccounts.organizationId, message.organizationId),
        eq(mailAccounts.userId, message.userId),
      ),
    )
    .limit(1);
  if (!account) return finish(message, { status: "failed", lastError: "account_missing" });

  const quota = await peekMailQuota(message.organizationId, message.userId);
  if (quota.exceeded) return finish(message, { status: "failed", lastError: "quota" });

  let options;
  let raw: Buffer | null = null;
  try {
    assertHeaderSafe("subject", message.subject);
    assertHeaderSafe("inReplyTo", message.inReplyTo);
    for (const r of message.references) assertHeaderSafe("references", r);
    const attachments = await resolveAttachments(message.organizationId, message.userId, message.attachments);
    options = buildMimeOptions(
      account,
      {
        to: message.toAddresses,
        cc: message.ccAddresses,
        bcc: message.bccAddresses,
        subject: message.subject,
        bodyHtml: message.bodyHtml,
        inReplyTo: message.inReplyTo,
        references: message.references,
      },
      attachments,
    );
    if (message.messageId) options.messageId = message.messageId;
    try {
      const node = new MailComposer({
        ...options,
        bcc: message.bccAddresses.length ? message.bccAddresses : undefined,
      }).compile();
      node.keepBcc = true;
      raw = await node.build();
    } catch (err) {
      logger.warn({ err, messageRowId: message.id }, "[mailing] copy for Sent not built");
    }
  } catch (err) {
    return finish(message, { status: "failed", lastError: toError(err) });
  }

  const sending = Promise.resolve().then(() => getTransport(account).sendMail(options));
  let timer: ReturnType<typeof setTimeout> | undefined;
  const timeout = new Promise<"timeout">((resolve) => {
    timer = setTimeout(() => resolve("timeout"), SEND_TIMEOUT_MS);
  });
  try {
    const outcome = await Promise.race([sending, timeout]);
    if (outcome === "timeout") {
      // Le serveur n'a pas répondu : on ne sait pas si le mail est parti, donc aucun renvoi. Si SMTP
      // accepte finalement, le mail repasse « sent » (markSent accepte failed/delivery_unknown).
      sending.then(
        () => afterSmtpAccepted(message, account, raw).catch(() => {}),
        () => {},
      );
      return finish(message, { status: "failed", lastError: "delivery_unknown" });
    }
  } catch (err) {
    if (isTemporary(err) && message.attempts < 2) {
      const retryAt = new Date(Date.now() + RETRY_DELAY_MS);
      await db
        .update(mailMessages)
        .set({ status: "scheduled", scheduledAt: retryAt, lastError: toError(err), updatedAt: new Date() })
        .where(
          and(
            eq(mailMessages.id, message.id),
            eq(mailMessages.organizationId, message.organizationId),
            eq(mailMessages.status, "sending"),
          ),
        );
      arm(message.id, RETRY_DELAY_MS);
      return;
    }
    return finish(message, { status: "failed", lastError: toError(err) });
  } finally {
    clearTimeout(timer);
  }

  // SMTP accepté : à partir d'ici rien ne peut plus écrire « failed » ni remettre en file (au plus une fois).
  await afterSmtpAccepted(message, account, raw);
}

const SENT_UPDATE_DELAYS_MS = [100, 300];

async function markSent(message: MailMessageRow): Promise<MailMessageRow | null | "error"> {
  for (let i = 0; i <= SENT_UPDATE_DELAYS_MS.length; i++) {
    try {
      const [sent] = await db
        .update(mailMessages)
        .set({ status: "sent", sentAt: new Date(), lastError: null, updatedAt: new Date() })
        .where(
          and(
            eq(mailMessages.id, message.id),
            eq(mailMessages.organizationId, message.organizationId),
            or(
              eq(mailMessages.status, "sending"),
              // Bascule delivery_unknown (délai ou tick) puis acceptation SMTP tardive : le mail est parti.
              and(eq(mailMessages.status, "failed"), eq(mailMessages.lastError, "delivery_unknown")),
            ),
          ),
        )
        .returning();
      return sent ?? null;
    } catch (err) {
      logger.error({ err, messageRowId: message.id, attempt: i + 1 }, "[mailing] sent update failed");
      if (i < SENT_UPDATE_DELAYS_MS.length) await new Promise((r) => setTimeout(r, SENT_UPDATE_DELAYS_MS[i]));
    }
  }
  return "error";
}

/** Ne lève jamais : le message est parti, aucun échec ultérieur ne doit toucher son statut. */
async function afterSmtpAccepted(message: MailMessageRow, account: MailAccountRow, raw: Buffer | null): Promise<void> {
  const sent = await markSent(message);
  if (sent === "error") {
    // Reste « sending » : T11 le classera sans renvoi.
    logger.error({ messageRowId: message.id }, "[mailing] sent but status not recorded, left in sending");
    return;
  }
  if (!sent) {
    logger.warn({ messageRowId: message.id }, "[mailing] sent update touched no row, audit and trace skipped");
    return;
  }
  try {
    auditLog("mail.send", message.userId, {
      organizationId: message.organizationId,
      messageRowId: message.id,
      recipients: message.toAddresses.length + message.ccAddresses.length + message.bccAddresses.length,
    });
  } catch (err) {
    logger.warn({ err, messageRowId: message.id }, "[mailing] audit failed");
  }
  if (raw) {
    try {
      await appendToSent(account, raw);
    } catch (err) {
      logger.warn({ err, messageRowId: message.id }, "[mailing] IMAP APPEND to Sent failed");
    }
  }
  await traceSent(sent);
}

/** Trace en Interaction. Un échec ici n'annule jamais l'envoi : la réconciliation (T11) rejoue. */
async function traceSent(message: MailMessageRow): Promise<void> {
  try {
    if (!message.contactRowId) {
      logger.warn({ messageRowId: message.id }, "[mailing] no contact, trace skipped");
      return;
    }
    const { dossierRowId } = await ensureDossierForMail(
      { orgId: message.organizationId, userId: message.userId },
      { contactRowId: message.contactRowId, dossierRowId: message.dossierRowId },
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
  } catch (err) {
    logger.error({ err, messageRowId: message.id }, "[mailing] CRM trace failed, left for reconciliation");
  }
}
