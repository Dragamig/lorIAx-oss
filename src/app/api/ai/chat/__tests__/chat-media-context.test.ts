import { describe, it, expect, vi, beforeEach } from "vitest";
import { NextRequest } from "next/server";

const h = vi.hoisted(() => ({
  streamText: vi.fn(),
  media: vi.fn(),
  moduleActive: true,
  orgId: "org-1" as string | null,
}));

const USER = { id: "u1", email: "a@b.c", name: "A", role: "user" };

vi.mock("ai", () => ({
  streamText: h.streamText,
  convertToModelMessages: vi.fn(async () => []),
  stepCountIs: vi.fn((n: number) => ({ stepCount: n })),
}));
vi.mock("@/lib/ai/chat-tools", () => ({ createChatTools: vi.fn(() => ({})) }));
vi.mock("@/lib/auth/get-user", () => ({ getSessionUser: vi.fn(async () => USER) }));
vi.mock("@/lib/ai/provider-resolver", () => ({
  getLanguageModelForUsageInOrg: vi.fn(async () => ({ languageModel: {}, providerId: "p", model: "m" })),
  getLanguageModelForUsageWithFallbackInOrg: vi.fn(async () => ({ languageModel: {}, providerId: "p", model: "m", usageType: "chat_database_actions" })),
  isAnyAIProviderConfigured: vi.fn(async () => true),
}));
vi.mock("@/lib/org/get-request-org", () => ({ getRequestOrgId: vi.fn(async () => h.orgId) }));
vi.mock("@/lib/ai/quota-checker", () => ({ checkQuota: vi.fn(async () => ({ allowed: true })) }));
vi.mock("@/lib/ai/usage-logger", () => ({ logAIUsage: vi.fn() }));
vi.mock("@/lib/ai/prompt-resolver", () => ({
  getSystemPrompt: vi.fn(async () => ({ prompt: "base {{contexte_rag}}", versionId: "v" })),
  interpolatePrompt: vi.fn((p: string, v: Record<string, string>) => p.replace("{{contexte_rag}}", v.contexte_rag ?? "")),
}));
vi.mock("@/lib/ai/embeddings", () => ({ searchSemantic: vi.fn(), isEmbeddingConfiguredAsync: vi.fn(async () => false) }));
vi.mock("@/lib/ai/rerank", () => ({ rerankCandidates: vi.fn(async () => []), fetchLimitForRerank: vi.fn(() => 5) }));
vi.mock("@/lib/settings/system-settings", () => ({ getSetting: vi.fn(async () => null), setSetting: vi.fn() }));
vi.mock("@/lib/ai/cinder/search-help-tool", () => ({ createSearchHelpTool: () => ({}) }));
vi.mock("@/lib/kb/kb", () => ({ searchKb: vi.fn(async () => []) }));
vi.mock("@/lib/modules/hooks", () => ({
  getHooks: () => ({
    help: { tools: () => ({}), systemPromptAddendum: () => "", unansweredHint: () => "" },
  }),
}));
vi.mock("@/lib/db", () => ({
  db: { select: () => ({ from: () => ({ where: () => ({ orderBy: () => ({ limit: async () => [] }) }) }) }) },
}));
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
vi.mock("@/lib/modules/enablement", () => ({ isModuleActive: vi.fn(async () => h.moduleActive) }));
vi.mock("@/lib/media/ai/content-search", () => ({ buildMediaChatContext: h.media }));

import { POST } from "../route";

const req = () =>
  new NextRequest("http://localhost/api/ai/chat", {
    method: "POST",
    body: JSON.stringify({ messages: [{ role: "user", content: "quel préavis de résiliation ?" }] }),
  });

beforeEach(() => {
  h.streamText.mockReset().mockReturnValue({ toUIMessageStreamResponse: () => new Response("ok") });
  h.media.mockReset().mockResolvedValue("<media_context>extrait</media_context>");
  h.moduleActive = true;
  h.orgId = "org-1";
});

describe("/api/ai/chat : médias", () => {
  it("injecte le contexte média, sous l'identité de la session et l'organisation de la requête", async () => {
    await POST(req());
    expect(h.media).toHaveBeenCalledWith(USER, "org-1", "quel préavis de résiliation ?");
    expect(h.streamText.mock.calls[0][0].system).toContain("<media_context>extrait</media_context>");
  });

  it("sans contexte lisible (média illisible ou indexation désactivée) : rien n'est injecté", async () => {
    h.media.mockResolvedValue("");
    await POST(req());
    expect(h.streamText.mock.calls[0][0].system).not.toContain("media_context");
  });

  it("sans organisation ou module inactif : aucune recherche de média", async () => {
    h.orgId = null;
    await POST(req());
    h.moduleActive = false;
    h.orgId = "org-1";
    await POST(req());
    expect(h.media).not.toHaveBeenCalled();
  });

  it("une panne du contexte média ne casse pas le chat", async () => {
    h.media.mockRejectedValue(new Error("boom"));
    const res = await POST(req());
    expect(res.status).toBe(200);
    expect(h.streamText.mock.calls[0][0].system).not.toContain("media_context");
  });
});
