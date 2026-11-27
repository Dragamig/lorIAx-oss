import { describe, it, expect, vi, beforeEach } from "vitest";

const withFallback = vi.fn();
const plain = vi.fn();

vi.mock("@/lib/ai/provider-resolver", () => ({
  getLanguageModelForUsageInOrg: (...a: unknown[]) => plain(...a),
  getLanguageModelForUsageWithFallbackInOrg: (...a: unknown[]) => withFallback(...a),
}));

import { resolveCinderModel } from "../model";

beforeEach(() => {
  plain.mockReset().mockResolvedValue({ languageModel: {}, providerId: "p", model: "m" });
  withFallback
    .mockReset()
    .mockResolvedValue({ languageModel: {}, providerId: "p", model: "m", usageType: "chat_database_actions" });
});

describe("resolveCinderModel", () => {
  it("outils autorisés : usage chat_database_actions avec repli chat", async () => {
    const r = await resolveCinderModel({ toolsAllowed: true, orgId: "org-1" });
    expect(withFallback).toHaveBeenCalledWith("chat_database_actions", "chat", "org-1");
    expect(plain).not.toHaveBeenCalled();
    expect(r.usageType).toBe("chat_database_actions");
  });
  it("repli effectif sur chat journalisé comme chat", async () => {
    withFallback.mockResolvedValue({ languageModel: {}, providerId: "p", model: "m", usageType: "chat" });
    const r = await resolveCinderModel({ toolsAllowed: true, orgId: "org-1" });
    expect(r.usageType).toBe("chat");
  });
  it("sans outils : usage chat", async () => {
    const r = await resolveCinderModel({ toolsAllowed: false, orgId: null });
    expect(plain).toHaveBeenCalledWith("chat", null);
    expect(withFallback).not.toHaveBeenCalled();
    expect(r).toMatchObject({ providerId: "p", model: "m", usageType: "chat" });
  });
  it("jamais l'usage help", async () => {
    await resolveCinderModel({ toolsAllowed: true, orgId: "o" });
    await resolveCinderModel({ toolsAllowed: false, orgId: "o" });
    for (const c of [...plain.mock.calls, ...withFallback.mock.calls]) {
      expect(c).not.toContain("help");
    }
  });
});
