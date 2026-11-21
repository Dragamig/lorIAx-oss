export type PasswordCheck = { ok: true } | { ok: false; error: string };

export function validateNewPassword(password: unknown): PasswordCheck {
  if (typeof password !== "string" || password.length === 0) {
    return { ok: false, error: "Mot de passe requis" };
  }
  if (password.length < 8) {
    return { ok: false, error: "Le mot de passe doit contenir au moins 8 caractères" };
  }
  return { ok: true };
}
