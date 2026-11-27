import nodemailer from "nodemailer";
import { ImapFlow } from "imapflow";
import { resolvePublicAddresses } from "@/lib/security/url-validator-server";
import type { MailSecurity } from "@/lib/db/schema-mailing";

export interface ConnectionConfig {
  address: string;
  password: string;
  smtpHost: string;
  smtpPort: number;
  smtpSecurity: MailSecurity;
  imapHost: string;
  imapPort: number;
  imapSecurity: MailSecurity;
}

export interface ConnectionTestResult {
  smtp: { ok: boolean; message: string };
  imap: { ok: boolean; message: string; inboxCount?: number };
}

export type ConnectionErrorCode = "auth_failed" | "host_unreachable" | "tls_error" | "timeout" | "unknown";

const TIMEOUT_MS = 15_000;

class TestTimeout extends Error {}
export class HostRefused extends Error {}

function withTimeout<T>(work: Promise<T>): Promise<T> {
  let timer: ReturnType<typeof setTimeout>;
  const limit = new Promise<never>((_, reject) => {
    timer = setTimeout(() => reject(new TestTimeout("timeout")), TIMEOUT_MS);
  });
  return Promise.race([work, limit]).finally(() => clearTimeout(timer));
}

function classify(err: unknown): ConnectionErrorCode {
  if (err instanceof TestTimeout) return "timeout";
  if (err instanceof HostRefused) return "host_unreachable";
  const e = err as { code?: string; authenticationFailed?: boolean; message?: string } | null;
  const code = String(e?.code ?? "");
  const msg = String(e?.message ?? "");
  if (e?.authenticationFailed || code === "EAUTH" || /auth|login|credentials/i.test(msg)) return "auth_failed";
  if (/^ETIMEDOUT$|^ESOCKET.*TIMEOUT/i.test(code) || /timed? ?out/i.test(msg)) return "timeout";
  if (/ENOTFOUND|ECONNREFUSED|EHOSTUNREACH|ENETUNREACH|EAI_AGAIN|ECONNRESET/.test(code)) return "host_unreachable";
  if (/CERT|TLS|SSL|ERR_OSSL|self.signed/i.test(code) || /certificate|tls|ssl/i.test(msg)) return "tls_error";
  return "unknown";
}

/** Message stable : code puis détail court, sans jamais le mot de passe ni l'adresse. */
function describe(err: unknown, secrets: string[]): string {
  const code = classify(err);
  let detail = String((err as { message?: string } | null)?.message ?? "").split("\n")[0];
  for (const s of secrets) if (s) detail = detail.split(s).join("***");
  detail = detail.slice(0, 120);
  return detail && code !== "timeout" && code !== "host_unreachable" ? `${code}: ${detail}` : code;
}

/** Résout l'hôte, refuse les adresses privées et fige l'IP validée (anti DNS rebinding). */
export async function pinHost(host: string): Promise<string> {
  try {
    const addrs = await resolvePublicAddresses(new URL(`smtp://${host}`));
    return addrs[0]?.address ?? host;
  } catch {
    throw new HostRefused("host_unreachable");
  }
}

async function testSmtp(cfg: ConnectionConfig): Promise<ConnectionTestResult["smtp"]> {
  try {
    const smtpAddr = await pinHost(cfg.smtpHost);
    const transport = nodemailer.createTransport({
      host: smtpAddr,
      tls: { servername: cfg.smtpHost },
      port: cfg.smtpPort,
      secure: cfg.smtpSecurity === "ssl",
      requireTLS: cfg.smtpSecurity === "starttls",
      auth: { user: cfg.address, pass: cfg.password },
      connectionTimeout: TIMEOUT_MS,
      greetingTimeout: TIMEOUT_MS,
      socketTimeout: TIMEOUT_MS,
      logger: false,
    });
    try {
      await withTimeout(transport.verify());
    } finally {
      transport.close?.();
    }
    return { ok: true, message: "ok" };
  } catch (err) {
    return { ok: false, message: describe(err, [cfg.password, cfg.address]) };
  }
}

async function testImap(cfg: ConnectionConfig): Promise<ConnectionTestResult["imap"]> {
  let client: ImapFlow | null = null;
  let timedOut = false;
  try {
    const imapAddr = await pinHost(cfg.imapHost);
    client = new ImapFlow({
      host: imapAddr,
      servername: cfg.imapHost,
      port: cfg.imapPort,
      secure: cfg.imapSecurity === "ssl",
      doSTARTTLS: cfg.imapSecurity === "starttls" ? true : undefined,
      auth: { user: cfg.address, pass: cfg.password },
      logger: false,
    });
    const c = client;
    const status = await withTimeout(
      (async () => {
        await c.connect();
        return c.status("INBOX", { messages: true });
      })(),
    );
    return { ok: true, message: "ok", inboxCount: status && typeof status.messages === "number" ? status.messages : 0 };
  } catch (err) {
    timedOut = err instanceof TestTimeout;
    return { ok: false, message: describe(err, [cfg.password, cfg.address]) };
  } finally {
    if (client) {
      try {
        // Après un délai dépassé : fermeture immédiate, jamais d'attente supplémentaire.
        if (timedOut || !client.usable) client.close();
        else await withTimeout(client.logout());
      } catch {
        try {
          client.close();
        } catch {
          /* connexion déjà fermée */
        }
      }
    }
  }
}

/** Chaque protocole est testé indépendamment, 15 s maximum chacun. */
export async function testMailConnection(cfg: ConnectionConfig): Promise<ConnectionTestResult> {
  const [smtp, imap] = await Promise.all([testSmtp(cfg), testImap(cfg)]);
  return { smtp, imap };
}
