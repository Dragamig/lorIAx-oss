import { describe, it, expect, vi, beforeEach } from "vitest";
import type { NextRequest } from "next/server";
import { z } from "zod";

const requireOrgScoped = vi.fn();
const dbLimit = vi.fn();
const insertValues = vi.fn().mockResolvedValue(undefined);
vi.mock("@/lib/auth/require-org-scoped", () => {
  class OrgScopeError extends Error {
    constructor(public response: unknown, public reason: string) {
      super(reason);
    }
  }
  return { requireOrgScoped: (...a: unknown[]) => requireOrgScoped(...a), OrgScopeError };
});
vi.mock("@/lib/db", () => ({
  db: {
    insert: () => ({ values: (...a: unknown[]) => insertValues(...a) }),
    select: () => ({ from: () => ({ where: () => ({ limit: () => dbLimit() }) }) }),
  },
}));
vi.mock("@/lib/db/schema", () => ({
  userDatabases: { id: "id", archivedAt: "archivedAt", deletedAt: "deletedAt" },
}));
vi.mock("@/lib/db/schema-ai-proposals", () => ({ aiToolCalls: {} }));

const rowWrites = vi.hoisted(() => ({ fn: vi.fn() }));
vi.mock("@/lib/databases/row-writes", () => new Proxy({}, { get: () => rowWrites.fn }));
vi.mock("@/lib/databases/row-batch", () => new Proxy({}, { get: () => rowWrites.fn }));

const createProposal = vi.fn();
const planUpdateRows = vi.fn();
const planDeleteRows = vi.fn();
const planCreateRows = vi.fn();
const planMergeDuplicates = vi.fn();
vi.mock("@/lib/ai/proposals/store", () => ({ createProposal: (...a: unknown[]) => createProposal(...a) }));
vi.mock("@/lib/ai/proposals/plan-update", () => ({ planUpdateRows: (...a: unknown[]) => planUpdateRows(...a) }));
vi.mock("@/lib/ai/proposals/plan-delete", () => ({ planDeleteRows: (...a: unknown[]) => planDeleteRows(...a) }));
vi.mock("@/lib/ai/proposals/plan-create", () => ({ planCreateRows: (...a: unknown[]) => planCreateRows(...a) }));
vi.mock("@/lib/ai/proposals/plan-merge", () => ({
  planMergeDuplicates: (...a: unknown[]) => planMergeDuplicates(...a),
}));

import { buildWriteTools } from "../write-tools";
import { ProposalPlanError } from "@/lib/ai/proposals/types";
import type { ChatToolContext } from "../context";

const ctx = {
  user: { id: "u1" },
  orgId: "org1",
  spaceIds: ["s1"],
  admin: false,
  req: {} as NextRequest,
} as unknown as ChatToolContext;
const opts = { toolCallId: "t", messages: [] } as never;
const plan = (payload: unknown, summary: string, rowCount: number) => ({
  payload,
  freshness: { rows: [] },
  summary,
  rowCount,
});

function call(name: keyof ReturnType<typeof buildWriteTools>, input: unknown) {
  const t = buildWriteTools(ctx)[name] as unknown as { execute: (i: unknown, o: never) => Promise<Record<string, unknown> & { proposalId?: string }> };
  return t.execute(input, opts);
}

beforeEach(() => {
  vi.clearAllMocks();
  requireOrgScoped.mockResolvedValue({ orgId: "org1", spaceId: "s1", permission: "editor" });
  dbLimit.mockResolvedValue([{ id: "d1" }]);
  createProposal.mockResolvedValue({ id: "p1", status: "pending", userId: "u1", orgId: "org1" });
  planUpdateRows.mockResolvedValue(plan({ type: "update_rows", changes: [] }, "Mettre à jour 1 ligne", 1));
  planDeleteRows.mockResolvedValue(plan({ type: "delete_rows", rows: [] }, "Supprimer 2 lignes", 2));
  planCreateRows.mockResolvedValue(plan({ type: "create_rows", rows: [] }, "Créer 1 ligne", 1));
  planMergeDuplicates.mockResolvedValue(
    plan(
      { type: "merge_duplicates", groups: [{ conflicts: [{}, {}] }, { conflicts: [{}], excluded: true }] },
      "Regrouper 1 groupe de doublons",
      1,
    ),
  );
});

const inputs = {
  propose_update_rows: { databaseId: "d1", modifications: [{ rowId: "r1", cells: { c1: "x" } }] },
  propose_delete_rows: { databaseId: "d1", rowIds: ["r1", "r2"] },
  propose_merge_duplicates: { databaseId: "d1", keyColumnIds: ["c1"] },
  propose_create_rows: { databaseId: "d1", rows: [{ cells: { c1: "x" } }] },
} as const;

describe("write tools", () => {
  it.each(Object.keys(inputs) as (keyof typeof inputs)[])("%s : editor crée une proposition en attente", async (name) => {
    const out = await call(name, inputs[name]);
    expect(createProposal).toHaveBeenCalledTimes(1);
    expect(createProposal.mock.calls[0][0].ctx).toBe(ctx);
    expect(createProposal.mock.calls[0][0].databaseId).toBe("d1");
    expect(out.proposalId).toBe("p1");
    expect(typeof out.proposalId).toBe("string");
    expect(out.message).toBe("Proposition créée, en attente de validation par l'utilisateur.");
    for (const w of ["supprimé", "fusionné", "appliqué"]) expect(out.message).not.toContain(w);
    expect(rowWrites.fn).not.toHaveBeenCalled();
  });

  it("merge : conflits comptés hors groupes exclus", async () => {
    const out = await call("propose_merge_duplicates", inputs.propose_merge_duplicates);
    expect(out.conflicts).toBe(2);
  });

  it.each(Object.keys(inputs) as (keyof typeof inputs)[])("%s : viewer ne crée rien, erreur générique", async (name) => {
    requireOrgScoped.mockResolvedValue({ orgId: "org1", spaceId: "s1", permission: "viewer" });
    const out = await call(name, inputs[name]);
    expect(out).toEqual({ error: "Base introuvable ou accès refusé. Rappelle list_databases pour obtenir les identifiants et recopie-les à l'identique." });
    expect(out.proposalId).toBeUndefined();
    expect(createProposal).not.toHaveBeenCalled();
  });

  it("ProposalPlanError devient { error } lisible, sans proposalId ni stack", async () => {
    planUpdateRows.mockRejectedValue(new ProposalPlanError("unknown_row", "Ligne inconnue : r9"));
    const out = await call("propose_update_rows", inputs.propose_update_rows);
    expect(out).toEqual({ error: "Ligne inconnue : r9" });
    expect(createProposal).not.toHaveBeenCalled();
    expect(insertValues.mock.calls[0][0].status).toBe("error");
  });

  it("aucun schéma d'entrée n'a de champ d'identité", () => {
    const tools = buildWriteTools(ctx);
    for (const t of Object.values(tools)) {
      const json = JSON.stringify(z.toJSONSchema((t as { inputSchema: z.core.$ZodType }).inputSchema));
      expect(json).toContain("databaseId");
      expect(json).not.toMatch(/userId|orgId|organizationId/);
    }
  });
});
