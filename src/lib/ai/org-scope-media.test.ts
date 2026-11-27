import { describe, it, expect, vi, beforeEach } from "vitest";

const h = vi.hoisted(() => ({ rows: [] as unknown[], fail: false }));
vi.mock("@/lib/db", () => ({
  db: {
    select: () => ({
      from: () => ({
        where: () => ({
          limit: () => (h.fail ? Promise.reject(new Error("db")) : Promise.resolve(h.rows)),
        }),
      }),
    }),
  },
}));
vi.mock("@/lib/ai/provider-resolver", () => ({ instanceProviderScope: () => Promise.resolve("instance-org") }));

import { orgIdForMedia } from "./org-scope";

beforeEach(() => {
  h.rows = [];
  h.fail = false;
});

describe("orgIdForMedia", () => {
  it("rend l'organisation du média", async () => {
    h.rows = [{ organizationId: "o1" }];
    expect(await orgIdForMedia("m1")).toBe("o1");
  });
  it("média inconnu : null, jamais la portée d'instance (fermé par défaut)", async () => {
    expect(await orgIdForMedia("m1")).toBeNull();
  });
  it("identifiant absent : null", async () => {
    expect(await orgIdForMedia(null)).toBeNull();
    expect(await orgIdForMedia(undefined)).toBeNull();
  });
  it("lecture en erreur : null", async () => {
    h.fail = true;
    expect(await orgIdForMedia("m1")).toBeNull();
  });
});
