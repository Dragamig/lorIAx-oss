/**
 * Alias /api/ai/help : delegue au moteur Cinder (scope help-alias). Le noyau ne
 * connait pas report_bug, il fusionne seulement les outils et l'addendum des hooks.
 */
import { describe, it, expect, vi, beforeEach } from "vitest";
import { readFileSync } from "node:fs";
import { join } from "node:path";

const h = vi.hoisted(() => ({
  streamText: vi.fn((_opts: unknown) => ({
    toUIMessageStreamResponse: () => new Response("ok", { status: 200 }),
  })),
  help: {
    tools: (_user: unknown) => ({}) as Record<string, unknown>,
    systemPromptAddendum: (): string => "",
    unansweredHint: (): string => "",
  },
  user: { id: "u1", email: "u@x.test", name: "U" } as { id: string } | null,
  helpEnabled: true,
  rateOk: true,
  configured: true,
  quotaOk: true,
  createChatTools: vi.fn(),
}));

// Le noyau ne depend pas du baril des modules : les hooks sont des doublures.
vi.mock("@/lib/modules/hooks", () => ({ getHooks: () => ({ help: h.help }) }));

vi.mock("ai", async (orig) => ({
  ...((await orig()) as object),
  streamText: h.streamText,
  convertToModelMessages: async () => [],
}));
vi.mock("@/lib/ai/chat-tools", () => ({ createChatTools: h.createChatTools }));
vi.mock("@/lib/ai/cinder/search-help-tool", () => ({
  createSearchHelpTool: () => ({ description: "search_help" }),
}));
vi.mock("@/lib/auth/get-user", () => ({ getSessionUser: async () => h.user }));
vi.mock("@/lib/ai/provider-resolver", () => ({
  isAnyAIProviderConfigured: async () => true,
  isAiConfiguredForAssistant: async () => h.configured,
  getLanguageModelForUsageInOrg: async () => ({ languageModel: {}, providerId: "p", model: "m" }),
  getLanguageModelForUsageWithFallbackInOrg: async () => ({ languageModel: {}, providerId: "p", model: "m" }),
}));
vi.mock("@/lib/org/get-request-org", () => ({ getRequestOrgId: async () => "org1" }));
vi.mock("@/lib/ai/quota-checker", () => ({
  checkQuota: async () => (h.quotaOk ? { allowed: true } : { allowed: false, reason: "Quota atteint" }),
}));
vi.mock("@/lib/ai/usage-logger", () => ({ logAIUsage: vi.fn() }));
vi.mock("@/lib/ai/prompt-resolver", () => ({
  getSystemPrompt: async () => ({ prompt: "base {{contexte_rag}} {{contexte_additionnel}}", versionId: "v" }),
  interpolatePrompt: (p: string, v: Record<string, string>) =>
    p.replace("{{contexte_rag}}", v.contexte_rag ?? "").replace("{{contexte_additionnel}}", v.contexte_additionnel ?? ""),
}));
vi.mock("@/lib/ai/embeddings", () => ({
  searchSemantic: vi.fn(),
  isEmbeddingConfiguredAsync: async () => false,
}));
vi.mock("@/lib/ai/rerank", () => ({ rerankCandidates: async () => [], fetchLimitForRerank: () => 5 }));
vi.mock("@/lib/settings/system-settings", () => ({ getSetting: async () => null, setSetting: vi.fn() }));
vi.mock("@/lib/db", () => ({
  db: {
    select: () => ({
      from: () => ({ where: () => ({ orderBy: () => ({ limit: async () => [] }), limit: async () => [] }) }),
    }),
  },
}));
vi.mock("@/lib/auth/check-access", () => ({
  getAccessibleSpaceIds: async () => [],
  isGlobalAdmin: () => false,
}));
vi.mock("@/lib/kb/kb", () => ({ searchKb: async () => [] }));
vi.mock("@/lib/onboarding/progress", () => ({ recordOnboardingEvent: async () => {} }));
vi.mock("@/lib/ai/sanitize-content", () => ({ sanitizeRagContent: (s: string) => s }));
vi.mock("@/lib/modules/enablement", () => ({ isModuleActive: async () => true }));
vi.mock("@/lib/media/ai/content-search", () => ({ buildMediaChatContext: async () => "" }));
vi.mock("@/lib/rate-limit", () => ({
  checkRateLimitAsync: async () => ({ success: h.rateOk }),
  RATE_LIMITS: { ai: {} },
}));
vi.mock("@/lib/help/settings", () => ({ isHelpAssistantEnabled: async () => h.helpEnabled }));

import { NextRequest } from "next/server";
import { POST } from "./route";

function req() {
  return new NextRequest("http://localhost/api/ai/help", {
    method: "POST",
    body: JSON.stringify({ messages: [{ role: "user", parts: [{ type: "text", text: "Bonjour" }] }] }),
  });
}

function lastCall() {
  const calls = h.streamText.mock.calls;
  return calls[calls.length - 1][0] as { system: string; tools: Record<string, unknown> };
}

describe("alias /api/ai/help", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    h.help.tools = () => ({});
    h.help.systemPromptAddendum = () => "";
    h.user = { id: "u1" };
    h.helpEnabled = true;
    h.rateOk = true;
    h.configured = true;
    h.quotaOk = true;
  });

  it("help_route_exposes_report_bug_with_commercial", async () => {
    h.help.tools = () => ({ report_bug: { description: "x" } });
    h.help.systemPromptAddendum = () => "\n- ADDENDUM-TEST";
    const res = await POST(req());
    expect(res.status).toBe(200);
    expect(Object.keys(lastCall().tools).sort()).toEqual(["report_bug", "search_help"]);
    expect(lastCall().system).toContain("- ADDENDUM-TEST");
  });

  it("help_route_has_no_report_tool_when_neutral", async () => {
    const res = await POST(req());
    expect(res.status).toBe(200);
    expect(Object.keys(lastCall().tools)).toEqual(["search_help"]);
    expect(h.createChatTools).not.toHaveBeenCalled();
    expect(lastCall().system).not.toContain("report_bug");
    expect(lastCall().system).not.toContain("remonter a l'equipe");
    expect(lastCall().system.toLowerCase()).not.toContain("bug");
  });

  it("help_route_never_reads_help_assignment", () => {
    const src = readFileSync(join(__dirname, "route.ts"), "utf8");
    for (const s of ["aiModelAssignments", 'usageType "help"', '"help"', "report_bug", "github-issues"]) {
      expect(src).not.toContain(s);
    }
  });

  it("help_route_is_thin", () => {
    const src = readFileSync(join(__dirname, "route.ts"), "utf8");
    expect(src.split("\n").length).toBeLessThan(30);
  });

  it("garde les statuts de l'ancienne route", async () => {
    h.user = null;
    expect((await POST(req())).status).toBe(401);
    h.user = { id: "u1" };
    h.helpEnabled = false;
    const off = await POST(req());
    expect(off.status).toBe(403);
    expect(await off.json()).toEqual({ disabled: true, error: "Assistant d'aide désactivé" });
    h.helpEnabled = true;
    h.rateOk = false;
    expect((await POST(req())).status).toBe(429);
    h.rateOk = true;
    h.configured = false;
    expect((await POST(req())).status).toBe(503);
  });
});
