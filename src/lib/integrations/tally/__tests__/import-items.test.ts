import { describe, it, expect, vi } from "vitest";

const h = vi.hoisted(() => ({ values: null as Record<string, unknown> | null, sets: [] as Record<string, unknown>[], deletes: 0 }));
vi.mock("@/lib/db", () => ({
  db: {
    insert: () => ({ values: (v: Record<string, unknown>) => ((h.values = v), { onConflictDoNothing: async () => {} }) }),
    update: () => ({ set: (s: Record<string, unknown>) => (h.sets.push(s), { where: async () => {} }) }),
    delete: () => ({ where: async () => void (h.deletes += 1) }),
  },
}));
vi.mock("@/lib/db/schema", () => ({ tallyImportItems: {}, tallyImports: {}, userDatabaseColumns: {} }));
vi.mock("drizzle-orm", () => ({ and: () => 0, asc: () => 0, eq: () => 0, inArray: () => 0, ne: () => 0, lt: () => 0, sql: Object.assign(() => 0, {}) }));

import {
  ITEM_TRACE_MAX_BYTES,
  boundTrace,
  describeSubmission,
  errorFromSteps,
  purgeTallyImportData,
  recordImportItem,
  rowResultFromSteps,
} from "../import-items";

const body = (fields: { label: string; type: string; value: unknown }[]) =>
  ({ data: { fields: fields.map((f, i) => ({ key: `k${i}`, ...f })) } }) as never;

describe("describeSubmission", () => {
  it("extrait nom, prénom et mail des champs", () => {
    const r = describeSubmission(
      body([
        { label: "Prénom", type: "INPUT_TEXT", value: "Léa" },
        { label: "Nom", type: "INPUT_TEXT", value: "Martin" },
        { label: "Votre adresse", type: "INPUT_EMAIL", value: "lea@x.fr" },
      ])
    );
    expect(r).toEqual({ name: "Léa Martin", email: "lea@x.fr" });
  });
  it("champs absents ou vides : null", () => {
    expect(describeSubmission(body([{ label: "Nom", type: "INPUT_TEXT", value: null }]))).toEqual({ name: null, email: null });
  });
});

describe("rowResultFromSteps", () => {
  it("lit l'issue, les colonnes remplies et la base", () => {
    const r = rowResultFromSteps([
      { output: { row: { outcome: "completed", filledColumns: ["c1", "c2"], databaseId: "d1" } } } as never,
    ]);
    expect(r).toEqual({ outcome: "completed", filledColumns: ["c1", "c2"], databaseId: "d1" });
  });
  it("inconnu sans ligne", () => {
    expect(rowResultFromSteps([{ output: {} } as never]).outcome).toBe("unknown");
  });
});

describe("errorFromSteps", () => {
  it("message de la première étape en erreur, sinon repli", () => {
    expect(errorFromSteps([{ status: "error", error: { message: "Colonne absente" } } as never], "x")).toBe("Colonne absente");
    expect(errorFromSteps([], "repli")).toBe("repli");
    expect(errorFromSteps(undefined)).toBeNull();
  });
});

describe("boundTrace", () => {
  it("garde une petite trace telle quelle", () => {
    const t = [{ nodeId: "a", status: "simulated" } as never];
    expect(boundTrace(t)).toEqual({ trace: t, truncated: false });
  });
  it("retire entrées et sorties d'une trace volumineuse", () => {
    const big = Array.from({ length: 10 }, (_, i) => ({ nodeId: `n${i}`, status: "simulated", output: "x".repeat(ITEM_TRACE_MAX_BYTES / 4) }));
    const r = boundTrace(big as never);
    expect(r.truncated).toBe(true);
    expect(r.trace).toHaveLength(10);
    expect(JSON.stringify(r.trace).length).toBeLessThanOrEqual(ITEM_TRACE_MAX_BYTES);
  });
  it("aucune trace : null", () => {
    expect(boundTrace(undefined).trace).toBeNull();
  });
});

describe("traces simulées", () => {
  it("passent par la rédaction commune avant stockage", async () => {
    const steps = [{ nodeId: "a", status: "simulated", inputs: { password: "secret123", name: "ok" } }] as never;
    await recordImportItem({
      importId: "i", submissionId: "s", position: 0, body: { data: { fields: [] } } as never,
      ok: true, steps, real: false, nameColumns: async () => [],
    });
    const trace = JSON.stringify(h.values?.trace);
    expect(trace).not.toContain("secret123");
    expect(trace).toContain("ok");
  });
});

describe("purgeTallyImportData", () => {
  it("efface les traces simulées puis les items échus", async () => {
    h.sets = [];
    h.deletes = 0;
    await purgeTallyImportData();
    expect(h.sets).toEqual([{ trace: null }]);
    expect(h.deletes).toBe(1);
  });
});
