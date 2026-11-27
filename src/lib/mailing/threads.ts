/**
 * Fil des mails d'une fiche : lecture cloisonnée (organisation ET propriétaire du mail), forme client
 * sans clé de stockage ni détail d'erreur brut, corps HTML assaini, regroupement par conversation.
 */
import { and, asc, eq } from "drizzle-orm";
import { db } from "@/lib/db";
import { mailMessages, type MailMessageRow } from "@/lib/db/schema-mailing";
import { sanitizeMailHtml } from "./compose";

export type MailErrorUiCode =
  | "delivery_unknown"
  | "account_missing"
  | "quota_exceeded"
  | "trace_pending"
  | "send_failed";

export interface MailAttachmentDto {
  index: number;
  fileName: string;
  mimeType: string;
  size: number;
}

export interface MailMessageDto {
  id: string;
  messageId: string | null;
  direction: "out" | "in";
  status: MailMessageRow["status"];
  from: string;
  to: string[];
  cc: string[];
  bcc: string[];
  subject: string;
  bodyHtml: string;
  bodyText: string;
  attachments: MailAttachmentDto[];
  /** Date d'affichage : envoi réel, sinon programmation, sinon création. */
  date: string;
  scheduledAt: string | null;
  sentAt: string | null;
  error: MailErrorUiCode | null;
  /** Motif reconnu d'un échec d'envoi (traduit côté interface). */
  errorReason: "auth_refused" | null;
  /** Motif brut tronqué quand il n'est pas reconnu, sinon null. */
  errorDetail: string | null;
  traced: boolean;
}

export interface ConversationDto {
  threadKey: string;
  subject: string;
  messages: MailMessageDto[];
  lastAt: string;
  unread: false;
}

const PREFIX = /^\s*(?:(?:re|tr|fw|fwd)\s*:\s*)+/i;

export const stripSubjectPrefixes = (subject: string): string => subject.replace(PREFIX, "").trim();

function errorCode(row: MailMessageRow): MailErrorUiCode | null {
  if (row.lastError === "trace") return "trace_pending";
  if (row.status !== "failed") return null;
  switch (row.lastError) {
    case "delivery_unknown":
      return "delivery_unknown";
    case "account":
    case "account_missing":
      return "account_missing";
    case "quota":
      return "quota_exceeded";
    default:
      return "send_failed";
  }
}

const INTERNAL_ERRORS = new Set(["trace", "delivery_unknown", "account", "account_missing", "quota"]);
// Vrais refus d'identifiants : code EAUTH de nodemailer, ou réponse SMTP 535 en début de message.
const AUTH_REFUSED = /\bEAUTH\b|^\s*(?:invalid login:\s*)?535(?:[\s-]|$)/i;
const DETAIL_MAX = 160;

function failureReason(row: MailMessageRow): { reason: "auth_refused" | null; detail: string | null } {
  const raw = row.lastError;
  if (row.status !== "failed" || !raw || INTERNAL_ERRORS.has(raw)) return { reason: null, detail: null };
  if (AUTH_REFUSED.test(raw)) return { reason: "auth_refused", detail: null };
  return { reason: null, detail: raw.slice(0, DETAIL_MAX) };
}

export function toMessageDto(row: MailMessageRow): MailMessageDto {
  const failure = failureReason(row);
  const date = row.sentAt ?? row.scheduledAt ?? row.createdAt;
  return {
    id: row.id,
    messageId: row.messageId,
    direction: row.direction,
    status: row.status,
    from: row.fromAddress,
    to: row.toAddresses,
    cc: row.ccAddresses,
    bcc: row.bccAddresses,
    subject: row.subject,
    bodyHtml: sanitizeMailHtml(row.bodyHtml),
    bodyText: row.bodyText,
    attachments: (row.attachments ?? []).map((a, index) => ({
      index,
      fileName: a.fileName,
      mimeType: a.mimeType,
      size: a.size,
    })),
    date: date.toISOString(),
    scheduledAt: row.scheduledAt?.toISOString() ?? null,
    sentAt: row.sentAt?.toISOString() ?? null,
    error: errorCode(row),
    errorReason: failure.reason,
    errorDetail: failure.detail,
    traced: row.interactionRowId !== null,
  };
}

export function groupConversations(rows: MailMessageRow[]): ConversationDto[] {
  const groups = new Map<string, MailMessageDto[]>();
  for (const row of rows) {
    const key = row.threadKey ?? row.id;
    const list = groups.get(key) ?? [];
    list.push(toMessageDto(row));
    groups.set(key, list);
  }
  const out: ConversationDto[] = [];
  for (const [threadKey, messages] of groups) {
    messages.sort((a, b) => a.date.localeCompare(b.date));
    out.push({
      threadKey,
      subject: stripSubjectPrefixes(messages[0].subject),
      messages,
      lastAt: messages[messages.length - 1].date,
      unread: false,
    });
  }
  return out.sort((a, b) => b.lastAt.localeCompare(a.lastAt));
}

export type FicheMailScope = { kind: "contact"; contactRowId: string } | { kind: "dossier"; dossierRowId: string };

/** Mails de l'utilisateur sur la fiche : organisation ET propriétaire dans CHAQUE requête. */
export async function listFicheMails(orgId: string, userId: string, scope: FicheMailScope): Promise<MailMessageRow[]> {
  const target =
    scope.kind === "contact"
      ? eq(mailMessages.contactRowId, scope.contactRowId)
      : eq(mailMessages.dossierRowId, scope.dossierRowId);
  return db
    .select()
    .from(mailMessages)
    .where(and(eq(mailMessages.organizationId, orgId), eq(mailMessages.userId, userId), target))
    .orderBy(asc(mailMessages.createdAt))
    .limit(500);
}

/** Un mail visible : organisation ET propriétaire, sinon null (404 muet côté route). */
export async function getVisibleMail(orgId: string, userId: string, id: string): Promise<MailMessageRow | null> {
  const [row] = await db
    .select()
    .from(mailMessages)
    .where(and(eq(mailMessages.id, id), eq(mailMessages.organizationId, orgId), eq(mailMessages.userId, userId)))
    .limit(1);
  return row ?? null;
}
