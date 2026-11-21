import { describe, it, expect, vi, beforeEach } from "vitest";

const h = vi.hoisted(() => ({ returned: [{ id: "s1" }] as unknown[], conflict: null as Record<string, unknown> | null, deletes: 0 }));

vi.mock("@/lib/db/schema", () => ({
  tallyImportedSubmissions: { automationId: "a", submissionId: "s", state: "st", importedAt: "t" },
}));
vi.mock("drizzle-orm", () => ({
  and: (...a: unknown[]) => a,
  eq: () => 0,
  sql: Object.assign((..._a: unknown[]) => "sql", {}),
}));
vi.mock("@/lib/db", () => ({
  db: {
    insert: () => ({
      values: () => ({
        onConflictDoUpdate: (c: Record<string, unknown>) => ((h.conflict = c), { returning: async () => h.returned }),
      }),
    }),
    update: () => ({ set: () => ({ where: async () => {} }) }),
    delete: () => ({ where: async () => void (h.deletes += 1) }),
  },
}));

import { reserveSubmission, releaseSubmission, tallyResponseIdFromBody } from "../submission-claims";

beforeEach(() => {
  h.returned = [{ id: "s1" }];
  h.conflict = null;
  h.deletes = 0;
});

describe("tallyResponseIdFromBody", () => {
  it("corps de forme Tally : identifiant de réponse", () => {
    expect(tallyResponseIdFromBody({ eventType: "FORM_RESPONSE", data: { responseId: "r1" } })).toBe("r1");
  });
  it("autres webhooks : null (non réservés)", () => {
    expect(tallyResponseIdFromBody({ data: { responseId: "r1" } })).toBeNull();
    expect(tallyResponseIdFromBody({ eventType: "FORM_RESPONSE", data: {} })).toBeNull();
    expect(tallyResponseIdFromBody({ eventType: "FORM_RESPONSE", data: { responseId: "x".repeat(129) } })).toBeNull();
    expect(tallyResponseIdFromBody(null)).toBeNull();
    expect(tallyResponseIdFromBody("texte")).toBeNull();
    expect(tallyResponseIdFromBody({})).toBeNull();
  });
});

describe("reserveSubmission", () => {
  it("insertion effective : réservée", async () => {
    expect(await reserveSubmission("a", "s1", "i1")).toBe(true);
  });
  it("conflit non repris : déjà traitée, on passe", async () => {
    h.returned = [];
    expect(await reserveSubmission("a", "s1", null)).toBe(false);
  });
  it("ne reprend qu'une réservation abandonnée (clause de mise à jour conditionnelle)", async () => {
    await reserveSubmission("a", "s1", null);
    expect(h.conflict).toHaveProperty("setWhere");
    expect(h.conflict).toHaveProperty("target");
  });
});

describe("releaseSubmission", () => {
  it("supprime la réservation", async () => {
    await releaseSubmission("a", "s1");
    expect(h.deletes).toBe(1);
  });
});
