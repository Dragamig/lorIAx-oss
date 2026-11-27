import { describe, it, expect, vi, beforeEach } from "vitest";
import { NextRequest } from "next/server";

const h = vi.hoisted(() => ({
  streamText: vi.fn(),
  createChatTools: vi.fn(),
  orgId: "org-1" as string | null,
  settings: null as unknown,
  withFallback: vi.fn(),
  plain: vi.fn(),
}));

const USER = { id: "u1", email: "a@b.c", name: "A", role: "user" };

vi.mock("ai", () => ({
  streamText: h.streamText,
  convertToModelMessages: vi.fn(async () => []),
  stepCountIs: vi.fn((n: number) => ({ stepCount: n })),
}));
vi.mock("@/lib/ai/chat-tools", () => ({ createChatTools: h.createChatTools }));
vi.mock("@/lib/auth/get-user", () => ({ getSessionUser: vi.fn(async () => USER) }));
vi.mock("@/lib/ai/provider-resolver", () => ({
  getLanguageModelForUsageInOrg: h.plain,
  getLanguageModelForUsageWithFallbackInOrg: h.withFallback,
  isAnyAIProviderConfigured: vi.fn(async () => true),
}));
vi.mock("@/lib/org/get-request-org", () => ({ getRequestOrgId: vi.fn(async () => h.orgId) }));
vi.mock("@/lib/ai/quota-checker", () => ({ checkQuota: vi.fn(async () => ({ allowed: true })) }));
vi.mock("@/lib/ai/usage-logger", () => ({ logAIUsage: vi.fn() }));
vi.mock("@/lib/ai/prompt-resolver", () => ({
  getSystemPrompt: vi.fn(async () => ({ prompt: "base", versionId: "v" })),
  interpolatePrompt: vi.fn((p: string) => p),
}));
vi.mock("@/lib/ai/embeddings", () => ({
  searchSemantic: vi.fn(),
  isEmbeddingConfiguredAsync: vi.fn(async () => false),
}));
vi.mock("@/lib/ai/rerank", () => ({ rerankCandidates: vi.fn(), fetchLimitForRerank: vi.fn() }));
vi.mock("@/lib/settings/system-settings", () => ({
  getSetting: vi.fn(async () => h.settings),
  setSetting: vi.fn(),
}));
vi.mock("@/lib/db", () => ({ db: {} }));
vi.mock("@/lib/auth/check-access", () => ({
  getAccessibleSpaceIds: vi.fn(async () => ["s1"]),
  isGlobalAdmin: vi.fn(() => false),
}));
vi.mock("@/lib/rate-limit", () => ({
  checkRateLimitAsync: vi.fn(async () => ({ success: true })),
  RATE_LIMITS: { ai: {} },
}));
vi.mock("@/lib/onboarding/progress", () => ({ recordOnboardingEvent: vi.fn(async () => {}) }));
vi.mock("@/lib/ai/sanitize-content", () => ({ sanitizeRagContent: (s: string) => s }));
vi.mock("@/lib/ai/cinder/search-help-tool", () => ({ createSearchHelpTool: () => ({}) }));
vi.mock("@/lib/kb/kb", () => ({ searchKb: vi.fn(async () => []) }));
vi.mock("@/lib/modules/hooks", () => ({
  getHooks: () => ({
    help: {
      tools: () => ({ hook_tool: {} }),
      systemPromptAddendum: () => "",
      unansweredHint: () => "",
    },
  }),
}));

import { POST } from "../route";

const NAMES = [
  "list_databases",
  "describe_database",
  "query_rows",
  "find_duplicates",
  "propose_update_rows",
  "propose_delete_rows",
  "propose_merge_duplicates",
  "propose_create_rows",
];

function req() {
  return new NextRequest("http://localhost/api/ai/chat", {
    method: "POST",
    body: JSON.stringify({ messages: [{ role: "user", content: "x" }] }),
  });
}

beforeEach(() => {
  h.plain.mockReset();
  h.plain.mockResolvedValue({ languageModel: {}, providerId: "p", model: "m" });
  h.withFallback.mockReset();
  h.withFallback.mockResolvedValue({
    languageModel: {},
    providerId: "p",
    model: "m",
    usageType: "chat_database_actions",
  });
  h.streamText.mockReset();
  h.streamText.mockReturnValue({ toUIMessageStreamResponse: () => new Response("ok") });
  h.createChatTools.mockReset();
  h.createChatTools.mockImplementation(() =>
    Object.fromEntries(NAMES.map((n) => [n, {}])),
  );
  h.orgId = "org-1";
  h.settings = null;
});

