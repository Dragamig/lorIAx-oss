import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";

const h = vi.hoisted(() => ({
  smtpVerify: vi.fn(),
  imapConnect: vi.fn(),
  imapStatus: vi.fn(),
  imapLogout: vi.fn(),
  assertPublic: vi.fn(),
  smtpOpts: null as unknown,
  imapOpts: null as unknown,
  imapClose: vi.fn(),
  usable: true,
}));

vi.mock("nodemailer", () => ({
  default: { createTransport: (o: unknown) => { h.smtpOpts = o; return { verify: h.smtpVerify, close: vi.fn() }; } },
}));
vi.mock("imapflow", () => ({
  ImapFlow: class {
    constructor(o: unknown) { h.imapOpts = o; }
    get usable() { return h.usable; }
    connect = h.imapConnect;
    status = h.imapStatus;
    logout = h.imapLogout;
    close = h.imapClose;
  },
}));
vi.mock("@/lib/security/url-validator-server", () => ({
  resolvePublicAddresses: (u: URL) => h.assertPublic(u),
}));

import { testMailConnection, type ConnectionConfig } from "../connection-test";

const cfg: ConnectionConfig = {
  address: "a@b.fr",
  password: "S3cr3t-pw",
  smtpHost: "smtp.b.fr",
  smtpPort: 465,
  smtpSecurity: "ssl",
  imapHost: "imap.b.fr",
  imapPort: 993,
  imapSecurity: "ssl",
};

beforeEach(() => {
  vi.clearAllMocks();
  h.assertPublic.mockResolvedValue([{ address: "203.0.113.7", family: 4 }]);
  h.usable = true;
  h.smtpVerify.mockResolvedValue(true);
  h.imapConnect.mockResolvedValue(undefined);
  h.imapStatus.mockResolvedValue({ messages: 42 });
  h.imapLogout.mockResolvedValue(undefined);
});
afterEach(() => vi.useRealTimers());

describe("testMailConnection", () => {
  it("smtp ok and imap ok returns both ok with inbox count", async () => {
    const r = await testMailConnection(cfg);
    expect(r.smtp.ok).toBe(true);
    expect(r.imap).toMatchObject({ ok: true, inboxCount: 42 });
    expect(h.imapLogout).toHaveBeenCalled();
  });

  it("smtp auth refused returns smtp.ok false and still tests imap", async () => {
    h.smtpVerify.mockRejectedValue(Object.assign(new Error("Invalid login"), { code: "EAUTH" }));
    const r = await testMailConnection(cfg);
    expect(r.smtp.ok).toBe(false);
    expect(r.smtp.message).toContain("auth_failed");
    expect(r.imap.ok).toBe(true);
  });

  it("imap timeout returns timeout code after 15 s (fake timers)", async () => {
    vi.useFakeTimers();
    h.imapConnect.mockImplementation(() => new Promise(() => {}));
    const p = testMailConnection(cfg);
    await vi.advanceTimersByTimeAsync(15_001);
    const r = await p;
    expect(r.imap.ok).toBe(false);
    expect(r.imap.message).toContain("timeout");
    expect(r.smtp.ok).toBe(true);
  });

  it("never includes the password in any message", async () => {
    h.smtpVerify.mockRejectedValue(new Error(`bad login for S3cr3t-pw`));
    h.imapConnect.mockRejectedValue(new Error(`Command failed: LOGIN a@b.fr S3cr3t-pw`));
    const r = await testMailConnection(cfg);
    expect(JSON.stringify(r)).not.toContain("S3cr3t-pw");
    expect(r.smtp.ok).toBe(false);
    expect(r.imap.ok).toBe(false);
  });

  it.each(["127.0.0.1", "10.0.0.5", "localhost"])("rejects a private or loopback host (%s)", async (host) => {
    h.assertPublic.mockRejectedValue(new Error("URL résolue vers une adresse privée"));
    const r = await testMailConnection({ ...cfg, smtpHost: host, imapHost: host });
    expect(r.smtp.ok).toBe(false);
    expect(r.imap.ok).toBe(false);
    expect(r.smtp.message).toContain("host_unreachable");
    expect(h.smtpVerify).not.toHaveBeenCalled();
    expect(h.imapConnect).not.toHaveBeenCalled();
  });

  it("connects to the pinned resolved IP and keeps the original host as TLS servername", async () => {
    await testMailConnection(cfg);
    expect(h.smtpOpts).toMatchObject({ host: "203.0.113.7", tls: { servername: "smtp.b.fr" } });
    expect(h.imapOpts).toMatchObject({ host: "203.0.113.7", servername: "imap.b.fr" });
  });

  it("closes the imap client right after a timeout without waiting for logout", async () => {
    vi.useFakeTimers();
    h.usable = true;
    h.imapConnect.mockImplementation(() => new Promise(() => {}));
    h.imapLogout.mockImplementation(() => new Promise(() => {}));
    const p = testMailConnection(cfg);
    await vi.advanceTimersByTimeAsync(15_001);
    const r = await p;
    expect(r.imap.message).toContain("timeout");
    expect(h.imapClose).toHaveBeenCalled();
    expect(h.imapLogout).not.toHaveBeenCalled();
  });
});
