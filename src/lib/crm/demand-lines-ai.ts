/** Extraction des lignes d'une demande Tally par sortie IA structurée (modèle de l'organisation de l'automatisme). */
import { generateObject } from "ai";
import { getLanguageModelForUsageInOrg } from "@/lib/ai/provider-resolver";
import { orgIdForAutomation } from "@/lib/ai/org-scope";
import { logAIUsage } from "@/lib/ai/usage-logger";
import type { AutomationRow } from "@/lib/automations/actions/types";
import { demandLinesAiSchema, extractDemandLines, type ExtractedLines } from "./demand-lines";

/** Bornes de l'appel IA : un dépassement vaut échec (avertissement, classeur vide). */
const AI_TIMEOUT_MS = 20_000;
const AI_MAX_OUTPUT_TOKENS = 4_000;

const SYSTEM = `Tu extrais les lignes d'un tableau récapitulatif de commande à partir des réponses d'un formulaire.
Règles :
- Une ligne par référence distincte (modèle, couleur, taille). Si le client décrit 100 sweats noirs M et 50 écrus L, renvoie deux lignes.
- N'invente rien : omets un champ non indiqué. Les quantités sont des nombres.
- "type" vaut "Production" ou "Échantillon" uniquement, sinon omis.
- Si les réponses ne décrivent aucun article, renvoie une liste vide.`;

export async function extractDemandLinesFromBody(body: unknown, automation: AutomationRow): Promise<ExtractedLines> {
  return extractDemandLines(body, async (answers) => {
    const organizationId = await orgIdForAutomation(automation);
    const { languageModel, providerId, model } = await getLanguageModelForUsageInOrg("automation_ai", organizationId);
    const startedAt = Date.now();
    const log = (status: "success" | "error", extra: Record<string, unknown> = {}) => {
      if (automation.createdBy) {
        logAIUsage({
          userId: automation.createdBy, providerId: providerId ?? "unknown", model,
          usageType: "automation_ai", latencyMs: Date.now() - startedAt, status, ...extra,
        } as Parameters<typeof logAIUsage>[0]);
      }
    };
    try {
      const res = await generateObject({ model: languageModel, schema: demandLinesAiSchema, system: SYSTEM, prompt: answers,
        abortSignal: AbortSignal.timeout(AI_TIMEOUT_MS), maxRetries: 0, maxOutputTokens: AI_MAX_OUTPUT_TOKENS,
      });
      log("success", { tokensIn: res.usage?.inputTokens, tokensOut: res.usage?.outputTokens });
      return res.object;
    } catch (err) {
      log("error", { errorMessage: err instanceof Error ? err.message : String(err) });
      throw err;
    }
  });
}
