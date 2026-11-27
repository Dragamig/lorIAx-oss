import { describe, it, expect, vi, beforeEach } from "vitest";

const captured: { where?: unknown; limit?: number } = {};
let rows: unknown[] = [];

vi.mock("@/lib/db", () => ({
  db: {
    select: () => ({
      from: () => ({
        where: (w: unknown) => {
          captured.where = w;
          return {
            orderBy: () => ({
              limit: (n: number) => {
                captured.limit = n;
                return Promise.resolve(rows);
              },
            }),
          };
        },
      }),
    }),
  },
}));
vi.mock("../tool-log", () => ({ withToolLog: (_c: unknown, _n: string, fn: unknown) => fn }));

import { buildMailTools } from "../mail-tools";

const ctx = { user: { id: "u1" }, orgId: "o1", spaceIds: [], admin: false } as never;
type Exec = (args: Record<string, unknown>) => Promise<{ mails: Record<string, unknown>[]; truncated: boolean }>;
const exec = () => (buildMailTools(ctx).list_my_mails as unknown as { execute: Exec }).execute;

/** Rassemble les valeurs liées d'une condition drizzle (sans dépendre de sa forme interne). */
function boundValues(node: unknown, acc: unknown[] = [], seen = new Set<unknown>()): unknown[] {
  if (node === null || typeof node !== "object" || seen.has(node)) return acc;
  seen.add(node);
  const n = node as Record<string, unknown>;
  if ("value" in n && (typeof n.value === "string" || typeof n.value === "number")) acc.push(n.value);
  for (const v of Object.values(n)) {
    if (Array.isArray(v)) v.forEach((x) => boundValues(x, acc, seen));
    else if (v && typeof v === "object") boundValues(v, acc, seen);
  }
  return acc;
}

describe("list_my_mails", () => {
  beforeEach(() => {
    rows = [];
    captured.where = undefined;
  });

  it("filtre sur l'utilisateur et l'organisation de la session, jamais sur un argument", async () => {
    await exec()({ search: "sennani" });
    const values = boundValues(captured.where);
    expect(values).toContain("u1");
    expect(values).toContain("o1");
    expect(values).toContain("out");
  });

  it("plafonne la limite à 20", async () => {
    await exec()({ limit: 500 });
    expect(captured.limit).toBe(20);
  });

  it("rend un statut lisible, la trace et l'erreur de remise incertaine", async () => {
    rows = [
      {
        subject: "Devis", to: ["yanis@example.com"], cc: [], status: "sent",
        scheduledAt: null, sentAt: new Date("2026-11-25T10:00:00Z"), createdAt: new Date("2026-11-25T09:59:50Z"),
        lastError: null, interactionRowId: "r1",
      },
      {
        subject: "Relance", to: ["a@example.com"], cc: [], status: "failed",
        scheduledAt: null, sentAt: null, createdAt: new Date("2026-11-25T08:00:00Z"),
        lastError: "delivery_unknown", interactionRowId: null,
      },
    ];
    const out = await exec()({});
    expect(out.mails[0]).toMatchObject({ status: "envoyé", tracedInInteractions: true, error: null });
    expect(out.mails[1].status).toBe("échec");
    expect(String(out.mails[1].error)).toMatch(/Envoyés/);
    expect(out.mails[1].tracedInInteractions).toBe(false);
  });
});
