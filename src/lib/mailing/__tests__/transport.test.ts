import { describe, it, expect, vi, beforeEach } from "vitest";
import { readFileSync } from "node:fs";
import { resolve } from "node:path";

const h = vi.hoisted(() => ({
  created: [] as Record<string, unknown>[],
  sendMail: vi.fn(),
  close: vi.fn(),
  pin: vi.fn(),
  imapClose: vi.fn(),
}));

vi.mock("nodemailer", () => ({
  default: {
    createTransport: (o: Record<string, unknown>) => {
      h.created.push(o);
      return { __opts: o, sendMail: h.sendMail, close: h.close };
    },
  },
}));
vi.mock("imapflow", () => ({
  ImapFlow: class {
    usable = true;
    connect() {
      return new Promise(() => {});
    }
    close() {
      h.imapClose();
    }
  },
}));
vi.mock("../connection-test", () => ({ pinHost: (host: string) => h.pin(host) }));
vi.mock("../account-secrets", () => ({ decryptAccountPassword: (a: { passwordEnc: string }) => `clear:${a.passwordEnc}` }));

import { getTransport, invalidateTransport, appendToSent, APPEND_TIMEOUT_MS } from "../transport";
import type { MailAccountRow } from "@/lib/db/schema-mailing";

const account = (over: Partial<MailAccountRow> = {}) =>
  ({
    id: "acc1",
    smtpHost: "smtp.example.fr",
    smtpPort: 465,
    smtpSecurity: "ssl",
    address: "a@example.fr",
    passwordEnc: "pw1",
    ...over,
  }) as MailAccountRow;

beforeEach(() => {
  h.created.length = 0;
  h.sendMail.mockReset();
  h.pin.mockReset();
  h.pin.mockResolvedValue("203.0.113.9");
  invalidateTransport("acc1");
  invalidateTransport("acc2");
});

describe("getTransport", () => {
  it("returns the same transporter for an unchanged account", () => {
    expect(getTransport(account())).toBe(getTransport(account()));
  });

  it("builds a new transporter when the password changes", () => {
    const a = getTransport(account());
    expect(getTransport(account({ passwordEnc: "pw2" }))).not.toBe(a);
  });

  it("two accounts never share a transporter", () => {
    expect(getTransport(account())).not.toBe(getTransport(account({ id: "acc2" })));
  });

  it("invalidateTransport drops the entry", () => {
    const a = getTransport(account());
    invalidateTransport("acc1");
    expect(getTransport(account())).not.toBe(a);
  });

  it("does not import or mutate the global provider cache", () => {
    const src = readFileSync(resolve(__dirname, "../transport.ts"), "utf8");
    expect(src).not.toMatch(/from\s+"[^"]*provider"/);
  });

  it("pins the resolved IP with the original host as servername at send time", async () => {
    h.sendMail.mockResolvedValue({ messageId: "m" });
    const t = getTransport(account());
    const outer = h.created[0] as { send: (m: unknown, cb: (e: Error | null, i?: unknown) => void) => void };
    await new Promise<void>((done) => outer.send({ data: { subject: "x" } }, () => done()));
    expect(h.pin).toHaveBeenCalledWith("smtp.example.fr");
    const inner = h.created[1] as { host: string; tls: { servername: string }; auth: { pass: string } };
    expect(inner.host).toBe("203.0.113.9");
    expect(inner.tls.servername).toBe("smtp.example.fr");
    expect(inner.auth.pass).toBe("clear:pw1");
    expect(h.sendMail).toHaveBeenCalledWith({ subject: "x" });
    expect(t).toBeTruthy();
  });

  it("fails the send when the host resolves to a private address", async () => {
    h.pin.mockRejectedValue(new Error("host_unreachable"));
    getTransport(account());
    const outer = h.created[0] as { send: (m: unknown, cb: (e: Error | null) => void) => void };
    const err = await new Promise<Error | null>((done) => outer.send({ data: {} }, (e) => done(e)));
    expect(err?.message).toBe("host_unreachable");
    expect(h.sendMail).not.toHaveBeenCalled();
  });
});

describe("appendToSent", () => {
  it("gives up after the total timeout and force-closes the IMAP client", async () => {
    vi.useFakeTimers();
    try {
      h.imapClose.mockClear();
      const p = appendToSent({ imapHost: "imap.example.fr", imapPort: 993, imapSecurity: "ssl", address: "a@example.fr", passwordEnc: "pw1" } as MailAccountRow, Buffer.from("raw"));
      const assertion = expect(p).rejects.toThrow(/timeout/i);
      await vi.advanceTimersByTimeAsync(APPEND_TIMEOUT_MS + 1);
      await assertion;
      expect(h.imapClose).toHaveBeenCalled();
    } finally {
      vi.useRealTimers();
    }
  });
});
