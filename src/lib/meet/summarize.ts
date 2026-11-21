import { generateText } from "ai";
import {
  getLanguageModelForUsageInOrg,
  type ProviderOrgScope,
} from "@/lib/ai/provider-resolver";
import { logAIUsage } from "@/lib/ai/usage-logger";
import { getSystemPrompt } from "@/lib/ai/prompt-resolver";
import logger from "@/lib/logger";

const log = logger.child({ module: "meet-summarize" });

interface OllamaConfig {
  enabled: boolean;
  baseUrl: string;
  defaultModel: string;
}

/**
 * Read Ollama configuration from system_settings first, then fallback to env vars.
 */
export async function getOllamaConfig(): Promise<OllamaConfig> {
  try {
    const { db } = await import("@/lib/db");
    const { systemSettings } = await import("@/lib/db/schema");
    const { eq } = await import("drizzle-orm");
    const [row] = await db.select().from(systemSettings).where(eq(systemSettings.key, "ollama"));
    if (row?.value) {
      const config = row.value as Record<string, unknown>;
      return {
        enabled: (config.ollamaEnabled as boolean) ?? true,
        baseUrl: (config.ollamaBaseUrl as string) || process.env.OLLAMA_BASE_URL || "http://localhost:11434",
        defaultModel: (config.ollamaDefaultModel as string) || process.env.DEFAULT_AI_MODEL || "gemma4:e4b",
      };
    }
  } catch {
    // DB not available — fallback to env
  }
  return {
    enabled: true,
    baseUrl: process.env.OLLAMA_BASE_URL || "http://localhost:11434",
    defaultModel: process.env.DEFAULT_AI_MODEL || "gemma4:e4b",
  };
}

const _MEETING_SUMMARY_PROMPT = `Tu rédiges des comptes-rendus de réunion COURTS et FACTUELS en français.

CONTRAINTE : le CR doit être PLUS COURT que le transcript. Extrais l'essentiel, ne reformule pas.

Structure Markdown stricte :

## Participants
Liste des personnes qui ont pris la parole.

## Ordre du jour
1-2 phrases : de quoi a-t-on parlé.

## Décisions prises
Liste à puces. Si aucune : "(Aucune)"

## Actions à mener
Format : "- **[Nom]** : action (échéance si mentionnée)"
Si aucune : "(Aucune)"

## Points en suspens
Questions non résolues. Si aucun : "(Aucun)"

Règles :
- JAMAIS plus long que le transcript
- N'invente rien — uniquement ce qui est dit dans le transcript
- Style télégraphique, pas de phrases inutiles
- Pas d'introduction ni de conclusion`;

/**
 * Generate a structured meeting summary using the configured AI provider.
 *
 * `organizationId` porte le cloisonnement AZ-06 (lot 6) : le transcript d'une
 * réunion est envoyé à un fournisseur d'IA, et ce fournisseur doit être celui
 * de l'organisation de la réunion, jamais celui d'un tenant voisin. La réunion
 * ne porte pas l'organisation elle-même, elle porte son espace : l'appelant la
 * dérive avec `orgIdForSpace`. Paramètre obligatoire, et non optionnel avec un
 * défaut : un appelant futur doit avoir à se poser la question, pas à hériter
 * en silence d'une portée qui ne serait pas la sienne. `null` reste licite et
 * signifie « portée instance seule ».
 */
export async function summarizeMeeting(
  transcript: string,
  title: string,
  organizationId: ProviderOrgScope,
  userId?: string
): Promise<string> {
  const { languageModel, providerId, model: modelName, providerName } =
    await getLanguageModelForUsageInOrg("summary_meeting", organizationId);

  log.info(
    { provider: providerName, model: modelName, titleLength: title.length, transcriptLength: transcript.length },
    "Generating meeting summary"
  );

  // Resolve prompt from DB or fallback to hardcoded MEETING_SUMMARY_PROMPT
  const { prompt: systemPromptTemplate, versionId } = await getSystemPrompt("summary_meeting");

  const startTime = Date.now();

  const { text, usage } = await generateText({
    model: languageModel,
    system: systemPromptTemplate,
    prompt: `Titre de la réunion : ${title}\n\n---\n\nTranscript :\n${transcript}`,
    maxOutputTokens: Math.min(1000, Math.max(200, Math.round(transcript.length / 2))),
  });

  const latencyMs = Date.now() - startTime;

  log.info({ summaryLength: text.length, latencyMs }, "Meeting summary generated");

  // Log usage (fire-and-forget)
  if (userId) {
    logAIUsage({
      userId,
      providerId: providerId || "unknown",
      model: modelName,
      usageType: "summary_meeting",
      tokensIn: usage?.inputTokens,
      tokensOut: usage?.outputTokens,
      latencyMs,
      status: "success",
      promptVersionId: versionId,
    });
  }

  return text;
}
