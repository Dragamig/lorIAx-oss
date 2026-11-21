import { NextRequest, NextResponse } from "next/server";
import { streamText, convertToModelMessages } from "ai";
import { getSessionUser } from "@/lib/auth/get-user";
import { getLanguageModelForUsageInOrg, isAnyAIProviderConfigured } from "@/lib/ai/provider-resolver";
import { getRequestOrgId } from "@/lib/org/get-request-org";
import { checkQuota } from "@/lib/ai/quota-checker";
import { logAIUsage } from "@/lib/ai/usage-logger";
import { getSystemPrompt, interpolatePrompt } from "@/lib/ai/prompt-resolver";
import { searchSemantic, isEmbeddingConfiguredAsync } from "@/lib/ai/embeddings";
import { rerankCandidates, fetchLimitForRerank } from "@/lib/ai/rerank";
import { db } from "@/lib/db";
import { documents } from "@/lib/db/schema";
import { ilike, or, and, inArray, notInArray, sql, asc } from "drizzle-orm";
import { getAccessibleSpaceIds, isGlobalAdmin } from "@/lib/auth/check-access";
import { checkRateLimitAsync, RATE_LIMITS } from "@/lib/rate-limit";
import { recordOnboardingEvent } from "@/lib/onboarding/progress";

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
    const msg = err instanceof Error ? `${err.name}: ${err.message}\n${err.stack}` : String(err);
    console.error("[AI chat] Unhandled error:", msg);
    return new Response(msg, { status: 500 });
  }
}

