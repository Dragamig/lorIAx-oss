/**
 * I2 (revue finale, tache 40) : seul un super administrateur est redirige vers
 * /setup par la mise en page de l'application, comme en 1.21.1. Les autres
 * utilisateurs n'y sont pas enfermes sur l'ecran du jeton d'amorcage.
 */
import { describe, it, expect } from "vitest";
import { shouldRedirectToSetup } from "@/lib/setup/redirect-rule";

const superAdmin = { globalRole: "super_admin" };

describe("shouldRedirectToSetup", () => {
  it("redirige le super admin quand l'assistant n'est pas termine", () => {
    expect(shouldRedirectToSetup({ user: superAdmin, completed: false, skipped: false })).toBe(true);
  });
  it("ne redirige jamais un membre, un editeur ou un admin simple", () => {
    for (const globalRole of ["viewer", "editor", "admin"]) {
      expect(shouldRedirectToSetup({ user: { globalRole }, completed: false, skipped: false })).toBe(false);
    }
  });
  it("ne redirige pas un visiteur sans session", () => {
    expect(shouldRedirectToSetup({ user: null, completed: false, skipped: false })).toBe(false);
  });
  it("ne redirige plus une fois l'assistant termine", () => {
    expect(shouldRedirectToSetup({ user: superAdmin, completed: true, skipped: false })).toBe(false);
  });
  it("respecte « Plus tard » (cookie de report)", () => {
    expect(shouldRedirectToSetup({ user: superAdmin, completed: false, skipped: true })).toBe(false);
  });
});
