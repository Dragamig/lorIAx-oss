import type { MailSecurity } from "@/lib/db/schema-mailing";

export type ProviderId = "infomaniak" | "gmail" | "outlook" | "ovh" | "other";

export interface ProviderPreset {
  id: ProviderId;
  /** Initiales affichées dans la tuile. */
  logo: string;
  smtp: { host: string; port: number; security: MailSecurity } | null;
  imap: { host: string; port: number; security: MailSecurity } | null;
}

export const PROVIDERS: readonly ProviderPreset[] = [
  {
    id: "infomaniak",
    logo: "IK",
    smtp: { host: "mail.infomaniak.com", port: 465, security: "ssl" },
    imap: { host: "mail.infomaniak.com", port: 993, security: "ssl" },
  },
  {
    id: "gmail",
    logo: "G",
    smtp: { host: "smtp.gmail.com", port: 465, security: "ssl" },
    imap: { host: "imap.gmail.com", port: 993, security: "ssl" },
  },
  {
    id: "outlook",
    logo: "O",
    smtp: { host: "smtp-mail.outlook.com", port: 587, security: "starttls" },
    imap: { host: "outlook.office365.com", port: 993, security: "ssl" },
  },
  {
    id: "ovh",
    logo: "OVH",
    smtp: { host: "ssl0.ovh.net", port: 465, security: "ssl" },
    imap: { host: "ssl0.ovh.net", port: 993, security: "ssl" },
  },
  { id: "other", logo: "...", smtp: null, imap: null },
];

export function getProvider(id: ProviderId): ProviderPreset {
  return PROVIDERS.find((p) => p.id === id) ?? PROVIDERS[PROVIDERS.length - 1];
}

/** Préréglage dont les serveurs correspondent exactement, sinon « other ». */
export function detectProvider(c: {
  smtpHost: string;
  smtpPort: number;
  smtpSecurity: MailSecurity;
  imapHost: string;
  imapPort: number;
  imapSecurity: MailSecurity;
}): ProviderId {
  const hit = PROVIDERS.find(
    (p) =>
      p.smtp &&
      p.imap &&
      p.smtp.host === c.smtpHost &&
      p.smtp.port === c.smtpPort &&
      p.smtp.security === c.smtpSecurity &&
      p.imap.host === c.imapHost &&
      p.imap.port === c.imapPort &&
      p.imap.security === c.imapSecurity,
  );
  return hit?.id ?? "other";
}
