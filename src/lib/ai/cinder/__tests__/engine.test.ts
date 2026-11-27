import { describe, it, expect, vi, beforeEach } from "vitest";
import { NextRequest } from "next/server";

const h = vi.hoisted(() => ({
  streamText: vi.fn(),
  createChatTools: vi.fn(),
  orgId: "org-1" as string | null,
  settings: null as unknown,
  withFallback: vi.fn(),
  plain: vi.fn(),
  searchKb: vi.fn(),
  media: vi.fn(),
  logAIUsage: vi.fn(),
  convert: vi.fn(),
  helpEnabled: true,
  rateOk: true,
  quotaOk: true,
  assistantConfigured: true,
  getAccessibleSpaceIds: vi.fn(),
}));

const USER = { id: "u1", email: "a@b.c", name: "A", role: "user" };

vi.mock("ai", () => ({
  streamText: h.streamText,
  convertToModelMessages: (...a: unknown[]) => h.convert(...a),
  stepCountIs: vi.fn((n: number) => ({ stepCount: n })),
}));
vi.mock("@/lib/ai/chat-tools", () => ({ createChatTools: h.createChatTools }));
vi.mock("@/lib/ai/cinder/search-help-tool", () => ({ createSearchHelpTool: () => ({}) }));
vi.mock("@/lib/auth/get-user", () => ({ getSessionUser: vi.fn(async () => USER) }));
vi.mock("@/lib/ai/provider-resolver", () => ({
  getLanguageModelForUsageInOrg: h.plain,
  getLanguageModelForUsageWithFallbackInOrg: h.withFallback,
  isAnyAIProviderConfigured: vi.fn(async () => true),
  isAiConfiguredForAssistant: vi.fn(async () => h.assistantConfigured),
}));
vi.mock("@/lib/help/settings", () => ({ isHelpAssistantEnabled: vi.fn(async () => h.helpEnabled) }));
vi.mock("@/lib/org/get-request-org", () => ({ getRequestOrgId: vi.fn(async () => h.orgId) }));
vi.mock("@/lib/ai/quota-checker", () => ({
  checkQuota: vi.fn(async () => (h.quotaOk ? { allowed: true } : { allowed: false, reason: "Quota atteint" })),
}));
vi.mock("@/lib/ai/usage-logger", () => ({ logAIUsage: h.logAIUsage }));
vi.mock("@/lib/ai/prompt-resolver", () => ({
  getSystemPrompt: vi.fn(async () => ({ prompt: "base {{contexte_rag}} {{contexte_additionnel}}", versionId: "v" })),
  interpolatePrompt: vi.fn((p: string, v: Record<string, string>) =>
    p.replace("{{contexte_rag}}", v.contexte_rag ?? "").replace("{{contexte_additionnel}}", v.contexte_additionnel ?? ""),
  ),
}));
vi.mock("@/lib/ai/embeddings", () => ({
  searchSemantic: vi.fn(),
  isEmbeddingConfiguredAsync: vi.fn(async () => false),
}));
vi.mock("@/lib/ai/rerank", () => ({ rerankCandidates: vi.fn(async () => []), fetchLimitForRerank: vi.fn(() => 5) }));
vi.mock("@/lib/settings/system-settings", () => ({
  getSetting: vi.fn(async () => h.settings),
  setSetting: vi.fn(),
}));
vi.mock("@/lib/kb/kb", () => ({ searchKb: (...a: unknown[]) => h.searchKb(...a) }));
vi.mock("@/lib/db", () => ({
  db: { select: () => ({ from: () => ({ where: () => ({ orderBy: () => ({ limit: async () => [] }) }) }) }) },
}));
vi.mock("@/lib/auth/check-access", () => ({
  getAccessibleSpaceIds: (...a: unknown[]) => h.getAccessibleSpaceIds(...a),
  isGlobalAdmin: vi.fn(() => false),
}));
vi.mock("@/lib/rate-limit", () => ({
  checkRateLimitAsync: vi.fn(async () => ({ success: h.rateOk })),
  RATE_LIMITS: { ai: {} },
}));
vi.mock("@/lib/onboarding/progress", () => ({ recordOnboardingEvent: vi.fn(async () => {}) }));
vi.mock("@/lib/ai/sanitize-content", () => ({ sanitizeRagContent: (s: string) => s }));
vi.mock("@/lib/modules/enablement", () => ({ isModuleActive: vi.fn(async () => true) }));
vi.mock("@/lib/media/ai/content-search", () => ({ buildMediaChatContext: h.media }));
vi.mock("@/lib/modules/hooks", () => ({
  getHooks: () => ({
    help: {
      tools: () => ({ hook_tool: {} }),
      systemPromptAddendum: () => "",
      unansweredHint: () => "",
    },
  }),
}));

