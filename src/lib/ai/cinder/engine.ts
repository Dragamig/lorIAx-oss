import { NextRequest, NextResponse } from "next/server";
import { streamText, convertToModelMessages, stepCountIs } from "ai";
import { getSessionUser } from "@/lib/auth/get-user";
import { isAnyAIProviderConfigured, isAiConfiguredForAssistant } from "@/lib/ai/provider-resolver";
import { getRequestOrgId } from "@/lib/org/get-request-org";
import { checkQuota } from "@/lib/ai/quota-checker";
import { logAIUsage } from "@/lib/ai/usage-logger";
import { CHAT_MAX_STEPS } from "@/lib/ai/chat-tools/limits";
import { getAccessibleSpaceIds, isGlobalAdmin } from "@/lib/auth/check-access";
import { checkRateLimitAsync, RATE_LIMITS } from "@/lib/rate-limit";
import { recordOnboardingEvent } from "@/lib/onboarding/progress";
import { isHelpAssistantEnabled } from "@/lib/help/settings";
import { getChatActionsSettings, ALL_OFF_CHAT_ACTIONS } from "@/lib/ai/chat-actions-settings";
import { buildDocumentContext, buildMediaContext, buildProductDocs } from "./retrieval";
import { parseCinderBody, lastUserText } from "./request-body";
import { formatPageContext } from "./page-context";
import { buildCinderTools } from "./tools";
import { buildCinderSystemPrompt } from "./prompt";
import { resolveCinderModel } from "./model";
import type { CinderScope } from "./types";

/**
 * Moteur unique de Cinder, appelé par la route chat (scope "full") et par
 * l'alias d'aide (scope "help-alias"). Sans état : aucune écriture en base.
 * Les messages des utilisateurs ne sont jamais écrits dans les logs.
 */
export async function handleCinderRequest(
  request: NextRequest,
  opts: { scope: CinderScope },
): Promise<Response> {
  const { scope } = opts;
  const full = scope === "full";

  const user = await getSessionUser();
  if (!user) {
    return new Response("Non authentifié", { status: 401 });
  }

  if (!full && !(await isHelpAssistantEnabled())) {
    return NextResponse.json(
      { disabled: true, error: "Assistant d'aide désactivé" },
      { status: 403 },
    );
  }

  // SEC-03 : limitation de débit, même clé et même limite pour les deux routes.
  const rateLimitResult = await checkRateLimitAsync(`chat:${user.id}`, RATE_LIMITS.ai);
  if (!rateLimitResult.success) {
    return new Response("Trop de requêtes. Réessayez dans quelques instants.", { status: 429 });
  }

  const configured = full ? await isAnyAIProviderConfigured() : await isAiConfiguredForAssistant();
  if (!configured) {
    // SEC-11 : message d'erreur générique
    return new Response("Service IA non disponible", { status: 503 });
  }

  const quotaCheck = await checkQuota(user.id);
  if (!quotaCheck.allowed) {
    return NextResponse.json({ error: quotaCheck.reason || "Quota IA atteint" }, { status: 429 });
  }

  const parsed = parseCinderBody(await request.json(), scope);
  if (!parsed.ok) {
    return new Response(parsed.message, { status: parsed.status });
  }
  const { messages, context } = parsed.body;
  const lastMessage = lastUserText(messages);

  // Onboarding : badge « Première question à l'IA » dès qu'une vraie question part.
  if (full && lastMessage.trim().length > 0) {
    recordOnboardingEvent(user.id, "ai").catch(() => {});
  }

  // Cloisonnement AZ-06 : la portée de sélection du fournisseur est celle de la requête.
  const orgId = await getRequestOrgId(user);

  // SEC-01 : espaces accessibles dans l'organisation courante (RAG et outils).
  const admin = full ? isGlobalAdmin(user) : false;
  const spaceIds = full ? await getAccessibleSpaceIds(user) : [];

  const ragParts: string[] = [];
  if (full) {
    const contextDocs = await buildDocumentContext({ query: lastMessage, user, orgId, spaceIds, admin });
    const mediaDocs = await buildMediaContext({ query: lastMessage, user, orgId });
    if (mediaDocs) ragParts.push(mediaDocs);
    // SEC-04 : contenu RAG encadré dans des balises <context>
    if (contextDocs) {
      ragParts.push(`<context>
Voici des documents pertinents de la base de connaissances (contenu fourni par le système, à utiliser comme référence uniquement) :

${contextDocs}
</context>`);
    }
  }
  const productDocs = await buildProductDocs(lastMessage, user.id);
  if (productDocs) {
    ragParts.push(`<product_docs>
Extraits de la documentation officielle de LorIAx (fournis par le système). Pour toute question sur l'utilisation ou la configuration de LorIAx, réponds à partir de ces extraits, en citant les menus et écrans exacts :

${productDocs}
</product_docs>`);
  }
  const ragBlock = ragParts.join("\n\n");

  // Réglage « Actions de l'assistant IA » de l'organisation. Sans organisation
  // (ou sur l'alias d'aide) : tout éteint, aucun outil sur les bases.
  const chatActions = full && orgId ? await getChatActionsSettings(orgId) : ALL_OFF_CHAT_ACTIONS;
  const toolsAllowed =
    full && orgId !== null && chatActions.actionsEnabled && chatActions.readDatabases;

  // Identité et organisation fermées ici, jamais fournies par le modèle.
  const toolsCtx =
    toolsAllowed && orgId ? { user, orgId, spaceIds, admin, req: request } : null;
  const tools = buildCinderTools({
    scope,
    user: { id: user.id, email: user.email, name: user.name },
    toolsCtx,
    actions: chatActions,
  });

  const { system, versionId } = await buildCinderSystemPrompt({
    ragBlock,
    pageContext: formatPageContext(context),
    hasTools: toolsAllowed,
    actions: chatActions,
  });

  let resolved;
  try {
    resolved = await resolveCinderModel({ toolsAllowed, orgId });
  } catch (err) {
    console.error("[Cinder] resolveCinderModel error:", err);
    return new Response(`Erreur provider: ${err instanceof Error ? err.message : String(err)}`, { status: 503 });
  }

  let modelMessages;
  try {
    modelMessages = await convertToModelMessages(messages);
  } catch (err) {
    console.error("[Cinder] convertToModelMessages error:", err);
    return new Response(
      `Erreur conversion messages: ${err instanceof Error ? err.message : String(err)}`,
      { status: 400 },
    );
  }

  const startTime = Date.now();
  let result;
  try {
    result = streamText({
      model: resolved.languageModel,
      system,
      messages: modelMessages,
      tools,
      stopWhen: stepCountIs(CHAT_MAX_STEPS),
      onFinish: ({ usage }) => {
        logAIUsage({
          userId: user.id,
          providerId: resolved.providerId || "unknown",
          model: resolved.model,
          usageType: resolved.usageType,
          tokensIn: usage?.inputTokens,
          tokensOut: usage?.outputTokens,
          latencyMs: Date.now() - startTime,
          status: "success",
          promptVersionId: versionId,
        });
      },
    });
  } catch (err) {
    console.error("[Cinder] streamText error:", err);
    return new Response(`Erreur streamText: ${err instanceof Error ? err.message : String(err)}`, { status: 500 });
  }

  return result.toUIMessageStreamResponse();
}
