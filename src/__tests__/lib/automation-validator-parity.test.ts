import { describe, it, expect } from "vitest";
import { validateActionConfig } from "@/lib/automations/actions/registry";

describe("parité du validateur unifié (registre)", () => {
  it("send_email : refuse un objet > 998 caractères", () => {
    const err = validateActionConfig("send_email", {
      to: "a@b.fr",
      subject: "x".repeat(999),
      text: "corps",
    });
    expect(err).toMatch(/send_email/);
  });

  it("send_email : refuse un corps > 100 000 caractères", () => {
    const err = validateActionConfig("send_email", {
      to: "a@b.fr",
      subject: "ok",
      html: "x".repeat(100_001),
    });
    expect(err).toMatch(/send_email/);
  });

  it("send_email : accepte une config valide bornée", () => {
    expect(
      validateActionConfig("send_email", { to: "a@b.fr", subject: "ok", text: "corps" })
    ).toBeNull();
  });

  it("ai : refuse un prompt > 20 000 caractères", () => {
    const err = validateActionConfig("ai", { prompt: "x".repeat(20_001) });
    expect(err).toMatch(/IA|ai/i);
  });

  it("create_row : refuse des cells vides", () => {
    const err = validateActionConfig("create_row", { cells: {} });
    expect(err).toMatch(/cellule/i);
  });

  it("create_row : accepte des cells non vides", () => {
    expect(validateActionConfig("create_row", { cells: { col1: "v" } })).toBeNull();
  });

  it("update_row : refuse des cells vides", () => {
    expect(validateActionConfig("update_row", { cells: {} })).toMatch(/cellule/i);
  });

  it("webhook : refuse l'absence d'URL et les URLs non publiques (SSRF)", () => {
    expect(validateActionConfig("webhook", {})).not.toBeNull();
    expect(validateActionConfig("webhook", { url: "http://127.0.0.1/x" })).toMatch(/refusée/);
  });

  it("webhook : accepte une URL publique", () => {
    expect(validateActionConfig("webhook", { url: "https://example.com/hook" })).toBeNull();
  });

  it("type d'action inconnu : renvoie une erreur explicite (pas null, contrairement à l'ancien validateur)", () => {
    expect(validateActionConfig("not_a_real_action", {})).toMatch(/inconnu/i);
  });

  it("send_email : refuse un `to` au format email invalide", () => {
    expect(
      validateActionConfig("send_email", { to: "pasunemail", subject: "x", text: "y" })
    ).toMatch(/send_email/);
  });

  it("send_email : accepte `toUserId` seul, sans `to`", () => {
    expect(
      validateActionConfig("send_email", { toUserId: "some-user-id", subject: "x", text: "y" })
    ).toBeNull();
  });
});

describe("relationMode (update_row / create_row)", () => {
  it("accepte append / replace, refuse une autre valeur", () => {
    expect(validateActionConfig("update_row", { cells: { c: "v" }, relationMode: "append" })).toBeNull();
    expect(validateActionConfig("update_row", { cells: { c: "v" }, relationModes: { c: "replace" } })).toBeNull();
    expect(validateActionConfig("update_row", { cells: { c: "v" }, relationMode: "merge" })).not.toBeNull();
    expect(validateActionConfig("create_row", { cells: { c: "v" }, relationModes: { c: "x" } })).not.toBeNull();
  });
});
