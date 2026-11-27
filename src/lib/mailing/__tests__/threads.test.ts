import { describe, it, expect } from "vitest";
import { groupConversations, toMessageDto } from "../threads";
import type { MailMessageRow } from "@/lib/db/schema-mailing";

let n = 0;
const row = (over: Partial<MailMessageRow>): MailMessageRow =>
  ({
    id: `id${++n}`, organizationId: "o", accountId: "a", userId: "u", direction: "out", status: "sent",
    messageId: `<m${n}@x>`, inReplyTo: null, references: [], threadKey: `t${n}`, fromAddress: "me@x.fr",
    toAddresses: ["c@x.fr"], ccAddresses: [], bccAddresses: [], subject: "Sujet", bodyHtml: "<p>Hi</p>", bodyText: "Hi",
    attachments: [], scheduledAt: null, sentAt: null, attempts: 0, lastError: null, traceAttempts: 0, clientKey: "k",
    contactDatabaseId: null, contactRowId: null, dossierDatabaseId: null, dossierRowId: null, interactionRowId: null,
    createdAt: new Date("2026-01-01T10:00:00Z"), updatedAt: new Date("2026-01-01T10:00:00Z"), ...over,
  }) as MailMessageRow;

describe("toMessageDto failure reason", () => {
  it("maps an SMTP 535 to auth_refused", () => {
    const dto = toMessageDto(row({ status: "failed", lastError: "Invalid login: 535 5.7.0 Invalid login or password" }));
    expect(dto.error).toBe("send_failed");
    expect(dto.errorReason).toBe("auth_refused");
    expect(dto.errorDetail).toBeNull();
  });
  it("maps EAUTH to auth_refused", () => {
    expect(toMessageDto(row({ status: "failed", lastError: "EAUTH: Invalid login" })).errorReason).toBe("auth_refused");
  });
  it("maps a reply starting with 535 to auth_refused", () => {
    expect(toMessageDto(row({ status: "failed", lastError: "535 5.7.8 Username and Password not accepted" })).errorReason).toBe("auth_refused");
  });
  it.each([
    "530 5.7.0 Must issue a STARTTLS command first. Authentication required",
    "Connection to 10.0.535.2 refused",
    "Message too large, limit 5350000 bytes",
    "Authentication required",
  ])("does not map %s to auth_refused", (lastError) => {
    const dto = toMessageDto(row({ status: "failed", lastError }));
    expect(dto.errorReason).toBeNull();
    expect(dto.errorDetail).toBe(lastError);
  });
  it("keeps a raw reason truncated for other failures", () => {
    const dto = toMessageDto(row({ status: "failed", lastError: "x".repeat(400) }));
    expect(dto.errorReason).toBeNull();
    expect(dto.errorDetail).toHaveLength(160);
  });
  it("has no reason on a sent mail or on internal codes", () => {
    expect(toMessageDto(row({ status: "sent" })).errorDetail).toBeNull();
    expect(toMessageDto(row({ status: "failed", lastError: "quota" })).errorDetail).toBeNull();
  });
});

describe("groupConversations", () => {
  it("groups by threadKey and sorts conversations by last message desc", () => {
    const rows = [
      row({ threadKey: "A", createdAt: new Date("2026-01-01T10:00:00Z") }),
      row({ threadKey: "B", createdAt: new Date("2026-01-03T10:00:00Z") }),
      row({ threadKey: "A", createdAt: new Date("2026-01-04T10:00:00Z") }),
      row({ threadKey: "A", createdAt: new Date("2025-12-30T10:00:00Z") }),
    ];
    const out = groupConversations(rows);
    expect(out.map((c) => c.threadKey)).toEqual(["A", "B"]);
    expect(out[0].messages).toHaveLength(3);
    const dates = out[0].messages.map((m) => m.date);
    expect([...dates].sort()).toEqual(dates);
    expect(out[0].lastAt).toBe(dates[2]);
    expect(out[0].unread).toBe(false);
  });

  it("strips Re: and Tr: prefixes from the subject", () => {
    const out = groupConversations([row({ threadKey: "A", subject: "RE: Tr : re: Devis" })]);
    expect(out[0].subject).toBe("Devis");
  });

  it("a lone message is a conversation of one", () => {
    const out = groupConversations([row({ threadKey: null })]);
    expect(out).toHaveLength(1);
    expect(out[0].messages).toHaveLength(1);
  });
});

describe("toMessageDto", () => {
  it("never exposes storage keys, the account id, nor unsanitized html", () => {
    const dto = toMessageDto(
      row({
        bodyHtml: '<p>x</p><script>alert(1)</script><a href="javascript:alert(1)">l</a>',
        attachments: [{ source: "upload", storageKey: "mail/o/u/secret.pdf", fileName: "a.pdf", mimeType: "application/pdf", size: 3 }],
        lastError: "535 auth failed for smtp.secret.host",
        status: "failed",
      }),
    );
    const json = JSON.stringify(dto);
    expect(json).not.toContain("secret.pdf");
    expect(json).not.toContain("script");
    expect(json).not.toContain("javascript:");
    expect(json).not.toContain("smtp.secret.host");
    expect(json).not.toContain("accountId");
    expect(dto.attachments[0]).toEqual({ index: 0, fileName: "a.pdf", mimeType: "application/pdf", size: 3 });
    expect(dto.error).toBe("send_failed");
  });
  it("maps delivery_unknown to its stable code", () => {
    expect(toMessageDto(row({ status: "failed", lastError: "delivery_unknown" })).error).toBe("delivery_unknown");
  });
});
