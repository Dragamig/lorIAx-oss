import { describe, it, expect, expectTypeOf } from "vitest";
import { existsSync, readFileSync } from "node:fs";
import { join } from "node:path";
import { getTableConfig } from "drizzle-orm/pg-core";
import { mailMessages, type MailAttachmentRef, type MailMessageRow } from "@/lib/db/schema-mailing";

// L'édition open source n'embarque qu'une migration initiale : les migrations numérotées sont absentes.
const migrationPath = join(process.cwd(), "src/lib/db/migrations/0062_mail_messages.sql");
const hasNumberedMigrations = existsSync(migrationPath);
const sql = hasNumberedMigrations ? readFileSync(migrationPath, "utf8") : "";

describe("mail_messages schema", () => {
  it("schema exports mailMessages", () => {
    expect(getTableConfig(mailMessages).name).toBe("mail_messages");
  });

  it("attachments column typed as MailAttachmentRef[]", () => {
    expectTypeOf<MailMessageRow["attachments"]>().toEqualTypeOf<MailAttachmentRef[]>();
    const ref: MailAttachmentRef = { source: "media", storageKey: "k", fileName: "a.pdf", mimeType: "application/pdf", size: 1, mediaId: "m" };
    expect(ref.source).toBe("media");
  });

  it("unique (accountId, messageId) and (accountId, clientKey) declared", () => {
    const { indexes } = getTableConfig(mailMessages);
    const byName = (n: string) => indexes.find((i) => i.config.name === n);
    const msg = byName("mail_messages_account_message_id_idx");
    expect(msg?.config.unique).toBe(true);
    expect(msg?.config.where).toBeDefined();
    expect(msg?.config.columns.map((c) => (c as { name: string }).name)).toEqual(["account_id", "message_id"]);
    const ck = byName("mail_messages_account_client_key_idx");
    expect(ck?.config.unique).toBe(true);
    expect(ck?.config.columns.map((c) => (c as { name: string }).name)).toEqual(["account_id", "client_key"]);
  });

  it("declares the lookup indexes", () => {
    const names = getTableConfig(mailMessages).indexes.map((i) => i.config.name);
    expect(names).toEqual(expect.arrayContaining([
      "idx_mail_messages_contact", "idx_mail_messages_dossier", "idx_mail_messages_due", "idx_mail_messages_thread",
    ]));
  });

  it.skipIf(!hasNumberedMigrations)("migration 0062 is idempotent and has no DROP", () => {
    expect(sql).toContain("CREATE TABLE IF NOT EXISTS mail_messages");
    expect(sql).toMatch(/CREATE UNIQUE INDEX IF NOT EXISTS mail_messages_account_message_id_idx[^;]*message_id[^;]*WHERE/);
    expect(sql).toContain("CREATE UNIQUE INDEX IF NOT EXISTS mail_messages_account_client_key_idx");
    expect(sql).toContain("idx_mail_messages_due");
    expect(sql).not.toMatch(/\bDROP\b/i);
    expect(sql).not.toMatch(/[—–]/);
  });
});