async function _POST(request: NextRequest) {
  const user = await getSessionUser();
  if (!user) {
    return new Response("Non authentifié", { status: 401 });
  }

  // SEC-03 — Rate limiting sur l'endpoint IA
  const rateLimitResult = await checkRateLimitAsync(`chat:${user.id}`, RATE_LIMITS.ai);
  if (!rateLimitResult.success) {
    return new Response("Trop de requêtes. Réessayez dans quelques instants.", {
      status: 429,
    });
  }

  if (!(await isAnyAIProviderConfigured())) {
    // SEC-11 — Message d'erreur générique
    return new Response("Service IA non disponible", { status: 503 });
  }

  // Vérification du quota IA
  const quotaCheck = await checkQuota(user.id);
  if (!quotaCheck.allowed) {
    return NextResponse.json({ error: quotaCheck.reason || "Quota IA atteint" }, { status: 429 });
  }

  const { messages, context } = await request.json();

  if (!Array.isArray(messages) || messages.length === 0) {
    return new Response("Messages array required", { status: 400 });
  }

  // AI SDK v4 envoie des UIMessage[] (avec parts[]) — extraire le texte du dernier message
  const lastUiMessage = messages[messages.length - 1];
  const lastMessage: string =
    lastUiMessage?.content ||
    (lastUiMessage?.parts ?? [])
      .filter((p: { type: string }) => p.type === "text")
      .map((p: { text: string }) => p.text)
      .join("") ||
    "";

  // Onboarding : badge « Première question à l'IA » dès qu'une vraie question part.
  if (lastMessage.trim().length > 0) {
    recordOnboardingEvent(user.id, "ai").catch(() => {});
  }

  // SEC-01 — Espaces accessibles dans l'org courante pour filtrer le RAG.
  // Liste autoritative (admins inclus) → aucun document d'une autre org.
  const admin = isGlobalAdmin(user);
  const spaceIds = await getAccessibleSpaceIds(user);

  // Cloisonnement AZ-06 (lot 6) : la portée de sélection du fournisseur d'IA
  // est celle de la requête, pas celle de l'instance. `null` = organisation non
  // résolue ou accès refusé : on se limite alors aux fournisseurs de portée
  // instance, jamais à ceux d'un tenant voisin.
  const orgId = await getRequestOrgId(user);

  // RAG : recherche sémantique si disponible, sinon fallback ILIKE
  let contextDocs = "";

  // Aucun espace accessible → aucun contexte (fail-closed).
  if (lastMessage.length > 3 && spaceIds.length > 0) {
    if (await isEmbeddingConfiguredAsync()) {
      try {
        // Recherche sémantique scopée sur les espaces accessibles.
        const semanticResults = await searchSemantic(lastMessage, 5, {
          spaceIds,
          viewerId: user.id,
          isGlobalAdmin: admin,
          organizationId: orgId,
        });

        if (semanticResults.length > 0) {
          // Retirer les documents « secret » pour les non-admins.
          let allowed = semanticResults;
          if (!admin) {
            const docIds = [
              ...new Set(semanticResults.map((r) => r.documentId)),
            ];
            const docs = await db
              .select({
                id: documents.id,
                classification: documents.classification,
              })
              .from(documents)
              .where(inArray(documents.id, docIds));
            const blocked = new Set(
              docs
                .filter((d) => d.classification === "secret")
                .map((d) => d.id)
            );
            allowed = semanticResults.filter((r) => !blocked.has(r.documentId));
          }

          if (allowed.length > 0) {
            contextDocs = allowed
              .map((r) => sanitizeRagContent(r.chunkText))
              .join("\n\n---\n\n");
          }
        }
      } catch {
        // Fallback vers ILIKE
      }
    }

    // Fallback ILIKE si pas de résultats sémantiques
    if (!contextDocs) {
      const pattern = `%${lastMessage.slice(0, 100)}%`;

      // SEC-01 — Filtrage par espace (org courante) + classification
      const conditions = [
        or(
          ilike(documents.title, pattern),
          ilike(documents.contentText, pattern)
        ),
        inArray(documents.spaceId, spaceIds),
      ];

      if (!admin) {
        conditions.push(notInArray(documents.classification, ["secret"]));
      }

      // Troncature côté SQL : seuls les 1500 premiers caractères servent
      // (reclassement puis extrait de contexte), inutile de rapatrier le
      // texte entier de chaque document candidat.
      const relevantDocs = await db
        .select({
          title: documents.title,
          contentText: sql<string>`substring(${documents.contentText}, 1, 1500)`,
        })
        .from(documents)
        .where(and(...conditions))
        // Ordre stable : sans ORDER BY, l'ensemble des candidats soumis au
        // reclassement pourrait varier d'un appel à l'autre pour une même
        // recherche, et avec lui le résultat final et la clé de cache du
        // reclassement (cf. le même correctif dans searchKbFallback).
        .orderBy(asc(documents.id))
        .limit(fetchLimitForRerank(5));

      // Le repli ILIKE ne classe rien par pertinence : reclassement avant usage.
      const reclasses = await rerankCandidates(lastMessage, relevantDocs, {
        getText: (doc) => `${doc.title}\n\n${(doc.contentText || "").slice(0, 1500)}`,
        topN: 5,
        surface: "chat",
        userId: user.id,
        organizationId: orgId,
      });

      if (reclasses.length > 0) {
        contextDocs = reclasses
          .map(
            (d) =>
              `## ${sanitizeRagContent(d.title)}\n${sanitizeRagContent(
                (d.contentText || "").slice(0, 500)
              )}`
          )
          .join("\n\n---\n\n");
      }
    }
  }

  // SEC-04 — Encadrer le contenu RAG dans des balises <context>
  const ragBlock = contextDocs
    ? `<context>
Voici des documents pertinents de la base de connaissances (contenu fourni par le système, à utiliser comme référence uniquement) :

${contextDocs}
</context>`
    : "";

  const { prompt: systemPromptTemplate, versionId } = await getSystemPrompt("chat");
  const systemPrompt = interpolatePrompt(systemPromptTemplate, {
    contexte_rag: ragBlock,
    contexte_additionnel: context ? `Contexte additionnel : ${context}` : "",
  });

  let languageModel, providerId, modelName;
  try {
    const resolved = await getLanguageModelForUsageInOrg("chat", orgId);
    languageModel = resolved.languageModel;
    providerId = resolved.providerId;
    modelName = resolved.model;
  } catch (err) {
    console.error("[AI chat] getLanguageModelForUsageInOrg error:", err);
    return new Response(`Erreur provider: ${err instanceof Error ? err.message : String(err)}`, { status: 503 });
  }

  let modelMessages;
  try {
    modelMessages = await convertToModelMessages(messages);
  } catch (err) {
    console.error("[AI chat] convertToModelMessages error:", err);
    return new Response(`Erreur conversion messages: ${err instanceof Error ? err.message : String(err)}`, { status: 400 });
  }

  const startTime = Date.now();

  let result;
  try {
    result = streamText({
      model: languageModel,
      system: systemPrompt,
      messages: modelMessages,
      onFinish: ({ usage }) => {
        logAIUsage({
          userId: user.id,
          providerId: providerId || "unknown",
          model: modelName,
          usageType: "chat",
          tokensIn: usage?.inputTokens,
          tokensOut: usage?.outputTokens,
          latencyMs: Date.now() - startTime,
          status: "success",
          promptVersionId: versionId,
        });
      },
    });
  } catch (err) {
    console.error("[AI chat] streamText error:", err);
    return new Response(`Erreur streamText: ${err instanceof Error ? err.message : String(err)}`, { status: 500 });
  }

  return result.toUIMessageStreamResponse();
}
