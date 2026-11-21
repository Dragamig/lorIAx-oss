import { NextRequest, NextResponse } from "next/server";
import { generateText } from "ai";
import { createAnthropic } from "@ai-sdk/anthropic";
import { createMistral } from "@ai-sdk/mistral";
import { createOpenAI } from "@ai-sdk/openai";
import { getSessionUser } from "@/lib/auth/get-user";
import { hasGlobalRole, INSTANCE_ADMIN_ONLY_MESSAGE } from "@/lib/auth/rbac";

/**
 * Constat INJ-24 (audit du 2026-08-19) : cette route relaie `apiBaseUrl`
 * (fourni par l'admin, souvent une passerelle interne type Ollama/vLLM) sans
 * contrainte de protocole ni de redirection, et renvoyait au client le
 * message d'erreur brut de la requête sortante. On ne bloque volontairement
 * pas les adresses privées : pointer un service interne est l'usage normal de
 * LorIAx auto-hébergé.
 *
 * L'en-tête affirmait auparavant que la route était « réservée aux
 * administrateurs globaux, donc pas de franchissement de frontière de
 * privilège ». L'ADR-079 (2026-08-20) a invalidé cette prémisse : `admin`
 * n'est plus un rôle d'instance, c'est un rôle borné à une organisation.
 * Comme cette route accepte une URL ET une clé d'API dans le corps de la
 * requête, la laisser à `admin` revenait à donner un scanner de réseau
 * interne, exécuté depuis le serveur, à tout administrateur d'organisation.
 * Elle est donc réservée à `super_admin`, contrairement aux tests SMTP,
 * Resend et LDAP qui, eux, n'acceptent pas d'identifiants du corps.
 */

/** Vérifie que l'URL est analysable et limitée à http/https, sans émettre de requête. */
function parseOutboundUrl(rawUrl: string): URL | null {
  let url: URL;
  try {
    url = new URL(rawUrl);
  } catch {
    return null;
  }
  if (url.protocol !== "http:" && url.protocol !== "https:") {
    return null;
  }
  return url;
}

/** Fetch qui refuse de suivre une redirection sortante. */
const noRedirectFetch: typeof fetch = (input, init) =>
  fetch(input, { ...init, redirect: "error" });

const MAX_PROVIDER_ERROR_LENGTH = 500;

/** Tronque un texte pour éviter de relayer un corps de réponse volumineux. */
function truncate(text: string, max = MAX_PROVIDER_ERROR_LENGTH): string {
  const trimmed = text.trim();
  return trimmed.length > max ? `${trimmed.slice(0, max)}…` : trimmed;
}

/**
 * Vrai pour une `APICallError` du Vercel AI SDK (nom stable `AI_APICallError`
 * à travers les versions du package, cf. `@ai-sdk/provider`). Duck-typing
 * plutôt qu'un `instanceof` importé : la route ne dépend pas directement de
 * `@ai-sdk/provider`, et les tests mockent entièrement le module `ai`.
 */
function isApiCallError(err: unknown): err is Error & { statusCode?: number } {
  return err instanceof Error && err.name === "AI_APICallError";
}

/**
 * Traduit une erreur de requête sortante en message pour l'appelant.
 *
 * Une `APICallError` avec un `statusCode` 4xx vient du fournisseur lui-même
 * (clé refusée, quota dépassé, modèle inconnu) : elle ne cartographie rien
 * du réseau interne et peut être rendue, tronquée. Toute autre erreur — délai
 * dépassé, redirection refusée (adresse http alors que la passerelle
 * redirige vers https), échec de connexion — reste générique : ni l'hôte
 * visé, ni le port, ni la résolution DNS n'y apparaissent, donc ça ne sert à
 * rien pour cartographier le réseau depuis l'extérieur.
 */
function genericOutboundErrorMessage(err: unknown): string {
  const name = err instanceof Error ? err.name : "";
  if (name === "TimeoutError" || name === "AbortError") {
    return "Délai dépassé en contactant le fournisseur";
  }
  if (isApiCallError(err)) {
    const { statusCode } = err;
    if (typeof statusCode === "number" && statusCode >= 400 && statusCode < 500) {
      return `Le fournisseur a refusé la requête (${statusCode}) : ${truncate(err.message)}`;
    }
    if (/redirect/i.test(err.message)) {
      return "La passerelle a répondu par une redirection, refusée par sécurité. Vérifiez le protocole (http/https) de l'adresse configurée.";
    }
  }
  return "Échec de connexion au fournisseur";
}

export async function POST(request: NextRequest) {
  const user = await getSessionUser();
  if (!user || !hasGlobalRole(user.globalRole, "super_admin")) {
    return NextResponse.json(
      { error: INSTANCE_ADMIN_ONLY_MESSAGE },
      { status: 403 }
    );
  }

  const { connectorType, apiBaseUrl, apiKey, model } = await request.json();

  if (!model) {
    return NextResponse.json(
      { error: "Le modèle est requis" },
      { status: 400 }
    );
  }

  if (connectorType !== "anthropic" && connectorType !== "mistral" && apiBaseUrl) {
    if (!parseOutboundUrl(apiBaseUrl)) {
      return NextResponse.json(
        { error: "URL de fournisseur invalide (http ou https requis)" },
        { status: 400 }
      );
    }
  }

  try {
    // @ai-sdk/openai v3 : languageModel() route vers la Responses API
    // (POST /v1/responses), non supportée par Ollama, Infomaniak et les autres
    // providers openai_compatible. On doit forcer .chat() (Chat Completions),
    // comme le fait le resolver runtime — sinon le test échoue alors que l'usage
    // réel fonctionne.
    let languageModel;

    if (connectorType === "anthropic") {
      languageModel = createAnthropic({
        apiKey: apiKey || undefined,
      }).languageModel(model);
    } else if (connectorType === "mistral") {
      languageModel = createMistral({
        apiKey: apiKey || undefined,
      }).languageModel(model);
    } else {
      // openai_compatible
      languageModel = createOpenAI({
        baseURL: apiBaseUrl || undefined,
        apiKey: apiKey || "no-key",
        fetch: noRedirectFetch,
      }).chat(model);
    }

    const start = Date.now();

    const result = await generateText({
      model: languageModel,
      prompt: "Réponds uniquement par le mot: OK",
      maxOutputTokens: 10,
      abortSignal: AbortSignal.timeout(15_000),
    });

    const latency = Date.now() - start;

    return NextResponse.json({
      success: true,
      latency,
      response: result.text.trim(),
    });
  } catch (err: unknown) {
    console.error("[admin/ai/providers/test] échec de la requête sortante :", err);
    return NextResponse.json(
      { success: false, error: genericOutboundErrorMessage(err) },
      { status: 200 }
    );
  }
}
