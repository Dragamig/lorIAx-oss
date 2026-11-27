import { describe, it, expect, beforeAll } from "vitest";

process.env.ENCRYPTION_KEY = Buffer.alloc(32, 1).toString("base64");

import { MASKED_SECRET } from "@/lib/settings/secrets";
import { encrypt } from "@/lib/crypto";
import {
  toClientAccount,
  resolvePasswordForWrite,
  decryptAccountPassword,
} from "../account-secrets";
import type { MailAccountRow } from "@/lib/db/schema-mailing";

function makeRow(passwordEnc: string | null): MailAccountRow {
  const now = new Date();
  return {
    id: "00000000-0000-0000-0000-000000000001",
    organizationId: "00000000-0000-0000-0000-000000000002",
    userId: "00000000-0000-0000-0000-000000000003",
    address: "a@example.com",
    displayName: "A",
    smtpHost: "smtp.example.com",
    smtpPort: 465,
    smtpSecurity: "ssl",
    imapHost: "imap.example.com",
    imapPort: 993,
    imapSecurity: "ssl",
    passwordEnc,
    signature: "",
    cancelDelaySeconds: 10,
    pollIntervalMinutes: 5,
    lastPollAt: null,
    status: "unverified",
    statusMessage: null,
    createdAt: now,
    updatedAt: now,
  };
}

describe("account-secrets", () => {
  let enc: string;
  beforeAll(() => {
    enc = encrypt("s3cret");
  });

  it("toClientAccount never exposes passwordEnc", () => {
    const client = toClientAccount(makeRow(enc));
    expect(client).not.toHaveProperty("passwordEnc");
    expect(JSON.stringify(client)).not.toContain(enc);
    expect(client.hasPassword).toBe(true);
  });

  it("toClientAccount returns MASKED_SECRET when a password exists", () => {
    expect(toClientAccount(makeRow(enc)).password).toBe(MASKED_SECRET);
    const none = toClientAccount(makeRow(null));
    expect(none.password).toBe("");
    expect(none.hasPassword).toBe(false);
  });

  it("resolvePasswordForWrite keeps existing on MASKED_SECRET", () => {
    expect(resolvePasswordForWrite(MASKED_SECRET, enc)).toBe(enc);
  });

  it("resolvePasswordForWrite keeps existing on empty string, null and whitespace", () => {
    expect(resolvePasswordForWrite("", enc)).toBe(enc);
    expect(resolvePasswordForWrite(null, enc)).toBe(enc);
    expect(resolvePasswordForWrite(undefined, enc)).toBe(enc);
    expect(resolvePasswordForWrite("   ", enc)).toBe(enc);
  });

  it("resolvePasswordForWrite encrypts a new clear value (decrypt round-trips)", () => {
    const out = resolvePasswordForWrite("nouveau", enc);
    expect(out).not.toBeNull();
    expect(out).not.toBe(enc);
    expect(out).not.toContain("nouveau");
    expect(decryptAccountPassword(makeRow(out))).toBe("nouveau");
  });

  it("resolvePasswordForWrite returns null when no existing and no incoming", () => {
    expect(resolvePasswordForWrite(undefined, null)).toBeNull();
    expect(resolvePasswordForWrite("", null)).toBeNull();
    expect(resolvePasswordForWrite(MASKED_SECRET, null)).toBeNull();
  });
});
