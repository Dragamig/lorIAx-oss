import { encrypt, decrypt } from "@/lib/crypto";
import { MASKED_SECRET } from "@/lib/settings/secrets";
import type { MailAccountRow } from "@/lib/db/schema-mailing";

export type ClientMailAccount = Omit<MailAccountRow, "passwordEnc"> & {
  hasPassword: boolean;
  /** MASKED_SECRET si un mot de passe existe, sinon chaîne vide. */
  password: string;
};

/** Vue client d'un compte : le chiffré ne sort jamais, seul le masque. */
export function toClientAccount(row: MailAccountRow): ClientMailAccount {
  const { passwordEnc, ...rest } = row;
  const hasPassword = !!passwordEnc;
  return { ...rest, hasPassword, password: hasPassword ? MASKED_SECRET : "" };
}

/**
 * Valeur chiffrée à stocker, ou null si rien n'est à écrire. Une valeur
 * masquée, vide, blanche ou absente ne remplace jamais un secret existant.
 */
export function resolvePasswordForWrite(
  incoming: string | null | undefined,
  existingEnc: string | null,
): string | null {
  const value = typeof incoming === "string" ? incoming : "";
  if (value.trim() === "" || value === MASKED_SECRET) return existingEnc ?? null;
  return encrypt(value);
}

export function decryptAccountPassword(row: MailAccountRow): string {
  if (!row.passwordEnc) throw new Error("Aucun mot de passe enregistré pour ce compte mail");
  return decrypt(row.passwordEnc);
}
