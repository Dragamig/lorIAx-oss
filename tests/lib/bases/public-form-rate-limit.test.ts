import { describe, it, expect } from "vitest";
import { tryAllowSubmission } from "@/lib/bases/public-form-rate-limit";

// Uses the shared rate-limit backend (in-memory ici, Redis si REDIS_URL en prod).
// Chaque test utilise des clés uniques pour ne pas dépendre d'un reset global.

describe("tryAllowSubmission", () => {
  it("autorise jusqu'à 10 soumissions par IP+token", async () => {
    const ip = "203.0.113.4";
    const token = `tkA-${Date.now()}-${Math.random()}`;
    for (let i = 0; i < 10; i++) {
      expect(await tryAllowSubmission(ip, token)).toBe(true);
    }
  });

  it("refuse la 11e soumission", async () => {
    const ip = "203.0.113.4";
    const token = `tkB-${Date.now()}-${Math.random()}`;
    for (let i = 0; i < 10; i++) await tryAllowSubmission(ip, token);
    expect(await tryAllowSubmission(ip, token)).toBe(false);
  });

  it("compte séparément par IP", async () => {
    const token = `tkC-${Date.now()}-${Math.random()}`;
    for (let i = 0; i < 10; i++) await tryAllowSubmission("203.0.113.4", token);
    expect(await tryAllowSubmission("203.0.113.6", token)).toBe(true);
  });

  it("compte séparément par token", async () => {
    const ip = "203.0.113.9";
    const tokenA = `tkD-${Date.now()}-${Math.random()}`;
    const tokenB = `tkE-${Date.now()}-${Math.random()}`;
    for (let i = 0; i < 10; i++) await tryAllowSubmission(ip, tokenA);
    expect(await tryAllowSubmission(ip, tokenB)).toBe(true);
  });
});
