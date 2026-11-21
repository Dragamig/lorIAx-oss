import { describe, it, expect, vi, beforeEach } from "vitest";

const generateText = vi.fn();
vi.mock("ai", () => ({ generateText: (...a: unknown[]) => generateText(...a) }));
vi.mock("@/lib/ai/provider-resolver", () => ({
  getLanguageModelForUsageInOrg: vi.fn(async () => ({
    languageModel: {},
    providerId: "p1",
    model: "m",
  })),
}));
vi.mock("@/lib/ai/org-scope", () => ({ orgIdForAutomation: vi.fn(async () => null) }));
vi.mock("@/lib/ai/usage-logger", () => ({ logAIUsage: vi.fn() }));
vi.mock("@/lib/storage/s3", () => ({ uploadFile: vi.fn() }));
vi.mock("@/lib/automations/document-generator", () => ({
  generatePdf: vi.fn(),
  generateDocx: vi.fn(),
  buildDocumentKey: vi.fn(),
  DOCUMENT_MIME: {},
}));

import { aiAction, cleanAiText } from "../ai";

const automation = { id: "a1", name: "A", createdBy: null } as never;
const run = () => aiAction.execute({ prompt: "Résume" }, automation, {} as never) as Promise<{
  aiResult: { textPreview: string };
}>;

describe("action IA : texte vide et nettoyage", () => {
  beforeEach(() => generateText.mockReset());

  it("cleanAiText retire les balises think et rogne", () => {
    expect(cleanAiText("\n\n<think>raisonne\nici</think>\n\nBonjour  \n")).toBe("Bonjour");
    expect(cleanAiText("<think>jamais fermé")).toBe("");
    expect(cleanAiText("réflexion</think>Réponse")).toBe("Réponse");
    expect(cleanAiText(undefined)).toBe("");
  });

  it("texte vide deux fois = échec avec message clair", async () => {
    generateText.mockResolvedValue({ text: "  \n", usage: {} });
    await expect(run()).rejects.toThrow(/texte vide/);
    expect(generateText).toHaveBeenCalledTimes(2);
  });

  it("réessaie une fois puis réussit", async () => {
    generateText
      .mockResolvedValueOnce({ text: "", usage: {} })
      .mockResolvedValueOnce({ text: "\n\nRésumé", usage: {} });
    const r = await run();
    expect(r.aiResult.textPreview).toBe("Résumé");
    expect(generateText).toHaveBeenCalledTimes(2);
  });

  it("texte seulement <think> = vide = échec", async () => {
    generateText.mockResolvedValue({ text: "<think>x</think>", usage: {} });
    await expect(run()).rejects.toThrow(/texte vide/);
  });
});
