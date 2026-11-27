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
  userDatabases: {},
  documents: { id: "id", spaceId: "spaceId" },
}));
vi.mock("@/lib/db/schema-ai-proposals", () => ({ aiToolCalls: {} }));

const createCreationProposal = vi.fn();
const countPending = vi.fn();
const enrichPresentation = vi.fn();
vi.mock("@/lib/ai/creation/store", () => ({
  createCreationProposal: (...a: unknown[]) => createCreationProposal(...a),
  countPendingCreationProposals: (...a: unknown[]) => countPending(...a),
}));
vi.mock("@/lib/ai/creation/enrich", () => ({
  enrichPresentation: (...a: unknown[]) => enrichPresentation(...a),
}));

import { buildCreateTools } from "../create-tools";
import { PROPOSAL_PENDING_MESSAGE } from "../write-tools";
import { OrgScopeError } from "@/lib/auth/require-org-scoped";
import { ALL_ON_CHAT_ACTIONS } from "@/lib/ai/chat-actions-settings";
import type { ChatToolContext } from "../context";

const ctx = {
  user: { id: "u1" },
  orgId: "org1",
  spaceIds: [],
  admin: false,
  req: {} as NextRequest,
} as unknown as ChatToolContext;
const opts = { toolCallId: "t", messages: [] } as never;
const SPACE = "11111111-1111-4111-8111-111111111111";
const PARENT = "22222222-2222-4222-8222-222222222222";

const sheet = { spaceId: SPACE, title: "T", columns: [{ name: "A" }] };
const doc = { spaceId: SPACE, title: "D", outline: [{ heading: "H", level: 1 as const }] };
const deck = { spaceId: SPACE, title: "P", slides: [{ title: "S" }] };

type Exec = (a: unknown, o: never) => Promise<Record<string, unknown>>;
const run = (tools: Record<string, unknown>, name: string, args: unknown) =>
  (tools[name] as { execute: Exec }).execute(args, opts);

beforeEach(() => {
  vi.clearAllMocks();
  requireOrgScoped.mockResolvedValue({ orgId: "org1", spaceId: SPACE, permission: "editor" });
  createCreationProposal.mockResolvedValue({ id: "prop1" });
  countPending.mockResolvedValue(0);
  enrichPresentation.mockImplementation(async (p: unknown) => p);
  dbLimit.mockResolvedValue([{ id: PARENT }]);
});

describe("outils propose_create_*", () => {
  it("enregistre une proposition et renvoie le message d'attente", async () => {
    const t = buildCreateTools(ctx, ALL_ON_CHAT_ACTIONS);
    for (const [name, args, kind] of [
      ["propose_create_spreadsheet", sheet, "spreadsheet"],
      ["propose_create_document", doc, "document"],
      ["propose_create_presentation", deck, "presentation"],
    ] as const) {
      const r = await run(t, name, args);
      expect(r).toMatchObject({ proposalId: "prop1", message: PROPOSAL_PENDING_MESSAGE });
      expect(createCreationProposal).toHaveBeenLastCalledWith(
        expect.objectContaining({ orgId: "org1", userId: "u1", spaceId: SPACE, kind }),
      );
    }
    expect(enrichPresentation).toHaveBeenCalledTimes(1);
    const docCall = createCreationProposal.mock.calls[1][0];
    expect(docCall.payload).not.toHaveProperty("visibility");
  });

  it("20 propositions pending : refus clair, rien d'enregistré", async () => {
    countPending.mockResolvedValue(20);
    const t = buildCreateTools(ctx, ALL_ON_CHAT_ACTIONS);
    for (const [name, args] of [
      ["propose_create_spreadsheet", sheet],
      ["propose_create_document", doc],
      ["propose_create_presentation", deck],
    ] as const) {
      const r = await run(t, name, args);
      expect(r).toHaveProperty("error");
      expect(String(r.error)).toMatch(/20/);
    }
    expect(createCreationProposal).not.toHaveBeenCalled();
    expect(countPending).toHaveBeenCalledWith("org1", "u1");
  });

  it("19 propositions pending : accepté", async () => {
    countPending.mockResolvedValue(19);
    const r = await run(buildCreateTools(ctx, ALL_ON_CHAT_ACTIONS), "propose_create_spreadsheet", sheet);
    expect(r).toMatchObject({ proposalId: "prop1" });
  });

  it("espace où l'utilisateur est lecteur : refusé, rien d'enregistré", async () => {
    requireOrgScoped.mockResolvedValue({ orgId: "org1", spaceId: SPACE, permission: "viewer" });
    const r = await run(buildCreateTools(ctx, ALL_ON_CHAT_ACTIONS), "propose_create_spreadsheet", sheet);
    expect(r).toHaveProperty("error");
    expect(createCreationProposal).not.toHaveBeenCalled();
  });

  it("espace d'une autre org : même message qu'un espace inconnu", async () => {
    const t = buildCreateTools(ctx, ALL_ON_CHAT_ACTIONS);
    requireOrgScoped.mockRejectedValue(new OrgScopeError({} as never, "resource-not-found"));
    const unknown = await run(t, "propose_create_document", doc);
    requireOrgScoped.mockResolvedValue({ orgId: "autre", spaceId: SPACE, permission: "editor" });
    const other = await run(t, "propose_create_document", doc);
    requireOrgScoped.mockRejectedValue(new OrgScopeError({} as never, "permission-denied"));
    const denied = await run(t, "propose_create_document", doc);
    expect(unknown.error).toBeTruthy();
    expect(other).toEqual(unknown);
    expect(denied).toEqual(unknown);
    expect(createCreationProposal).not.toHaveBeenCalled();
  });

  it("parentId d'un autre espace : refusé", async () => {
    dbLimit.mockResolvedValue([]);
    const r = await run(buildCreateTools(ctx, ALL_ON_CHAT_ACTIONS), "propose_create_document", {
      ...doc,
      parentId: PARENT,
    });
    expect(r).toHaveProperty("error");
    expect(createCreationProposal).not.toHaveBeenCalled();
  });

  it("schémas d'arguments sans identité utilisateur ni organisation", () => {
    const t = buildCreateTools(ctx, ALL_ON_CHAT_ACTIONS) as Record<string, { inputSchema: z.ZodObject<z.ZodRawShape> }>;
    for (const name of Object.keys(t)) {
      const keys = Object.keys(t[name].inputSchema.shape);
      expect(keys).not.toEqual(expect.arrayContaining(["userId"]));
      expect(keys).not.toEqual(expect.arrayContaining(["orgId"]));
      expect(keys).toContain("spaceId");
    }
  });

  it("outil absent si son interrupteur est éteint", () => {
    const names = (o: object) => Object.keys(buildCreateTools(ctx, { ...ALL_ON_CHAT_ACTIONS, ...o })).sort();
    expect(names({})).toEqual(["propose_create_document", "propose_create_presentation", "propose_create_spreadsheet"]);
    expect(names({ proposeSpreadsheets: false })).not.toContain("propose_create_spreadsheet");
    expect(names({ proposeDocuments: false })).not.toContain("propose_create_document");
    expect(names({ proposePresentations: false })).not.toContain("propose_create_presentation");
  });
});
