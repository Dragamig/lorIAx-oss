import { describe, it, expect } from "vitest";
import { z } from "zod";

// Réplique du schéma défini dans route.ts (extraction nécessaire pour test
// pur sans charger next/server).
const COLUMN_TYPES = ["text", "number", "date", "select", "checkbox", "url", "email", "formula"] as const;

const planSchema = z.object({
  name: z.string().min(1).max(255),
  description: z.string().max(500).optional(),
  columns: z
    .array(
      z.object({
        name: z.string().min(1).max(255),
        type: z.enum(COLUMN_TYPES),
        options: z.array(z.string()).optional(),
      })
    )
    .min(1)
    .max(20),
});

describe("planSchema — validation Zod du plan IA", () => {
  it("accepte un plan minimal valide", () => {
    const res = planSchema.safeParse({
      name: "Candidatures",
      columns: [{ name: "Nom", type: "text" }],
    });
    expect(res.success).toBe(true);
  });

  it("accepte options pour select", () => {
    const res = planSchema.safeParse({
      name: "X",
      columns: [{ name: "Statut", type: "select", options: ["À faire", "Fait"] }],
    });
    expect(res.success).toBe(true);
  });

  it("rejette type invalide", () => {
    const res = planSchema.safeParse({
      name: "X",
      columns: [{ name: "A", type: "image" }],
    });
    expect(res.success).toBe(false);
  });

  it("rejette plan sans colonne", () => {
    const res = planSchema.safeParse({ name: "X", columns: [] });
    expect(res.success).toBe(false);
  });

  it("rejette > 20 colonnes (anti-prompt-injection abuse)", () => {
    const res = planSchema.safeParse({
      name: "X",
      columns: Array.from({ length: 21 }, (_, i) => ({ name: `c${i}`, type: "text" as const })),
    });
    expect(res.success).toBe(false);
  });

  it("rejette name vide ou >255 chars", () => {
    expect(planSchema.safeParse({ name: "", columns: [{ name: "A", type: "text" }] }).success).toBe(false);
    expect(
      planSchema.safeParse({
        name: "x".repeat(256),
        columns: [{ name: "A", type: "text" }],
      }).success
    ).toBe(false);
  });

  it("rejette description > 500", () => {
    expect(
      planSchema.safeParse({
        name: "X",
        description: "y".repeat(501),
        columns: [{ name: "A", type: "text" }],
      }).success
    ).toBe(false);
  });
});
