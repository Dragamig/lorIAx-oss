import { beforeEach, describe, expect, it, vi } from "vitest";

const generateObject = vi.fn();
vi.mock("ai", () => ({ generateObject: (...a: unknown[]) => generateObject(...a) }));
const resolve = vi.fn();
vi.mock("@/lib/ai/provider-resolver", () => ({
  getLanguageModelForUsageWithFallbackInOrg: (...a: unknown[]) => resolve(...a),
}));
const logAIUsage = vi.fn();
vi.mock("@/lib/ai/usage-logger", () => ({ logAIUsage: (...a: unknown[]) => logAIUsage(...a) }));
const isQuotaExceeded = vi.fn();
vi.mock("@/lib/rate-limit", () => ({ isQuotaExceeded: (...a: unknown[]) => isQuotaExceeded(...a) }));

import { enrichPresentation } from "../enrich";
import type { PresentationProposal } from "../schemas";

const plan: PresentationProposal = {
  spaceId: "11111111-1111-4111-8111-111111111111",
  title: "Deck",
  slides: [{ title: "Intro" }, { title: "Fin" }],
};
const ctx = { orgId: "org", userId: "user" };

describe("enrichPresentation", () => {
  beforeEach(() => {
    generateObject.mockReset();
    logAIUsage.mockReset();
    isQuotaExceeded.mockReset().mockResolvedValue(false);
    resolve.mockReset().mockResolvedValue({
      languageModel: {}, providerId: "p", model: "m", usageType: "chat",
    });
  });

  it("sortie hors schéma rejetée puis repli sur le plan", async () => {
    generateObject.mockResolvedValue({ object: { slides: [{ title: "" }] }, usage: {} });
    expect(await enrichPresentation(plan, ctx)).toEqual(plan);
  });

  it("plafonne à 12 diapositives", async () => {
    const slides = Array.from({ length: 20 }, (_, i) => ({ title: `S${i}`, bullets: ["a"] }));
    generateObject.mockResolvedValue({ object: { slides }, usage: {} });
    const r = await enrichPresentation(plan, ctx);
    expect(r.slides).toHaveLength(12);
    expect(r.slides[0].bullets).toEqual(["a"]);
  });

  it("journalise l'usage réellement retenu", async () => {
    resolve.mockResolvedValue({ languageModel: {}, providerId: "p", model: "m", usageType: "creation" });
    generateObject.mockResolvedValue({ object: { slides: [{ title: "A" }] }, usage: { inputTokens: 3, outputTokens: 4 } });
    await enrichPresentation(plan, ctx);
    expect(resolve).toHaveBeenCalledWith("creation", "chat", "org");
    expect(logAIUsage).toHaveBeenCalledWith(
      expect.objectContaining({ usageType: "creation", userId: "user", status: "success", tokensIn: 3, tokensOut: 4 }),
    );
  });

  it("quota épuisé : plan seul, aucun appel au modèle", async () => {
    isQuotaExceeded.mockResolvedValue(true);
    expect(await enrichPresentation(plan, ctx)).toEqual(plan);
    expect(generateObject).not.toHaveBeenCalled();
  });

  it("modèle en échec ou absent : plan seul", async () => {
    generateObject.mockRejectedValue(new Error("boom"));
    expect(await enrichPresentation(plan, ctx)).toEqual(plan);
    resolve.mockRejectedValue(new Error("no model"));
    expect(await enrichPresentation(plan, ctx)).toEqual(plan);
  });
});
