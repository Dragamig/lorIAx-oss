/**
 * Transport SMTP et copie IMAP par compte. Un transporteur par compte, mis en cache et
 * renouvelé quand l'hôte, le port, la sécurité, l'adresse ou le mot de passe chiffré changent.
 * À chaque envoi l'hôte est résolu, refusé s'il est privé, puis l'IP validée est figée avec
 * servername = hôte d'origine (anti DNS rebinding). Le singleton de `provider.ts` n'est jamais touché.
 */
import { createHash } from "node:crypto";
import nodemailer from "nodemailer";
import type { Transporter } from "nodemailer";
import { ImapFlow } from "imapflow";
import type { MailAccountRow } from "@/lib/db/schema-mailing";
import { decryptAccountPassword } from "./account-secrets";
import { pinHost } from "./connection-test";

const TIMEOUT_MS = 30_000;
/** Délai TOTAL de la copie IMAP : au-delà, la connexion est fermée de force. */
export const APPEND_TIMEOUT_MS = 30_000;

interface Entry {
  hash: string;
  transporter: Transporter;
}

const cache = new Map<string, Entry>();

type TransportFields = Pick<
  MailAccountRow,
  "id" | "smtpHost" | "smtpPort" | "smtpSecurity" | "address" | "passwordEnc"
>;

function accountHash(a: TransportFields): string {
  return createHash("sha256")
    .update(JSON.stringify([a.smtpHost, a.smtpPort, a.smtpSecurity, a.address, a.passwordEnc]))
    .digest("hex");
}

function build(account: MailAccountRow): Transporter {
  const { smtpHost, smtpPort, smtpSecurity, address } = account;
  // Transport personnalisé : la résolution et le figeage de l'IP sont asynchrones, getTransport reste synchrone.
  return nodemailer.createTransport({
    name: "loriax-mailing",
    version: "1",
    send(mail: { data: Record<string, unknown> }, done: (err: Error | null, info?: unknown) => void) {
      void (async () => {
        const ip = await pinHost(smtpHost);
        const inner = nodemailer.createTransport({
          host: ip,
          tls: { servername: smtpHost },
          port: smtpPort,
          secure: smtpSecurity === "ssl",
          requireTLS: smtpSecurity === "starttls",
          auth: { user: address, pass: decryptAccountPassword(account) },
          connectionTimeout: TIMEOUT_MS,
          greetingTimeout: TIMEOUT_MS,
          socketTimeout: TIMEOUT_MS,
          logger: false,
        });
        try {
          return await inner.sendMail(mail.data as never);
        } finally {
          inner.close?.();
        }
      })().then(
        (info) => done(null, info),
        (err: Error) => done(err),
      );
    },
  } as never);
}

export function getTransport(account: MailAccountRow): Transporter {
  const hash = accountHash(account);
  const hit = cache.get(account.id);
  if (hit && hit.hash === hash) return hit.transporter;
  const transporter = build(account);
  cache.set(account.id, { hash, transporter });
  return transporter;
}

export function invalidateTransport(accountId: string): void {
  cache.delete(accountId);
}

const SENT_FALLBACKS = ["sent", "envoyés", "envoyes", "sent items", "sent messages"];

/** Copie le message brut dans « Envoyés ». Retourne false si aucun dossier n'est trouvé. */
export async function appendToSent(account: MailAccountRow, raw: Buffer): Promise<boolean> {
  const imapAddr = await pinHost(account.imapHost);
  const client = new ImapFlow({
    host: imapAddr,
    servername: account.imapHost,
    port: account.imapPort,
    secure: account.imapSecurity === "ssl",
    doSTARTTLS: account.imapSecurity === "starttls" ? true : undefined,
    auth: { user: account.address, pass: decryptAccountPassword(account) },
    logger: false,
  });
  const forceClose = () => {
    try {
      client.close();
    } catch {
      /* connexion déjà fermée */
    }
  };
  let timer: ReturnType<typeof setTimeout> | undefined;
  let timedOut = false;
  const timeout = new Promise<never>((_resolve, reject) => {
    timer = setTimeout(() => {
      timedOut = true;
      forceClose();
      reject(new Error("IMAP append timeout"));
    }, APPEND_TIMEOUT_MS);
  });
  const work = (async () => {
    await client.connect();
    const boxes = await client.list();
    const folder =
      boxes.find((b) => b.specialUse === "\\Sent") ??
      boxes.find((b) => SENT_FALLBACKS.includes(b.name.toLowerCase()) || SENT_FALLBACKS.includes(b.path.toLowerCase()));
    if (!folder) return false;
    await client.append(folder.path, raw, ["\\Seen"]);
    return true;
  })();
  work.catch(() => {});
  try {
    return await Promise.race([work, timeout]);
  } finally {
    clearTimeout(timer);
    try {
      if (timedOut) forceClose();
      else if (client.usable) await client.logout();
      else client.close();
    } catch {
      forceClose();
    }
  }
}
