/**
 * POST /api/admin/ai/providers/test : forme `{ providerId, model }`.
 * La clé est déchiffrée côté serveur, la portée est celle de `resolveProviderScope`.
 */
import { describe, it, expect, vi, beforeEach } from "vitest";
import { NextRequest, NextResponse } from "next/server";

const h = vi.hoisted(() => ({
  getSessionUser: vi.fn(),
  generateText: vi.fn(),
  resolveScope: vi.fn(),
  dbRows: [] as unknown[],
  openaiOpts: [] as Array<{ baseURL?: string; apiKey?: string }>,
}));

vi.mock("server-only", () => ({}));
vi.mock("@/lib/auth/get-user", () => ({ getSessionUser: h.getSessionUser }));
vi.mock("ai", () => ({ generateText: h.generateText }));
vi.mock("@ai-sdk/anthropic", () => ({ createAnthropic: () => ({ languageModel: () => ({}) }) }));
vi.mock("@ai-sdk/mistral", () => ({ createMistral: () => ({ languageModel: () => ({}) }) }));
vi.mock("@ai-sdk/openai", () => ({
  createOpenAI: (o: { baseURL?: string; apiKey?: string }) => {
    h.openaiOpts.push(o);
    return { chat: () => ({}) };
  },
}));
vi.mock("@/lib/crypto", () => ({ decrypt: (v: string) => `clair:${v}` }));
vi.mock("@/lib/db", () => ({
  db: {
    select: () => ({
      from: () => ({ where: () => ({ limit: () => Promise.resolve(h.dbRows) }) }),
    }),
  },
}));
vi.mock("@/lib/db/schema", () => ({ aiProviders: { id: "id" } }));
vi.mock("@/app/api/admin/ai/providers/scope", () => ({
  resolveProviderScope: h.resolveScope,
}));

import { POST } from "@/app/api/admin/ai/providers/test/route";

const req = (body: unknown) =>
  new NextRequest("http://app.example.com/api/admin/ai/providers/test", {
    method: "POST",
    body: JSON.stringify(body),
    headers: { "Content-Type": "application/json" },
  });

beforeEach(() => {
  vi.clearAllMocks();
  h.openaiOpts.length = 0;
  h.getSessionUser.mockResolvedValue({ id: "s1", globalRole: "super_admin" });
  h.resolveScope.mockResolvedValue({ ok: true, provider: { id: "p1", organizationId: null }, orgId: "o1" });
  h.dbRows = [{ id: "p1", connectorType: "openai_compatible", apiBaseUrl: "http://gw:11434/v1", apiKeyEnc: "chiffre" }];
  h.generateText.mockResolvedValue({ text: "OK" });
});

describe("POST /api/admin/ai/providers/test (providerId)", () => {
  it("refuse un non super_admin", async () => {
    h.getSessionUser.mockResolvedValue({ id: "a1", globalRole: "admin" });
    const res = await POST(req({ providerId: "p1", model: "m" }));
    expect(res.status).toBe(403);
    expect(h.generateText).not.toHaveBeenCalled();
  });

  it("répond 404 hors portée sans émettre de requête", async () => {
    h.resolveScope.mockResolvedValue({
      ok: false,
      response: NextResponse.json({ error: "Fournisseur introuvable" }, { status: 404 }),
    });
    const res = await POST(req({ providerId: "autre", model: "m" }));
    expect(res.status).toBe(404);
    expect(h.generateText).not.toHaveBeenCalled();
  });

  it("teste avec la clé déchiffrée sans la renvoyer", async () => {
    const res = await POST(req({ providerId: "p1", model: "m" }));
    const text = await res.text();
    expect(res.status).toBe(200);
    expect(JSON.parse(text).success).toBe(true);
    expect(h.openaiOpts[0]).toMatchObject({ baseURL: "http://gw:11434/v1", apiKey: "clair:chiffre" });
    expect(text).not.toContain("clair:chiffre");
    expect(text).not.toContain("chiffre");
  });

  it("accepte toujours l'ancien corps", async () => {
    const res = await POST(
      req({ connectorType: "openai_compatible", apiBaseUrl: "http://x/v1", apiKey: "k", model: "m" })
    );
    expect(res.status).toBe(200);
    expect(h.resolveScope).not.toHaveBeenCalled();
    expect(h.openaiOpts[0]).toMatchObject({ apiKey: "k" });
  });
});
