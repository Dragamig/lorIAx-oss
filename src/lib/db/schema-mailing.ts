import { pgTable, uuid, varchar, text, integer, timestamp, uniqueIndex, index, jsonb } from "drizzle-orm/pg-core";
import { sql } from "drizzle-orm";
import { users } from "./schema";
import { organizations } from "./schema-org";

export type MailSecurity = "ssl" | "starttls";
export type MailAccountStatus = "ok" | "error" | "unverified";

/**
 * Boîte mail d'un utilisateur dans une organisation (une seule par couple).
 * Le mot de passe n'est jamais stocké en clair : `password_enc` (AES-256-GCM).
 * Énumérations en varchar + type TS, pas d'enum Postgres.
 */
export const mailAccounts = pgTable(
  "mail_accounts",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    organizationId: uuid("organization_id")
      .notNull()
      .references(() => organizations.id, { onDelete: "cascade" }),
    userId: uuid("user_id")
      .notNull()
      .references(() => users.id, { onDelete: "cascade" }),
    address: varchar("address", { length: 320 }).notNull(),
    displayName: varchar("display_name", { length: 255 }).notNull().default(""),
    smtpHost: varchar("smtp_host", { length: 255 }).notNull(),
    smtpPort: integer("smtp_port").notNull(),
    smtpSecurity: varchar("smtp_security", { length: 16 }).$type<MailSecurity>().notNull(),
    imapHost: varchar("imap_host", { length: 255 }).notNull(),
    imapPort: integer("imap_port").notNull(),
    imapSecurity: varchar("imap_security", { length: 16 }).$type<MailSecurity>().notNull(),
    passwordEnc: text("password_enc"),
    signature: text("signature").notNull().default(""),
    cancelDelaySeconds: integer("cancel_delay_seconds").notNull().default(10),
    pollIntervalMinutes: integer("poll_interval_minutes").notNull().default(5),
    lastPollAt: timestamp("last_poll_at", { withTimezone: true }),
    status: varchar("status", { length: 16 }).$type<MailAccountStatus>().notNull().default("unverified"),
    statusMessage: text("status_message"),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
    updatedAt: timestamp("updated_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [uniqueIndex("mail_accounts_org_user_idx").on(t.organizationId, t.userId)],
);

export type MailAccountRow = typeof mailAccounts.$inferSelect;

export type MailDirection = "out" | "in";
export type MailMessageStatus = "scheduled" | "sending" | "sent" | "failed" | "cancelled" | "received";

export interface MailAttachmentRef {
  source: "upload" | "media";
  storageKey: string;
  fileName: string;
  mimeType: string;
  size: number;
  mediaId?: string;
}

/**
 * Message mail sortant (programme, envoye, echoue, annule) ou entrant.
 * `client_key` rend la programmation idempotente (double clic) : unique par compte.
 * Les identifiants de fiches CRM sont des uuid simples, sans cle etrangere : la trace survit a la fiche.
 */
export const mailMessages = pgTable(
  "mail_messages",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    organizationId: uuid("organization_id")
      .notNull()
      .references(() => organizations.id, { onDelete: "cascade" }),
    // Nullable : supprimer la boite conserve l'historique (ON DELETE SET NULL).
    accountId: uuid("account_id").references(() => mailAccounts.id, { onDelete: "set null" }),
    userId: uuid("user_id").notNull(),
    direction: varchar("direction", { length: 8 }).$type<MailDirection>().notNull(),
    status: varchar("status", { length: 16 }).$type<MailMessageStatus>().notNull(),
    messageId: varchar("message_id", { length: 998 }),
    inReplyTo: varchar("in_reply_to", { length: 998 }),
    references: text("references").array().notNull().default(sql`'{}'::text[]`),
    threadKey: varchar("thread_key", { length: 998 }),
    fromAddress: varchar("from_address", { length: 320 }).notNull(),
    toAddresses: text("to_addresses").array().notNull().default(sql`'{}'::text[]`),
    ccAddresses: text("cc_addresses").array().notNull().default(sql`'{}'::text[]`),
    bccAddresses: text("bcc_addresses").array().notNull().default(sql`'{}'::text[]`),
    subject: text("subject").notNull().default(""),
    bodyHtml: text("body_html").notNull().default(""),
    bodyText: text("body_text").notNull().default(""),
    attachments: jsonb("attachments").$type<MailAttachmentRef[]>().notNull().default(sql`'[]'::jsonb`),
    scheduledAt: timestamp("scheduled_at", { withTimezone: true }),
    sentAt: timestamp("sent_at", { withTimezone: true }),
    attempts: integer("attempts").notNull().default(0),
    lastError: text("last_error"),
    traceAttempts: integer("trace_attempts").notNull().default(0),
    clientKey: varchar("client_key", { length: 64 }),
    contactDatabaseId: uuid("contact_database_id"),
    contactRowId: uuid("contact_row_id"),
    dossierDatabaseId: uuid("dossier_database_id"),
    dossierRowId: uuid("dossier_row_id"),
    interactionRowId: uuid("interaction_row_id"),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
    updatedAt: timestamp("updated_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [
    index("idx_mail_messages_contact").on(t.organizationId, t.contactRowId, t.createdAt),
    index("idx_mail_messages_dossier").on(t.organizationId, t.dossierRowId, t.createdAt),
    index("idx_mail_messages_due").on(t.status, t.scheduledAt),
    index("idx_mail_messages_thread").on(t.organizationId, t.threadKey),
    uniqueIndex("mail_messages_account_message_id_idx")
      .on(t.accountId, t.messageId)
      .where(sql`${t.messageId} IS NOT NULL`),
    uniqueIndex("mail_messages_account_client_key_idx").on(t.accountId, t.clientKey),
  ],
);

export type MailMessageRow = typeof mailMessages.$inferSelect;
