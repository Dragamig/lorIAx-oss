/**
 * Serveur SMTP local pour les tests (smtp-server, MIT-0), certificat auto-signé généré à la volée.
 * Écoute sur 127.0.0.1 par défaut, aucune connexion externe. Le certificat n'est accepté QUE par
 * `trustTestCertificate`, jamais par un réglage global (pas de NODE_TLS_REJECT_UNAUTHORIZED).
 */
import { execFileSync } from "node:child_process";
import { mkdtempSync, readFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import tls from "node:tls";
import { SMTPServer } from "smtp-server";

export const TEST_SMTP_HOSTNAME = "smtp.test.local";
export const TEST_SMTP_USER = "me@example.fr";
export const TEST_SMTP_PASSWORD = "S3cretPassw0rd!test";

export interface ReceivedMail {
  raw: string;
  from: string;
  to: string[];
  /** Vrai si la session était chiffrée au moment de la remise. */
  secure: boolean;
  authUser: string | null;
}

export interface TestSmtpServer {
  port: number;
  received: ReceivedMail[];
  /** Noms de serveur (SNI) demandés par les clients à la négociation TLS. */
  sniNames: string[];
  close(): Promise<void>;
}

let cached: { key: string; cert: string } | null = null;

export function testCertificate(): { key: string; cert: string } {
  if (cached) return cached;
  const dir = mkdtempSync(join(tmpdir(), "mailing-cert-"));
  try {
    execFileSync(
      "openssl",
      [
        "req", "-x509", "-newkey", "rsa:2048", "-nodes", "-days", "2",
        "-subj", `/CN=${TEST_SMTP_HOSTNAME}`,
        "-addext", `subjectAltName=DNS:${TEST_SMTP_HOSTNAME}`,
        "-keyout", join(dir, "key.pem"), "-out", join(dir, "cert.pem"),
      ],
      { stdio: "ignore" },
    );
    cached = { key: readFileSync(join(dir, "key.pem"), "utf8"), cert: readFileSync(join(dir, "cert.pem"), "utf8") };
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
  return cached;
}

/** Fait accepter le certificat de test par ce processus ; rend la fonction qui rétablit l'état d'origine. */
export function trustTestCertificate(): () => void {
  const original = tls.getCACertificates("default");
  tls.setDefaultCACertificates([...original, testCertificate().cert]);
  return () => tls.setDefaultCACertificates(original);
}

/** `secure: true` = TLS implicite (ssl) ; `false` = STARTTLS obligatoire avant AUTH. */
export async function startTestSmtpServer(opts: { secure: boolean; port?: number; host?: string }): Promise<TestSmtpServer> {
  const { key, cert } = testCertificate();
  const received: ReceivedMail[] = [];
  const sniNames: string[] = [];
  const server = new SMTPServer({
    secure: opts.secure,
    key,
    cert,
    name: TEST_SMTP_HOSTNAME,
    authOptional: false,
    allowInsecureAuth: false,
    disabledCommands: opts.secure ? ["STARTTLS"] : [],
    SNICallback: (servername, cb) => {
      sniNames.push(servername);
      cb(null, tls.createSecureContext({ key, cert }));
    },
    onAuth(auth, _session, cb) {
      if (auth.username === TEST_SMTP_USER && auth.password === TEST_SMTP_PASSWORD) {
        return cb(null, { user: auth.username });
      }
      cb(new Error("Invalid credentials"));
    },
    onData(stream, session, cb) {
      const chunks: Buffer[] = [];
      stream.on("data", (c: Buffer) => chunks.push(c));
      stream.on("end", () => {
        received.push({
          raw: Buffer.concat(chunks).toString("utf8"),
          from: session.envelope.mailFrom ? session.envelope.mailFrom.address : "",
          to: session.envelope.rcptTo.map((r) => r.address),
          secure: Boolean(session.secure),
          authUser: (session.user as string | null) ?? null,
        });
        cb();
      });
    },
  });
  await new Promise<void>((resolve, reject) => {
    server.once("error", reject);
    server.listen(opts.port ?? 0, opts.host ?? "127.0.0.1", () => resolve());
  });
  const port = (server.server.address() as { port: number }).port;
  return {
    port,
    received,
    sniNames,
    close: () => new Promise<void>((resolve) => server.close(() => resolve())),
  };
}
