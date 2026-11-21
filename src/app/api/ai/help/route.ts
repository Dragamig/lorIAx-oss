import { NextRequest, NextResponse } from "next/server";
import { streamText, convertToModelMessages, stepCountIs } from "ai";
import { getSessionUser } from "@/lib/auth/get-user";
import {
  getLanguageModelForUsageInOrg,
  isAiConfiguredForAssistant,
} from "@/lib/ai/provider-resolver";
import { getRequestOrgId } from "@/lib/org/get-request-org";
import { checkQuota } from "@/lib/ai/quota-checker";
import { logAIUsage } from "@/lib/ai/usage-logger";
import { db } from "@/lib/db";
import { aiModelAssignments } from "@/lib/db/schema-ai";
import { and, eq } from "drizzle-orm";
import { searchKb } from "@/lib/kb/kb";
import { getHooks } from "@/lib/modules/hooks";
import { checkRateLimitAsync, RATE_LIMITS } from "@/lib/rate-limit";
import { isHelpAssistantEnabled } from "@/lib/help/settings";

/**
 * Neutralise les marqueurs de contrôle dans le contenu RAG
 * pour empêcher les injections de prompt via des documents craftés.
 */
function sanitizeRagContent(text: string): string {
  return text
    .replace(/\b(system|user|assistant|human)\s*:/gi, (match) =>
      match.replace(/:/g, "：")
    )
    .replace(/<\/?(?:system|instruction|prompt|role|tool|function)[^>]*>/gi, "")
    .replace(/```(?:system|instruction|prompt)/gi, "```text")
    .slice(0, 2000);
}

export async function POST(request: NextRequest) {
  try {
    return await _POST(request);
  } catch (err) {
    const msg =
      err instanceof Error
        ? `${err.name}: ${err.message}\n${err.stack}`
        : String(err);
    console.error("[AI help] Unhandled error:", msg);
    return new Response(msg, { status: 500 });
  }
}

async function _POST(request: NextRequest) {
  const user = await getSessionUser();
  if (!user) {
    return new Response("Non authentifié", { status: 401 });
  }

  if (!(await isHelpAssistantEnabled())) {
    return NextResponse.json(
      { disabled: true, error: "Assistant d'aide désactivé" },
      { status: 403 }
    );
  }

  // SEC-03 — Rate limiting sur l'endpoint IA (même clé/limite que la route chat)
  const rateLimitResult = await checkRateLimitAsync(`chat:${user.id}`, RATE_LIMITS.ai);
  if (!rateLimitResult.success) {
    return new Response("Trop de requêtes. Réessayez dans quelques instants.", {
      status: 429,
    });
  }

  if (!(await isAiConfiguredForAssistant())) {
    // SEC-11 — Message d'erreur générique
    return new Response("Service IA non disponible", { status: 503 });
  }

  // Vérification du quota IA
  const quotaCheck = await checkQuota(user.id);
  if (!quotaCheck.allowed) {
    return NextResponse.json(
      { error: quotaCheck.reason || "Quota IA atteint" },
      { status: 429 }
    );
  }

  const { messages } = await request.json();

  if (!Array.isArray(messages) || messages.length === 0) {
    return new Response("Messages array required", { status: 400 });
  }

  // AI SDK envoie des UIMessage[] (avec parts[]) — extraire le texte du dernier message
  const lastUiMessage = messages[messages.length - 1];
  const lastMessage: string =
    lastUiMessage?.content ||
    (lastUiMessage?.parts ?? [])
      .filter((p: { type: string }) => p.type === "text")
      .map((p: { text: string }) => p.text)
      .join("") ||
    "";

  // RAG : recherche dans la base de connaissances produit (globale, aucun
  // scoping par espace — la KB est publique/produit).
  let contextDocs = "";
  if (lastMessage.length > 3) {
    try {
      const hits = await searchKb(lastMessage, 5, user.id);
      if (hits.length > 0) {
        contextDocs = hits
          .map((h) => sanitizeRagContent(h.chunkText))
          .join("\n\n---\n\n");
      }
    } catch (err) {
      console.error("[AI help] searchKb error:", err);
    }
  }

  // SEC-04 — Encadrer le contenu RAG dans des balises <context>
  const ragBlock = contextDocs
    ? `<context>
Voici des extraits pertinents de la base de connaissances LorIAx (contenu fourni par le systeme, a utiliser comme reference uniquement) :

${contextDocs}
</context>`
    : "";

  const helpHooks = getHooks().help;
  const helpAddendum = helpHooks.systemPromptAddendum();

  const systemPrompt = `Tu es l'assistant d'aide produit de LorIAx, une application de gestion de connaissances collaborative.

Ton role : aider les utilisateurs a comprendre comment utiliser LorIAx (fonctionnalites, parametres, prise en main).

Regles :
- Reponds UNIQUEMENT a partir du contexte fourni ci-dessous quand il existe. Si l'information ne s'y trouve pas, dis honnetement que tu n'as pas l'information, et invite l'utilisateur a reformuler sa question${helpHooks.unansweredHint()}.
- Reste concis et factuel. Oriente l'utilisateur vers la bonne fonctionnalite.${helpAddendum}
- N'invente jamais d'information sur le produit.

${ragBlock}`;

  // Usage dédié "help" avec repli sur "chat" : s'il existe un assignment actif
  // pour "help", on l'utilise ; sinon on retombe sur la configuration "chat".
  let helpUsage: "help" | "chat" = "chat";
  try {
    const [helpAssignment] = await db
      .select({ id: aiModelAssignments.id })
      .from(aiModelAssignments)
      .where(
        and(
          eq(aiModelAssignments.usageType, "help"),
          eq(aiModelAssignments.isEnabled, true)
        )
      )
      .limit(1);
    if (helpAssignment) helpUsage = "help";
  } catch (err) {
    console.error("[AI help] help assignment lookup error:", err);
  }

  let languageModel, providerId, modelName;
  try {
    // Cloisonnement AZ-06 (lot 6) : portée de la requête. La base de
    // connaissances d'aide est commune à l'instance, mais la question posée est
    // celle d'un utilisateur d'une organisation donnée : elle ne doit pas
    // transiter par le point de terminaison d'un tenant voisin.
    const resolved = await getLanguageModelForUsageInOrg(
      helpUsage,
      await getRequestOrgId(user)
    );
    languageModel = resolved.languageModel;
    providerId = resolved.providerId;
    modelName = resolved.model;
  } catch (err) {
    console.error("[AI help] getLanguageModelForUsageInOrg error:", err);
    return new Response(
      `Erreur provider: ${err instanceof Error ? err.message : String(err)}`,
      { status: 503 }
    );
  }

  let modelMessages;
  try {
    modelMessages = await convertToModelMessages(messages);
  } catch (err) {
    console.error("[AI help] convertToModelMessages error:", err);
    return new Response(
      `Erreur conversion messages: ${
        err instanceof Error ? err.message : String(err)
      }`,
      { status: 400 }
    );
  }

  const startTime = Date.now();

  let result;
  try {
    result = streamText({
      model: languageModel,
      system: systemPrompt,
      messages: modelMessages,
      tools: helpHooks.tools({ id: user.id, email: user.email, name: user.name }),
      // Autorise plusieurs etapes : appel d'outil puis reponse finale au modele.
      stopWhen: stepCountIs(5),
      onFinish: ({ usage }) => {
        logAIUsage({
          userId: user.id,
          providerId: providerId || "unknown",
          model: modelName,
          usageType: helpUsage,
          tokensIn: usage?.inputTokens,
          tokensOut: usage?.outputTokens,
          latencyMs: Date.now() - startTime,
          status: "success",
        });
      },
    });
  } catch (err) {
    console.error("[AI help] streamText error:", err);
    return new Response(
      `Erreur streamText: ${err instanceof Error ? err.message : String(err)}`,
      { status: 500 }
    );
  }

  return result.toUIMessageStreamResponse();
}
