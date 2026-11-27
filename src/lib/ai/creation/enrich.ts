/**
 * Enrichissement du contenu d'une proposition de présentation par le modèle
 * de l'usage Création (repli sur Chat). Jamais bloquant : tout échec rend le
 * plan reçu tel quel. Texte brut uniquement, jamais de HTML ni de JSON Bento.
 */
import { generateObject } from "ai";
import { z } from "zod";
import { getLanguageModelForUsageWithFallbackInOrg } from "@/lib/ai/provider-resolver";
import { logAIUsage } from "@/lib/ai/usage-logger";
import { isQuotaExceeded } from "@/lib/rate-limit";
import logger from "@/lib/logger";
import { MAX_SLIDES, presentationProposalSchema, type PresentationProposal } from "./schemas";

const AI_TIMEOUT_MS = 30_000;
const AI_MAX_OUTPUT_TOKENS = 4_000;

/** Enrichissements par utilisateur : 20 par heure. */
const ENRICH_TIERS: Parameters<typeof isQuotaExceeded>[1] = [{ maxRequests: 20, windowMs: 60 * 60 * 1000 }];

/** Sans borne haute : un excès est tronqué à MAX_SLIDES plutôt que rejeté. */
const enrichedSchema = z.object({
  slides: z.array(presentationProposalSchema.shape.slides.element).min(1),
});

const SYSTEM = `Tu rédiges le contenu d'un diaporama à partir de son plan.
Règles :
- Conserve les titres et l'ordre du plan, ajoute 3 à 5 puces courtes par diapositive de contenu.
- Texte brut uniquement : pas de HTML, pas de markdown, pas de JSON.
- N'invente aucun chiffre ni fait absent du plan.
- Langue : celle du plan.`;

export async function enrichPresentation(
  plan: PresentationProposal,
  ctx: { orgId: string; userId: string },
): Promise<PresentationProposal> {
  try {
    if (await isQuotaExceeded(`creation-enrich:${ctx.userId}`, ENRICH_TIERS)) return plan;
    const { languageModel, providerId, model, usageType } =
      await getLanguageModelForUsageWithFallbackInOrg("creation", "chat", ctx.orgId);
    const startedAt = Date.now();
    const log = (status: "success" | "error", extra: Record<string, unknown> = {}) =>
      logAIUsage({
        userId: ctx.userId, providerId: providerId ?? "unknown", model, usageType,
        latencyMs: Date.now() - startedAt, status, ...extra,
      } as Parameters<typeof logAIUsage>[0]);
    try {
      const res = await generateObject({
        model: languageModel,
        schema: enrichedSchema,
        system: SYSTEM,
        prompt: JSON.stringify({ title: plan.title, slides: plan.slides }),
        abortSignal: AbortSignal.timeout(AI_TIMEOUT_MS),
        maxRetries: 0,
        maxOutputTokens: AI_MAX_OUTPUT_TOKENS,
      });
      const parsed = enrichedSchema.safeParse(res.object);
      if (!parsed.success) {
        log("error", { errorMessage: "Sortie hors schéma" });
        return plan;
      }
      log("success", { tokensIn: res.usage?.inputTokens, tokensOut: res.usage?.outputTokens });
      return { ...plan, slides: parsed.data.slides.slice(0, MAX_SLIDES) };
    } catch (err) {
      log("error", { errorMessage: err instanceof Error ? err.message : String(err) });
      return plan;
    }
  } catch (err) {
    logger.warn({ err }, "Enrichissement de présentation indisponible, plan seul");
    return plan;
  }
}
