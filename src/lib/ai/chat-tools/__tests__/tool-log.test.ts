import { describe, it, expect, vi, beforeEach } from "vitest";
import type { NextRequest } from "next/server";

const insertValues = vi.fn();
vi.mock("@/lib/db", () => ({
  db: { insert: () => ({ values: (...a: unknown[]) => insertValues(...a) }) },
}));
vi.mock("@/lib/auth/require-org-scoped", () => ({
  requireOrgScoped: vi.fn(),
  OrgScopeError: class extends Error {},
}));
vi.mock("@/lib/db/schema", () => ({ userDatabases: {} }));
vi.mock("@/lib/db/schema-ai-proposals", () => ({ aiToolCalls: {} }));

import { redactToolArgs, withToolLog } from "../tool-log";
import { ToolAccessError, type ChatToolContext } from "../context";

const ctx = {
  user: { id: "u1" },
  orgId: "org1",
  spaceIds: ["s1"],
  admin: false,
  req: {} as NextRequest,
} as unknown as ChatToolContext;

beforeEach(() => {
  vi.clearAllMocks();
  insertValues.mockResolvedValue(undefined);
});

describe("redactToolArgs", () => {
  it("conserve les identifiants et limit, rédige les cellules", () => {
    const out = redactToolArgs("update_rows", {
      databaseId: "d1",
      rowIds: ["r1", "r2"],
      keyColumnIds: ["c1"],
      limit: 50,
      cellules: { c1: "secret" },
    });
    expect(out).toMatchObject({ databaseId: "d1", rowIds: ["r1", "r2"], keyColumnIds: ["c1"], limit: 50 });
    expect(JSON.stringify(out)).not.toContain("secret");
  });

  it("filtre : colonnes et opérateurs gardés, valeurs rédigées", () => {
    const out = redactToolArgs("query_rows", {
      databaseId: "d1",
      filter: { conjunction: "and", conditions: [{ columnId: "c1", operator: "contains", value: "confidentiel" }] },
    });
    expect(out.filter).toEqual({
      conjunction: "and",
      conditions: [{ columnId: "c1", operator: "contains", value: "[redacted]" }],
    });
    expect(JSON.stringify(out)).not.toContain("confidentiel");
  });

  it("ids de forme inattendue et args non objet", () => {
    expect(redactToolArgs("x", { databaseId: { evil: "secret" } })).toEqual({ databaseId: "[redacted]" });
    expect(redactToolArgs("x", null)).toEqual({});
  });
});

describe("withToolLog", () => {
  it("succès : ligne ok avec durée et proposalId", async () => {
    const run = withToolLog(ctx, "query_rows", async (_a: { databaseId: string }) => ({
      rows: [],
      proposalId: "p1",
    }));
    const r = await run({ databaseId: "d1" });
    expect(r).toEqual({ rows: [], proposalId: "p1" });
    const row = insertValues.mock.calls[0][0];
    expect(row).toMatchObject({
      orgId: "org1",
      userId: "u1",
      tool: "query_rows",
      status: "ok",
      proposalId: "p1",
      args: { databaseId: "d1" },
    });
    expect(row.durationMs).toBeGreaterThanOrEqual(0);
  });

  it("ToolAccessError : refused et erreur générique", async () => {
    const run = withToolLog(ctx, "describe_database", async (_a: { databaseId: string }) => {
      throw new ToolAccessError("not_found");
    });
    expect(await run({ databaseId: "d1" })).toEqual({ error: "Base introuvable ou accès refusé. Rappelle list_databases pour obtenir les identifiants et recopie-les à l'identique." });
    expect(insertValues.mock.calls[0][0]).toMatchObject({ status: "refused", proposalId: null });
  });

  it("autre erreur : status error, message sans détail interne", async () => {
    const spy = vi.spyOn(console, "error").mockImplementation(() => {});
    const run = withToolLog(ctx, "query_rows", async (_a: object) => {
      throw new Error("connexion postgres://user:mdp@host");
    });
    const r = (await run({})) as { error: string };
    expect(r.error).not.toContain("postgres");
    expect(insertValues.mock.calls[0][0]).toMatchObject({ status: "error" });
    expect(JSON.stringify(spy.mock.calls)).not.toContain("mdp");
    spy.mockRestore();
  });

  it("panne du journal : le résultat de l'outil est inchangé", async () => {
    const warn = vi.spyOn(console, "warn").mockImplementation(() => {});
    insertValues.mockRejectedValue(new Error("db down"));
    const run = withToolLog(ctx, "query_rows", async (_a: object) => ({ ok: true }));
    expect(await run({})).toEqual({ ok: true });
    warn.mockRestore();
  });
});

describe("withToolLog résultat logique", () => {
  it("un { error } renvoyé sans exception est journalisé en error", async () => {
    const out = await withToolLog(ctx, "t", async () => ({ error: "Ligne inconnue" }))({});
    expect(out).toEqual({ error: "Ligne inconnue" });
    expect(insertValues.mock.calls[0][0].status).toBe("error");
  });
});
