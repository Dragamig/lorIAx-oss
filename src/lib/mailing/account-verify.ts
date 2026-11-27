import { setAccountStatus } from "./accounts";
import type { MailAccountRow } from "@/lib/db/schema-mailing";
import { decryptAccountPassword } from "./account-secrets";
import { testMailConnection, type ConnectionTestResult } from "./connection-test";
import logger from "@/lib/logger";

/** Statut et motif lisible déduits d'un test de connexion. */
export function statusFromTest(result: ConnectionTestResult): { status: "ok" | "error"; message: string | null } {
  const ok = result.smtp.ok && result.imap.ok;
  if (ok) return { status: "ok", message: null };
  const message = [!result.smtp.ok && `smtp: ${result.smtp.message}`, !result.imap.ok && `imap: ${result.imap.message}`]
    .filter(Boolean)
    .join(" | ");
  return { status: "error", message };
}

/**
 * Teste la configuration enregistrée et pose `ok` ou `error`. Appelé à l'enregistrement (hors quota
 * des tests manuels). Un plantage du test laisse le statut tel quel et ne fait jamais échouer l'enregistrement.
 */
export async function verifyStoredAccount(orgId: string, userId: string, row: MailAccountRow): Promise<MailAccountRow> {
  try {
    const result = await testMailConnection({
      address: row.address,
      password: decryptAccountPassword(row),
      smtpHost: row.smtpHost,
      smtpPort: row.smtpPort,
      smtpSecurity: row.smtpSecurity,
      imapHost: row.imapHost,
      imapPort: row.imapPort,
      imapSecurity: row.imapSecurity,
    });
    const { status, message } = statusFromTest(result);
    await setAccountStatus(orgId, userId, status, message);
    return { ...row, status, statusMessage: message };
  } catch (err) {
    logger.warn({ err }, "[mailing] verification of the saved mailbox crashed");
    return row;
  }
}