import { handleCinderRequest } from "../engine";

const BASE = [
  "list_databases",
  "describe_database",
  "query_rows",
  "find_duplicates",
  "propose_update_rows",
  "propose_delete_rows",
  "propose_merge_duplicates",
  "propose_create_rows",
];

const MSG = "quelle est la politique de congés ?";
const make = (body: unknown) =>
  new NextRequest("http://localhost/api/ai/chat", { method: "POST", body: JSON.stringify(body) });
const std = () => make({ messages: [{ role: "user", content: MSG }] });
const full = (r: NextRequest = std()) => handleCinderRequest(r, { scope: "full" });
const alias = (r: NextRequest = std()) => handleCinderRequest(r, { scope: "help-alias" });
const sys = () => h.streamText.mock.calls[0][0].system as string;

beforeEach(() => {
  h.plain.mockReset().mockResolvedValue({ languageModel: {}, providerId: "p", model: "m" });
  h.withFallback
    .mockReset()
    .mockResolvedValue({ languageModel: {}, providerId: "p", model: "m", usageType: "chat_database_actions" });
  h.streamText.mockReset().mockReturnValue({ toUIMessageStreamResponse: () => new Response("ok") });
  h.createChatTools.mockReset().mockImplementation(() => Object.fromEntries(BASE.map((n) => [n, {}])));
  h.searchKb.mockReset().mockResolvedValue([]);
  h.media.mockReset().mockResolvedValue("");
  h.logAIUsage.mockReset();
  h.convert.mockReset().mockResolvedValue([]);
  h.getAccessibleSpaceIds.mockReset().mockResolvedValue(["s1"]);
  h.orgId = "org-1";
  h.settings = null;
  h.helpEnabled = true;
  h.rateOk = true;
  h.quotaOk = true;
  h.assistantConfigured = true;
});