describe("câblage des outils dans /api/ai/chat", () => {
  it("passe les 8 outils et stopWhen quand une organisation existe", async () => {
    const r = new NextRequest("http://localhost/api/ai/chat", {
      method: "POST",
      body: JSON.stringify({ messages: [{ role: "user", content: "x" }] }),
    });
    await POST(r);
    const arg = h.streamText.mock.calls[0][0];
    expect(Object.keys(arg.tools).sort()).toEqual([...NAMES, "search_help", "hook_tool"].sort());
    expect(arg.stopWhen).toEqual({ stepCount: 6 });
    expect(arg.system).toContain("cliquez sur Appliquer");
    expect(arg.system).not.toContain("tu n'as aucun outil");
  });

  it("construit le contexte depuis la session et la requête", async () => {
    const r = req();
    await POST(r);
    const ctx = h.createChatTools.mock.calls[0][0];
    expect(ctx.user).toEqual(USER);
    expect(ctx.orgId).toBe("org-1");
    expect(ctx.spaceIds).toEqual(["s1"]);
    expect(ctx.admin).toBe(false);
    expect(ctx.req).toBe(r);
  });

  it("sans organisation : aucun outil, règles sans outils", async () => {
    h.orgId = null;
    await POST(req());
    const arg = h.streamText.mock.calls[0][0];
    expect(Object.keys(arg.tools).sort()).toEqual(["hook_tool", "search_help"]);
    expect(arg.stopWhen).toEqual({ stepCount: 6 });
    expect(h.createChatTools).not.toHaveBeenCalled();
    expect(arg.system).toContain("tu n'as aucun outil");
  });

  it("passe le réglage résolu de l'organisation à createChatTools", async () => {
    h.settings = { proposeDeletes: false };
    await POST(req());
    expect(h.createChatTools.mock.calls[0][1]).toMatchObject({
      actionsEnabled: true,
      readDatabases: true,
      proposeUpdates: true,
      proposeDeletes: false,
    });
  });

  it("maître éteint : aucun outil, FAQ (règles sans outils), createChatTools non appelé", async () => {
    h.settings = { actionsEnabled: false, proposeUpdates: true };
    await POST(req());
    const arg = h.streamText.mock.calls[0][0];
    expect(Object.keys(arg.tools).sort()).toEqual(["hook_tool", "search_help"]);
    expect(arg.stopWhen).toEqual({ stepCount: 6 });
    expect(h.createChatTools).not.toHaveBeenCalled();
    expect(arg.system).toContain("tu n'as aucun outil");
    expect(arg.system).not.toContain("outils pour lire");
  });

  it("lecture éteinte : aucun outil, règles sans outils", async () => {
    h.settings = { readDatabases: false };
    await POST(req());
    const arg = h.streamText.mock.calls[0][0];
    expect(Object.keys(arg.tools).sort()).toEqual(["hook_tool", "search_help"]);
    expect(arg.system).toContain("tu n'as aucun outil");
  });

  it("lecture seule : outils fournis, règles de lecture seule sans promesse de proposition", async () => {
    h.settings = { proposeUpdates: false, proposeDeletes: false, proposeMerges: false, proposeCreates: false };
    await POST(req());
    const arg = h.streamText.mock.calls[0][0];
    expect(arg.tools).toBeDefined();
    expect(arg.system).toContain("lecture seule");
    expect(arg.system).not.toContain("cliquez sur Appliquer");
    expect(arg.system).not.toContain("tu n'as aucun outil");
  });

  it.each([
    ["proposeUpdates", "modifier des lignes", ["supprimer des lignes", "fusionner des doublons", "créer des lignes"]],
    ["proposeDeletes", "supprimer des lignes", ["modifier des lignes", "fusionner des doublons", "créer des lignes"]],
    ["proposeMerges", "fusionner des doublons", ["modifier des lignes", "supprimer des lignes", "créer des lignes"]],
    ["proposeCreates", "créer des lignes", ["modifier des lignes", "supprimer des lignes", "fusionner des doublons"]],
  ])("seul %s actif : les règles ne listent que « %s »", async (flag, listed, others) => {
    h.settings = {
      proposeUpdates: false,
      proposeDeletes: false,
      proposeMerges: false,
      proposeCreates: false,
      [flag]: true,
    };
    await POST(req());
    const system = h.streamText.mock.calls[0][0].system as string;
    expect(system).toContain(`proposer de ${listed}`);
    for (const o of others) expect(system).not.toContain(o);
  });

  it("outils fournis : modèle de l'usage chat_database_actions avec repli sur chat, org-scopé", async () => {
    await POST(req());
    expect(h.withFallback).toHaveBeenCalledWith("chat_database_actions", "chat", "org-1");
    expect(h.plain).not.toHaveBeenCalled();
  });

  it("aucun outil (maître éteint) : usage chat inchangé", async () => {
    h.settings = { actionsEnabled: false };
    await POST(req());
    expect(h.plain).toHaveBeenCalledWith("chat", "org-1");
    expect(h.withFallback).not.toHaveBeenCalled();
  });

  it("sans organisation : usage chat, fail-closed", async () => {
    h.orgId = null;
    await POST(req());
    expect(h.plain).toHaveBeenCalledWith("chat", null);
    expect(h.withFallback).not.toHaveBeenCalled();
  });
});
