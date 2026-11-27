import { getEmailConfig } from "@/lib/email/provider";

/**
 * True when outgoing email is enabled and the selected provider has its
 * required credentials (SMTP host or Resend key). No test send, no
 * environment-variable fallback.
 */
export async function isEmailConfigured(): Promise<boolean> {
  const config = await getEmailConfig();
  if (!config.emailEnabled) return false;
  if (config.emailProvider === "resend") return Boolean(config.resendApiKey);
  return Boolean(config.smtpHost);
}
