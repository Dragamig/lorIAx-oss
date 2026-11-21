/**
 * Action « IA » (C4) — appelle un LLM avec un prompt interpolé depuis le
 * contexte, et génère optionnellement un document (PDF/DOCX) stocké dans S3.
 *
 * Réutilise l'infra IA serveur (résolution provider admin + logging usage). Le
 * quota IA par-utilisateur n'est pas réappliqué ici : le débit est déjà borné
 * par les quotas d'automation (1/min, 100/h org). Le logging d'usage IA n'a
 * lieu que si l'automation a un créateur connu (`createdBy`).
 *
 * Retourne un objet fusionné dans le payload du run : texte généré (tronqué),
 * provider/modèle, et — si format pdf/docx — la clé S3 + le format du document.
 */
import { z } from "zod";
import { generateText } from "ai";
import { getLanguageModelForUsageInOrg } from "@/lib/ai/provider-resolver";
import { orgIdForAutomation } from "@/lib/ai/org-scope";
import { logAIUsage } from "@/lib/ai/usage-logger";
import {
  generatePdf,
  generateDocx,
  buildDocumentKey,
  DOCUMENT_MIME,
  type DocumentFormat,
} from "@/lib/automations/document-generator";
import { uploadFile } from "@/lib/storage/s3";
import { interpolate } from "@/lib/automations/interpolate";
import type { ActionDefinition } from "./types";

const configSchema = z.object({
  prompt: z.string().min(1).max(20_000),
  systemPrompt: z.string().max(20_000).optional(),
  format: z.enum(["none", "pdf", "docx"]).optional(),
  title: z.string().max(255).optional(),
});

/**
 * Budget de sortie. Les modèles à raisonnement (ex. Qwen3.5) consomment ce
 * budget avec leur réflexion avant le texte final : à 2000 jetons le contenu
 * revenait vide. @ai-sdk/openai (.chat) ne transmet pas les options inconnues
 * comme `chat_template_kwargs`, la désactivation de la réflexion n'est donc pas
 * possible côté appel : on relève le budget et on réessaie si le texte est vide.
 */
export const AI_MAX_OUTPUT_TOKENS = 8000;
const EMPTY_TEXT_ERROR =
  "L'IA a renvoyé un texte vide (le modèle a probablement consommé son budget à réfléchir). Relancez l'automatisme ou simplifiez le prompt.";

/** Retire les blocs de réflexion (<think>…</think>, y compris non fermé) et rogne. */
export function cleanAiText(raw: string | undefined | null): string {
  return (raw ?? "")
    .replace(/<think>[\s\S]*?<\/think>/gi, "")
    .replace(/<think>[\s\S]*$/i, "")
    .replace(/^[\s\S]*?<\/think>/i, "")
    .trim();
}

export const aiAction: ActionDefinition = {
  type: "ai",
  configSchema,
  async simulate(actionConfig, automation, ctx) {
    const cfg = (actionConfig ?? {}) as {
      prompt?: string;
      format?: "none" | DocumentFormat;
      title?: string;
    };
    if (!cfg.prompt || !cfg.prompt.trim()) {
      throw new Error("Prompt de l'action IA manquant");
    }
    const prompt = interpolate(cfg.prompt, ctx);
    const title = cfg.title ? interpolate(cfg.title, ctx) : automation.name;
    const aiResult: Record<string, unknown> = {
      model: "simulated",
      provider: "simulated",
      textPreview: `[Simulé, aucun appel IA] ${prompt}`.slice(0, 2000),
    };
    if (cfg.format && cfg.format !== "none") {
      aiResult.documentKey = `sim_documents/${automation.id}.${cfg.format}`;
      aiResult.documentFormat = cfg.format;
      aiResult.documentTitle = title;
    }
    return { aiResult, simulated: true };
  },
  async execute(actionConfig, automation, ctx) {
    const cfg = (actionConfig ?? {}) as {
      prompt?: string;
      systemPrompt?: string;
      format?: "none" | DocumentFormat;
      title?: string;
    };
    if (!cfg.prompt || !cfg.prompt.trim()) {
      throw new Error("Prompt de l'action IA manquant");
    }

    const prompt = interpolate(cfg.prompt, ctx);
    const systemPrompt = cfg.systemPrompt ? interpolate(cfg.systemPrompt, ctx) : undefined;
    const title = cfg.title ? interpolate(cfg.title, ctx) : automation.name;

    const startedAt = Date.now();
    // Cloisonnement AZ-06 (lot 6) : une automatisation s'exécute en tâche de
    // fond, sans requête HTTP dont hériter. Sa portée est celle de l'objet
    // traité : l'espace du workflow, ou l'espace de la base déclenchante.
    // Indérivable → portée instance seule (fail-closed), jamais le fournisseur
    // d'un tenant voisin.
    const organizationId = await orgIdForAutomation(automation);
    const { languageModel, providerId: rawProviderId, model } =
      await getLanguageModelForUsageInOrg("automation_ai", organizationId);
    const providerId = rawProviderId ?? "unknown";

    let text = "";
    let usage: { inputTokens?: number; outputTokens?: number } | undefined;
    try {
      for (let attempt = 0; attempt < 2 && !text; attempt++) {
        const result = await generateText({
          model: languageModel,
          system: systemPrompt,
          prompt,
          maxOutputTokens: AI_MAX_OUTPUT_TOKENS,
        });
        text = cleanAiText(result.text);
        usage = result.usage;
      }
      if (!text) throw new Error(EMPTY_TEXT_ERROR);
    } catch (err) {
      if (automation.createdBy) {
        logAIUsage({
          userId: automation.createdBy,
          providerId,
          model,
          usageType: "automation_ai",
          latencyMs: Date.now() - startedAt,
          status: "error",
          errorMessage: err instanceof Error ? err.message : String(err),
        });
      }
      throw err instanceof Error ? err : new Error(String(err));
    }

    if (automation.createdBy) {
      logAIUsage({
        userId: automation.createdBy,
        providerId,
        model,
        usageType: "automation_ai",
        tokensIn: usage?.inputTokens,
        tokensOut: usage?.outputTokens,
        latencyMs: Date.now() - startedAt,
        status: "success",
      });
    }

    const result: Record<string, unknown> = {
      aiResult: {
        model,
        provider: providerId,
        // Trace bornée dans le run (évite des payloads jsonb énormes).
        textPreview: text.slice(0, 2000),
      },
    };

    const format = cfg.format && cfg.format !== "none" ? cfg.format : null;
    if (format) {
      const bytes =
        format === "pdf" ? await generatePdf(title, text) : await generateDocx(title, text);
      const key = buildDocumentKey(automation.id, format, Date.now());
      await uploadFile(key, bytes, DOCUMENT_MIME[format]);
      (result.aiResult as Record<string, unknown>).documentKey = key;
      (result.aiResult as Record<string, unknown>).documentFormat = format;
      (result.aiResult as Record<string, unknown>).documentTitle = title;
    }

    return result;
  },
};
