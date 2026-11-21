import { describe, it, expect, vi, beforeEach } from "vitest";

// ─── Mocks DB minimalistes (toutes les écritures sont absorbées) ────────────

const h = vi.hoisted(() => ({
  inserts: [] as unknown[],
}));

vi.mock("@/lib/db", () => ({
  db: {
    insert: () => ({
      values: vi.fn((v: unknown) => {
        h.inserts.push(v);
        return Promise.resolve(undefined);
      }),
    }),
    update: () => ({
      set: () => ({ where: vi.fn().mockResolvedValue(undefined) }),
    }),
    select: vi.fn(() => ({
      from: vi.fn().mockReturnThis(),
      innerJoin: vi.fn().mockReturnThis(),
      where: vi.fn().mockReturnThis(),
      orderBy: vi.fn().mockReturnThis(),
      limit: vi.fn().mockResolvedValue([{ organizationId: "org-x" }, { value: 0 }]),
    })),
    execute: vi.fn().mockResolvedValue([{ acquired: true }]),
  },
}));

import { executeAutomation, uuidToBigint } from "@/lib/automations/executor";

beforeEach(() => {
  h.inserts = [];
  vi.clearAllMocks();
});

describe("uuidToBigint (verrou pg_advisory_lock)", () => {
  it("est déterministe pour un UUID donné", () => {
    const u = "12345678-1234-1234-1234-123456789012";
    expect(uuidToBigint(u)).toBe(uuidToBigint(u));
  });

  it("rentre dans bigint signé (≤ 2^63 - 1)", () => {
    const MAX = (BigInt(1) << BigInt(63)) - BigInt(1);
    for (let i = 0; i < 50; i++) {
      const uuid = crypto.randomUUID();
      const n = uuidToBigint(uuid);
      expect(n >= BigInt(0)).toBe(true);
      expect(n <= MAX).toBe(true);
    }
  });

  it("UUIDs différents → bigints différents (collision rare)", () => {
    const a = uuidToBigint("aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa");
    const b = uuidToBigint("bbbbbbbb-bbbb-bbbb-bbbb-bbbbbbbbbbbb");
    expect(a).not.toBe(b);
  });
});

describe("executeAutomation — anti-SSRF webhook (R4) — validation à l'exécution", () => {
  // Ces tests vérifient que même si une URL passe au moment de la création,
  // on la re-valide à chaque exécution (cas : config patchée après coup,
  // ou base restaurée avec un payload devenu interne).

  it("rejette URL 127.0.0.1 sans toucher au quota BDD", async () => {
    const result = await executeAutomation(
      {
        id: "a1",
        databaseId: "d1",
        name: "Test",
        triggerType: "row_created",
        triggerConfig: {},
        actionType: "webhook",
        actionConfig: { url: "http://127.0.0.1:8080/" },
        enabled: true,
        lastRunAt: null,
      },
      { event: "row_created", databaseId: "d1", rowId: "r1", cells: {} }
    );
    expect(result.status).toBe("error");
    expect(result.error).toMatch(/URL refusée/);
  });

  it("rejette URL metadata.google.internal", async () => {
    const result = await executeAutomation(
      {
        id: "a2",
        databaseId: "d1",
        name: "Test",
        triggerType: "row_created",
        triggerConfig: {},
        actionType: "webhook",
        actionConfig: { url: "http://metadata.google.internal/computeMetadata/v1/" },
        enabled: true,
        lastRunAt: null,
      },
      { event: "row_created", databaseId: "d1", rowId: "r1", cells: {} }
    );
    expect(result.status).toBe("error");
    expect(result.error).toMatch(/URL refusée/);
  });

  it("rejette URL 10.x (réseau privé)", async () => {
    const result = await executeAutomation(
      {
        id: "a3",
        databaseId: "d1",
        name: "Test",
        triggerType: "row_created",
        triggerConfig: {},
        actionType: "webhook",
        actionConfig: { url: "http://10.0.0.5/x" },
        enabled: true,
        lastRunAt: null,
      },
      { event: "row_created", databaseId: "d1", rowId: "r1", cells: {} }
    );
    expect(result.status).toBe("error");
    expect(result.error).toMatch(/URL refusée/);
  });

  it("rejette URL avec config manquante", async () => {
    const result = await executeAutomation(
      {
        id: "a4",
        databaseId: "d1",
        name: "Test",
        triggerType: "row_created",
        triggerConfig: {},
        actionType: "webhook",
        actionConfig: {},
        enabled: true,
        lastRunAt: null,
      },
      { event: "row_created", databaseId: "d1", rowId: "r1", cells: {} }
    );
    expect(result.status).toBe("error");
    expect(result.error).toMatch(/URL.*manquante/);
  });
});

describe("executeAutomation — quotas (R5)", () => {
  it("skip si lastRunAt < 60s (rate-limit par automation)", async () => {
    const result = await executeAutomation(
      {
        id: "a-rate",
        databaseId: "d1",
        name: "Test",
        triggerType: "row_created",
        triggerConfig: {},
        actionType: "webhook",
        actionConfig: { url: "https://hooks.example.com/x" },
        enabled: true,
        lastRunAt: new Date(Date.now() - 30_000),
      },
      { event: "row_created", databaseId: "d1", rowId: "r1", cells: {} }
    );
    expect(result.status).toBe("skipped");
    expect(result.error).toBe("rate-limited");
  });
});
