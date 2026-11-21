import { describe, it, expect } from "vitest";
import { validateNewPassword } from "@/lib/auth/password-policy";

describe("validateNewPassword", () => {
  it("accepte un mot de passe d'au moins 8 caractères", () => {
    expect(validateNewPassword("motdepasse1").ok).toBe(true);
  });
  it("refuse un mot de passe trop court", () => {
    const r = validateNewPassword("court");
    expect(r.ok).toBe(false);
    if (!r.ok) expect(r.error).toMatch(/8/);
  });
  it("refuse une valeur vide ou non-string", () => {
    expect(validateNewPassword("").ok).toBe(false);
    expect(validateNewPassword(undefined as unknown as string).ok).toBe(false);
  });
});
