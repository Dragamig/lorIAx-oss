import { z } from "zod";
import { and, eq } from "drizzle-orm";
import { db } from "@/lib/db";
import { mailAccounts, type MailAccountRow, type MailAccountStatus, type MailSecurity } from "@/lib/db/schema-mailing";
import { MASKED_SECRET } from "@/lib/settings/secrets";
import { resolvePasswordForWrite } from "./account-secrets";
import { invalidateTransport } from "./transport";

const HOST = z
  .string()
  .trim()
  .min(1)
  .max(255)
  .regex(/^[^\s/:@]+$/, "Hôte invalide");
const PORT = z.number().int().min(1).max(65535);
const SECURITY = z.enum(["ssl", "starttls"]);
const CANCEL_DELAYS = [0, 5, 10, 20, 30] as const;
const POLL_INTERVALS = [0, 1, 5, 15, 60] as const;

const oneOf = (values: readonly number[]) =>
  z.number().int().refine((n) => values.includes(n), "Valeur non autorisée");

export const accountInputSchema = z
  .object({
    address: z.string().trim().max(320).email(),
    displayName: z.string().trim().max(255).default(""),
    smtpHost: HOST,
    smtpPort: PORT,
    smtpSecurity: SECURITY,
    imapHost: HOST,
    imapPort: PORT,
    imapSecurity: SECURITY,
    password: z.string().max(1024).nullish(),
    signature: z.string().max(10000).default(""),
    cancelDelaySeconds: oneOf(CANCEL_DELAYS).default(10),
    pollIntervalMinutes: oneOf(POLL_INTERVALS).default(5),
  })
  .strict();

export type AccountInput = z.infer<typeof accountInputSchema>;

/** Le mot de passe stocké ne peut pas être réutilisé vers une adresse ou un hôte modifié. */
export class PasswordRequiredError extends Error {
  readonly code = "password_required";
  constructor() {
    super("password_required");
  }
}

/** Vrai si l'adresse ou un hôte diffère du compte enregistré (le secret ne doit pas suivre). */
export function targetChanged(
  stored: { address: string; smtpHost: string; imapHost: string },
  input: { address: string; smtpHost: string; imapHost: string },
): boolean {
  return stored.address !== input.address || stored.smtpHost !== input.smtpHost || stored.imapHost !== input.imapHost;
}

const isSecurity = (v: unknown): v is MailSecurity => v === "ssl" || v === "starttls";

export async function getAccountFor(orgId: string, userId: string): Promise<MailAccountRow | null> {
  const [row] = await db
    .select()
    .from(mailAccounts)
    .where(and(eq(mailAccounts.organizationId, orgId), eq(mailAccounts.userId, userId)))
    .limit(1);
  return row ?? null;
}

export async function upsertAccount(
  orgId: string,
  userId: string,
  input: AccountInput,
): Promise<MailAccountRow> {
  // La base n'a pas de CHECK : on valide ici, même si l'appelant a déjà parsé.
  if (!isSecurity(input.smtpSecurity) || !isSecurity(input.imapSecurity)) {
    throw new Error("Sécurité de connexion invalide");
  }
  const existing = await getAccountFor(orgId, userId);
  const incoming = typeof input.password === "string" ? input.password : "";
  if (
    existing?.passwordEnc &&
    (incoming.trim() === "" || incoming === MASKED_SECRET) &&
    targetChanged(existing, input)
  ) {
    throw new PasswordRequiredError();
  }
  const passwordEnc = resolvePasswordForWrite(input.password, existing?.passwordEnc ?? null);
  const { password: _password, ...fields } = input;
  void _password;
  const values = { ...fields, passwordEnc, updatedAt: new Date() };

  if (!existing) {
    const [created] = await db
      .insert(mailAccounts)
      .values({ ...values, organizationId: orgId, userId, status: "unverified", statusMessage: null })
      .returning();
    invalidateTransport(created.id);
    return created;
  }

  const connectionChanged =
    existing.smtpHost !== input.smtpHost ||
    existing.smtpPort !== input.smtpPort ||
    existing.smtpSecurity !== input.smtpSecurity ||
    existing.imapHost !== input.imapHost ||
    existing.imapPort !== input.imapPort ||
    existing.imapSecurity !== input.imapSecurity ||
    existing.address !== input.address ||
    existing.passwordEnc !== passwordEnc;

  const [updated] = await db
    .update(mailAccounts)
    .set(connectionChanged ? { ...values, status: "unverified", statusMessage: null } : values)
    .where(and(eq(mailAccounts.organizationId, orgId), eq(mailAccounts.userId, userId)))
    .returning();
  invalidateTransport(updated.id);
  return updated;
}

export async function deleteAccount(orgId: string, userId: string): Promise<boolean> {
  const rows = await db
    .delete(mailAccounts)
    .where(and(eq(mailAccounts.organizationId, orgId), eq(mailAccounts.userId, userId)))
    .returning({ id: mailAccounts.id });
  for (const r of rows) invalidateTransport(r.id);
  return rows.length > 0;
}

export async function setAccountStatus(
  orgId: string,
  userId: string,
  status: MailAccountStatus,
  statusMessage: string | null,
): Promise<void> {
  await db
    .update(mailAccounts)
    .set({ status, statusMessage, updatedAt: new Date() })
    .where(and(eq(mailAccounts.organizationId, orgId), eq(mailAccounts.userId, userId)));
}