describe("handleCinderRequest, scope full", () => {
  it("avec organisation : 8 outils, search_help, hook_tool, stopWhen", async () => {
    await full();
    const arg = h.streamText.mock.calls[0][0];
    expect(Object.keys(arg.tools).sort()).toEqual([...BASE, "search_help", "hook_tool"].sort());
    expect(arg.stopWhen).toEqual({ stepCount: 6 });
    expect(arg.system).toContain("cliquez sur Appliquer");
  });

  it("sans organisation : search_help et hook_tool seulement", async () => {
    h.orgId = null;
    await full();
    const arg = h.streamText.mock.calls[0][0];
    expect(Object.keys(arg.tools).sort()).toEqual(["hook_tool", "search_help"]);
    expect(h.createChatTools).not.toHaveBeenCalled();
    expect(arg.stopWhen).toEqual({ stepCount: 6 });
    expect(arg.system).not.toContain("cliquez sur Appliquer");
  });

  it("chat_actions coupé : mêmes clés que sans organisation, usage journalisé chat", async () => {
    h.settings = { actionsEnabled: false };
    await full();
    const arg = h.streamText.mock.calls[0][0];
    expect(Object.keys(arg.tools).sort()).toEqual(["hook_tool", "search_help"]);
    expect(h.createChatTools).not.toHaveBeenCalled();
    arg.onFinish({ usage: {} });
    expect(h.logAIUsage.mock.calls[0][0].usageType).toBe("chat");
  });

  it("KB injectée : searchKb(message, 3, user) et <product_docs>", async () => {
    h.searchKb.mockResolvedValue([{ chunkText: "Menu Réglages" }]);
    await full();
    expect(h.searchKb).toHaveBeenCalledWith(MSG, 3, "u1");
    expect(sys()).toContain("<product_docs>\nExtraits");
    expect(sys()).toContain("Menu Réglages");
  });

  it("searchKb rejeté : réponse 200 sans <product_docs>", async () => {
    h.searchKb.mockRejectedValue(new Error("boom"));
    const res = await full();
    expect(res.status).toBe(200);
    expect(sys()).not.toContain("<product_docs>\nExtraits");
  });

  it("context : ajouté au système", async () => {
    await full(make({ messages: [{ role: "user", content: MSG }], context: "/bases/x" }));
    expect(sys()).toContain("Page courante : /bases/x");
  });

  it("corps forgé avec conversationId : 400 avant streamText", async () => {
    const res = await full(make({ conversationId: "c1", messages: [{ role: "user", content: MSG }] }));
    expect(res.status).toBe(400);
    expect(h.streamText).not.toHaveBeenCalled();
  });

  it("construit le contexte des outils depuis la session", async () => {
    const r = std();
    await full(r);
    const ctx = h.createChatTools.mock.calls[0][0];
    expect(ctx).toMatchObject({ user: USER, orgId: "org-1", spaceIds: ["s1"], admin: false });
    expect(ctx.req).toBe(r);
  });

  it("journal : chat_database_actions avec outils, jamais help", async () => {
    await full();
    h.streamText.mock.calls[0][0].onFinish({ usage: { inputTokens: 1, outputTokens: 2 } });
    expect(h.logAIUsage.mock.calls[0][0]).toMatchObject({
      usageType: "chat_database_actions",
      promptVersionId: "v",
    });
  });

  it("aucun contenu dans les logs sur erreur de streamText", async () => {
    const spy = vi.spyOn(console, "error").mockImplementation(() => {});
    h.streamText.mockImplementation(() => {
      throw new Error("kaboom");
    });
    const res = await full();
    expect(res.status).toBe(500);
    expect(spy).toHaveBeenCalled();
    expect(JSON.stringify(spy.mock.calls)).not.toContain(MSG);
    spy.mockRestore();
  });
});

describe("handleCinderRequest, scope help-alias", () => {
  it("n'appelle ni outils sur les bases, ni espaces, ni médias", async () => {
    await alias();
    expect(h.createChatTools).not.toHaveBeenCalled();
    expect(h.getAccessibleSpaceIds).not.toHaveBeenCalled();
    expect(h.media).not.toHaveBeenCalled();
    const arg = h.streamText.mock.calls[0][0];
    expect(Object.keys(arg.tools).sort()).toEqual(["hook_tool", "search_help"]);
    expect(arg.stopWhen).toEqual({ stepCount: 6 });
    expect(h.plain).toHaveBeenCalledWith("chat", "org-1");
  });

  it("ignore le context", async () => {
    await alias(make({ messages: [{ role: "user", content: MSG }], context: "/bases/x" }));
    expect(sys()).not.toContain("Page courante");
  });

  it("assistant coupé : 403 JSON disabled", async () => {
    h.helpEnabled = false;
    const res = await alias();
    expect(res.status).toBe(403);
    expect(await res.json()).toEqual({ disabled: true, error: "Assistant d'aide désactivé" });
  });

  it("débit refusé : 429 texte", async () => {
    h.rateOk = false;
    const res = await alias();
    expect(res.status).toBe(429);
    expect(await res.text()).toContain("Trop de requêtes");
  });

  it("quota refusé : 429 JSON", async () => {
    h.quotaOk = false;
    const res = await alias();
    expect(res.status).toBe(429);
    expect(await res.json()).toEqual({ error: "Quota atteint" });
  });

  it("corps vide : 400 Messages array required", async () => {
    const res = await alias(make({ messages: [] }));
    expect(res.status).toBe(400);
    expect(await res.text()).toBe("Messages array required");
  });

  it("assistant non configuré : 503", async () => {
    h.assistantConfigured = false;
    const res = await alias();
    expect(res.status).toBe(503);
  });

  it("journal : jamais help", async () => {
    await alias();
    h.streamText.mock.calls[0][0].onFinish({ usage: {} });
    expect(h.logAIUsage.mock.calls[0][0].usageType).toBe("chat");
  });
});
