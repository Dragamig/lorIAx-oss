import { beforeEach, describe, expect, it, vi } from "vitest";

const generateObject = vi.fn();
vi.mock("ai", () => ({ generateObject: (...a: unknown[]) => generateObject(...a) }));
vi.mock("@/lib/ai/provider-resolver", () => ({
  getLanguageModelForUsageInOrg: vi.fn().mockResolvedValue({ languageModel: {}, providerId: "p", model: "m" }),
}));
vi.mock("@/lib/ai/org-scope", () => ({ orgIdForAutomation: vi.fn().mockResolvedValue("org") }));
vi.mock("@/lib/ai/usage-logger", () => ({ logAIUsage: vi.fn() }));

import { extractDemandLinesFromBody } from "../demand-lines-ai";

const body = { eventType: "FORM_RESPONSE", data: { fields: [{ label: "Projet", value: "sweats" }] } };
const automation = { createdBy: null } as never;

describe("extractDemandLinesFromBody", () => {
  beforeEach(() => { generateObject.mockReset(); });

  it("une ligne hors bornes ne fait pas perdre les autres (sortie validée par le vrai schéma)", async () => {
    generateObject.mockImplementation(async (opts: { schema: { parse: (v: unknown) => unknown } }) => ({
      object: opts.schema.parse({
        lines: [
          { modele: "Sweat", quantite: -4, personnalisation: "p".repeat(900) },
          { modele: "Tee", quantite: 2, type: "Production" },
        ],
      }),
      usage: {},
    }));
    const r = await extractDemandLinesFromBody(body, automation);
    expect(r.lines.map((l) => l.modele)).toEqual(["Sweat", "Tee"]);
    expect(r.lines[0].personnalisation).toHaveLength(500);
  });

  it("borne l'appel : signal d'abandon, aucun retry, plafond de sortie", async () => {
    generateObject.mockResolvedValue({ object: { lines: [] }, usage: {} });
    await extractDemandLinesFromBody(body, automation);
    const opts = generateObject.mock.calls[0][0];
    expect(opts.abortSignal).toBeInstanceOf(AbortSignal);
    expect(opts.maxRetries).toBe(0);
    expect(opts.maxOutputTokens).toBeGreaterThan(0);
  });

  it("dépassement du délai : avertissement et classeur vide", async () => {
    generateObject.mockRejectedValue(new DOMException("timeout", "TimeoutError"));
    const r = await extractDemandLinesFromBody(body, automation);
    expect(r.lines).toEqual([]);
    expect(r.warnings).toHaveLength(1);
  });
});
