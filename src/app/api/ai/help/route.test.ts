/**
 * Route de l'assistant d'aide : le noyau ne connait pas report_bug, il fusionne
 * seulement les outils et l'addendum fournis par les hooks.
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
}));

// Le noyau ne depend pas du baril des modules : les hooks sont des doublures.
vi.mock("@/lib/modules/hooks", () => ({ getHooks: () => ({ help: h.help }) }));

vi.mock("ai", async (orig) => ({
  ...((await orig()) as object),
  streamText: h.streamText,
  convertToModelMessages: async () => [],
}));
vi.mock("@/lib/auth/get-user", () => ({
  getSessionUser: async () => ({ id: "u1", email: "u@x.test", name: "U" }),
}));
vi.mock("@/lib/ai/provider-resolver", () => ({
  isAiConfiguredForAssistant: async () => true,
  getLanguageModelForUsageInOrg: async () => ({ languageModel: {}, providerId: "p", model: "m" }),
}));
vi.mock("@/lib/org/get-request-org", () => ({ getRequestOrgId: async () => "org1" }));
vi.mock("@/lib/ai/quota-checker", () => ({ checkQuota: async () => ({ allowed: true }) }));
vi.mock("@/lib/ai/usage-logger", () => ({ logAIUsage: vi.fn() }));
vi.mock("@/lib/db", () => ({
  db: {
    select: () => ({ from: () => ({ where: () => ({ limit: async () => [] }) }) }),
  },
}));
vi.mock("@/lib/kb/kb", () => ({ searchKb: async () => [] }));
vi.mock("@/lib/db/schema-ai", () => ({ aiModelAssignments: {} }));
vi.mock("@/lib/rate-limit", () => ({
  checkRateLimitAsync: async () => ({ success: true }),
  RATE_LIMITS: { ai: {} },
}));
vi.mock("@/lib/help/settings", () => ({ isHelpAssistantEnabled: async () => true }));

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

describe("route aide IA", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    h.help.tools = () => ({});
    h.help.systemPromptAddendum = () => "";
  });

  it("help_route_exposes_report_bug_with_commercial", async () => {
    const fakeTool = { description: "x" };
    h.help.tools = () => ({ report_bug: fakeTool });
    h.help.systemPromptAddendum = () => "\n- ADDENDUM-TEST";
    const res = await POST(req());
    expect(res.status).toBe(200);
    expect(Object.keys(lastCall().tools)).toEqual(["report_bug"]);
    expect(lastCall().system).toContain("- ADDENDUM-TEST");
  });

  it("help_route_has_no_report_tool_when_neutral", async () => {
    const res = await POST(req());
    expect(res.status).toBe(200);
    expect(lastCall().tools).toEqual({});
    expect(lastCall().system).not.toContain("report_bug");
    expect(lastCall().system).not.toContain("remonter a l'equipe");
    expect(lastCall().system).toContain("N'invente jamais");
    expect(lastCall().system.toLowerCase()).not.toContain("bug");
  });

  it("help_route_source_has_no_report_bug_symbol", () => {
    const src = readFileSync(join(__dirname, "route.ts"), "utf8");
    for (const s of ["report_bug", "github-issues"]) {
      expect(src).not.toContain(s);
    }
  });
});
