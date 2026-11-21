// ---------------------------------------------------------------------------
// Détection des modèles disponibles auprès d'un fournisseur IA.
//
// Factorisé pour être réutilisé par :
//   - POST /api/admin/ai/providers/models      (dialogue de création/édition)
//   - GET  /api/admin/ai/providers/[id]/models (sélecteur d'assignation)
//
// Gère les particularités de chaque connecteur :
//   - Anthropic        : en-têtes x-api-key + anthropic-version (pas de Bearer)
//   - Infomaniak       : parsing défensif du shape OpenAI + tarifs via /1/ai/models
//   - OpenAI-compatible: boucle d'URLs candidates (/models vs /v1/models)
//   - Ollama           : /api/tags
// ---------------------------------------------------------------------------

import logger from "@/lib/logger";
import type { ConnectorType } from "@/lib/ai/provider-presets";
import {
  fetchAllowlistedHost,
  safeExternalFetch,
} from "@/lib/security/outbound-fetch";
import { validateExternalUrl } from "@/lib/security/url-validator";

/** Tarif d'un modèle (montants HT par défaut, exprimés par l'API du fournisseur). */
export interface ModelPricing {
  /** Prix d'entrée (input) par unité. */
  input?: number;
  /** Prix de sortie (output) par unité. */
  output?: number;
  /** Type d'unité : "tokens" | "minute". */
  unitType?: string;
  /** Taille de l'unité (ex. 1_000_000 tokens). */
  unitAmount?: number;
}

export interface DetectedModel {
  id: string;
  pricing?: ModelPricing;
}

export interface DetectModelsInput {
  connectorType: ConnectorType | string | null | undefined;
  apiBaseUrl: string | null | undefined;
  apiKey: string | null | undefined;
}

export interface DetectModelsResult {
  /** Liste des identifiants de modèles (triés), stable pour l'UI existante. */
  models: string[];
  /** Détails optionnels (tarifs) indexés sur les mêmes ids. */
  details?: DetectedModel[];
  /** Message d'erreur explicite si la détection a échoué. */
  error?: string;
}

const TIMEOUT_MS = 10_000;

/**
 * Borne de taille d'une liste de modèles. Une réponse plus volumineuse n'est
 * pas un catalogue de modèles : c'est soit un service qui n'a rien à voir, soit
 * une tentative d'épuisement de mémoire.
 */
const MAX_RESPONSE_BYTES = 2 * 1024 * 1024;

/** Hôtes du catalogue tarifaire Infomaniak, destination finie et connue. */
const INFOMANIAK_HOSTS = ["api.infomaniak.com"] as const;

/**
 * Requêtes sortantes de ce module (audit du 2026-08-19, constats INJ-07 et
 * INJ-24 ; ADR-078).
 *
 * `apiBaseUrl` vient de l'administrateur, directement (dialogue de création)
 * ou par la base (fournisseur enregistré). C'est donc une cible influencée par
 * l'utilisateur, qui doit passer par `outbound-fetch` et non par un `fetch`
 * nu. Deux niveaux, comme le veut l'ADR-078 :
 *
 * - le catalogue Infomaniak, dont l'ensemble des destinations légitimes est
 *   fini et où un token part en en-tête, passe par `fetchAllowlistedHost` ;
 * - une passerelle d'inférence quelconque passe par `safeExternalFetch`.
 *
 * On ne bloque volontairement PAS les adresses privées : pointer un Ollama ou
 * un vLLM du réseau local est l'usage normal de LorIAx auto-hébergé, et le
 * lot 2 a tranché ainsi pour les routes d'administration d'IA. Ce qui est
 * fermé, c'est le canal de retour : protocole limité à http(s), redirections
 * refusées (une passerelle interne ne peut pas servir de tremplin, et la clé
 * d'API en en-tête ne suit aucun saut), taille de réponse bornée, délai
 * maximal, et messages d'erreur qui ne décrivent ni l'hôte ni le port visés.
 */
async function outboundJson(
  url: string,
  headers: Record<string, string>,
): Promise<{ ok: boolean; status: number; data: unknown }> {
  const res = await safeExternalFetch(url, {
    allowPrivateTargets: true,
    // Zéro redirection suivie : refusées, jamais rejouées vers une autre cible.
    maxRedirects: 0,
    maxBytes: MAX_RESPONSE_BYTES,
    timeoutMs: TIMEOUT_MS,
    init: { headers },
  });
  if (!res.ok) return { ok: false, status: res.status, data: null };
  return { ok: true, status: res.status, data: await res.json() };
}

/** Idem, vers le catalogue Infomaniak et lui seul. */
async function infomaniakJson(
  url: string,
  apiKey: string,
): Promise<{ ok: boolean; status: number; data: unknown }> {
  const res = await fetchAllowlistedHost(url, {
    hosts: INFOMANIAK_HOSTS,
    timeoutMs: TIMEOUT_MS,
    init: {
      headers: {
        "Content-Type": "application/json",
        Authorization: `Bearer ${apiKey}`,
      },
    },
  });
  if (!res.ok) return { ok: false, status: res.status, data: null };
  return { ok: true, status: res.status, data: await res.json() };
}

/**
 * Contrôle de forme d'une adresse de base, sans émettre de requête.
 *
 * Doublon volontaire du schéma d'écriture (`externalUrlSchema` posé sur les
 * verbes de création et de modification de fournisseur) : une ligne créée
 * avant le cloisonnement, ou par un chemin qu'on aurait oublié, ne doit pas
 * pouvoir faire émettre une requête `file:` ou `gopher:` depuis le serveur.
 */
function invalidBaseUrl(apiBaseUrl: string): boolean {
  return validateExternalUrl(apiBaseUrl, { allowPrivateTargets: true }) !== null;
}

const INVALID_BASE_URL_ERROR =
  "URL de base invalide : seules les adresses http ou https sont acceptées";

function trimTrailingSlash(url: string): string {
  return url.replace(/\/+$/, "");
}

/** Vrai si l'adresse vise réellement le domaine Infomaniak, pas si elle le cite. */
function isInfomaniakBaseUrl(apiBaseUrl: string): boolean {
  try {
    const host = new URL(apiBaseUrl).hostname.toLowerCase();
    return host === "api.infomaniak.com" || host.endsWith(".infomaniak.com");
  } catch {
    return false;
  }
}

/**
 * Parsing défensif d'une réponse « liste de modèles » de forme OpenAI.
 * Gère : data[] d'objets {id}, data[] de chaînes, data objet unique {id},
 * tableau racine, ou clé `models`.
 */
function parseModelIds(data: unknown): string[] {
  const out: string[] = [];
  const pushFrom = (arr: unknown) => {
    if (!Array.isArray(arr)) return;
    for (const item of arr) {
      if (typeof item === "string") out.push(item);
      else if (item && typeof item === "object") {
        const id = (item as { id?: unknown; name?: unknown }).id ??
          (item as { name?: unknown }).name;
        if (typeof id === "string") out.push(id);
      }
    }
  };

  if (Array.isArray(data)) {
    pushFrom(data);
  } else if (data && typeof data === "object") {
    const obj = data as Record<string, unknown>;
    if (Array.isArray(obj.data)) {
      pushFrom(obj.data);
    } else if (obj.data && typeof obj.data === "object") {
      // Quirk OpenAPI Infomaniak : `data` typé comme objet unique.
      const id = (obj.data as { id?: unknown }).id;
      if (typeof id === "string") out.push(id);
      else pushFrom(Object.values(obj.data as Record<string, unknown>));
    } else if (Array.isArray(obj.models)) {
      pushFrom(obj.models);
    }
  }
  // Dédoublonnage en préservant l'ordre.
  return Array.from(new Set(out));
}

// ---------------------------------------------------------------------------
// Anthropic
// ---------------------------------------------------------------------------

async function detectAnthropic(
  apiBaseUrl: string | null | undefined,
  apiKey: string | null | undefined,
): Promise<DetectModelsResult> {
  if (!apiKey) {
    return { models: [], error: "Clé API Anthropic requise" };
  }
  const baseUrl = apiBaseUrl || "https://api.anthropic.com";
  if (invalidBaseUrl(baseUrl)) {
    return { models: [], error: INVALID_BASE_URL_ERROR };
  }
  try {
    const url = `${trimTrailingSlash(baseUrl)}/v1/models`;
    const res = await outboundJson(url, {
      "Content-Type": "application/json",
      "x-api-key": apiKey,
      "anthropic-version": "2023-06-01",
    });

    if (res.ok) {
      const models = parseModelIds(res.data).sort();
      if (models.length > 0) return { models };
      return { models: [], error: "Aucun modèle retourné par Anthropic" };
    }
    const detail = res.status === 401 ? " (clé API refusée)" : "";
    return {
      models: [],
      error: `Anthropic a refusé la requête : HTTP ${res.status}${detail}`,
    };
  } catch {
    return { models: [], error: "Impossible de contacter l'API Anthropic" };
  }
}

// ---------------------------------------------------------------------------
// Infomaniak (catalogue de tarifs global)
// ---------------------------------------------------------------------------

interface InfomaniakPrice {
  label?: string;
  model?: string;
  input_amount_excl_vat?: number;
  output_amount_excl_vat?: number;
  amount_excl_vat?: number;
  unit?: { type?: string; amount?: number };
}

interface InfomaniakModel {
  id?: number;
  name?: string;
  prices?: InfomaniakPrice[];
}

/**
 * Récupère le catalogue tarifaire global Infomaniak (/1/ai/models) et construit
 * une table {modèle → tarif}. Sans product_id, n'a besoin que du token.
 */
async function fetchInfomaniakPricing(
  apiKey: string,
): Promise<Map<string, ModelPricing>> {
  const map = new Map<string, ModelPricing>();
  try {
    const res = await infomaniakJson(
      "https://api.infomaniak.com/1/ai/models",
      apiKey,
    );
    if (!res.ok) return map;
    const json = res.data as { data?: unknown } | null;
    const models: InfomaniakModel[] = Array.isArray(json?.data)
      ? (json.data as InfomaniakModel[])
      : [];
    for (const m of models) {
      const tokenPrice =
        (m.prices || []).find((p) => p.unit?.type === "tokens") ||
        (m.prices || [])[0];
      if (!tokenPrice) continue;
      const pricing: ModelPricing = {
        input: tokenPrice.input_amount_excl_vat,
        output: tokenPrice.output_amount_excl_vat,
        unitType: tokenPrice.unit?.type,
        unitAmount: tokenPrice.unit?.amount,
      };
      // Indexer par nom du modèle ET par l'identifiant de tarif (prices[].model).
      if (m.name) map.set(m.name.toLowerCase(), pricing);
      for (const p of m.prices || []) {
        if (p.model) map.set(p.model.toLowerCase(), pricing);
      }
    }
  } catch (err) {
    logger.warn({ err }, "Infomaniak pricing catalog fetch failed");
  }
  return map;
}

async function detectInfomaniak(
  apiBaseUrl: string,
  apiKey: string | null | undefined,
): Promise<DetectModelsResult> {
  if (!apiKey) {
    return { models: [], error: "Un token d'API Infomaniak est requis." };
  }
  if (invalidBaseUrl(apiBaseUrl)) {
    return { models: [], error: INVALID_BASE_URL_ERROR };
  }

  const trimmedBase = trimTrailingSlash(apiBaseUrl);
  const endsWithV1 = /\/v1$/.test(trimmedBase);
  const candidateUrls = endsWithV1
    ? [`${trimmedBase}/models`, `${trimmedBase}/v1/models`]
    : [`${trimmedBase}/v1/models`, `${trimmedBase}/models`];

  let lastStatus = 0;
  let modelIds: string[] = [];

  for (const url of candidateUrls) {
    try {
      // Liste blanche : la branche Infomaniak ne doit parler qu'à Infomaniak.
      // Sans elle, une adresse de base qui se contente de citer le domaine
      // ferait partir le token vers un hôte quelconque.
      const res = await infomaniakJson(url, apiKey);
      lastStatus = res.status;
      if (res.ok) {
        modelIds = parseModelIds(res.data);
        if (modelIds.length > 0) break;
      }
    } catch {
      // URL candidate suivante
    }
  }

  if (modelIds.length === 0) {
    const detail =
      lastStatus === 401
        ? " (token refusé)"
        : lastStatus === 404
          ? " (identifiant produit introuvable)"
          : lastStatus
            ? ` (HTTP ${lastStatus})`
            : "";
    return {
      models: [],
      error: `Aucun modèle Infomaniak détecté${detail}. Vérifiez l'identifiant produit et le token.`,
    };
  }

  // Enrichissement tarifaire (best effort, n'échoue jamais la détection).
  const pricing = await fetchInfomaniakPricing(apiKey);
  const details: DetectedModel[] = modelIds.map((id) => {
    const p = pricing.get(id.toLowerCase());
    return p ? { id, pricing: p } : { id };
  });

  return { models: [...modelIds].sort(), details };
}

/** Modèles de rerank statiques : repli quand la détection échoue. */
export const RERANK_FALLBACK_MODELS = [
  "BAAI/bge-reranker-v2-m3",
  "Qwen/Qwen3-Reranker-0.6B",
];

/**
 * Détecte les modèles de rerank exposés par le fournisseur.
 *
 * Seul Infomaniak a un catalogue dédié : `/1/ai/models` accepte un filtre
 * par point d'accès. Les autres connecteurs reçoivent directement le repli
 * statique, faute de détection dédiée pour ce point d'accès. Ne rend jamais
 * une liste vide : le sélecteur de l'écran d'assignation ne doit jamais se
 * retrouver sans option.
 */
export async function detectRerankModels(
  input: DetectModelsInput,
): Promise<string[]> {
  const { connectorType, apiKey } = input;
  if (connectorType !== "infomaniak" || !apiKey) {
    return [...RERANK_FALLBACK_MODELS];
  }

  try {
    const res = await infomaniakJson(
      "https://api.infomaniak.com/1/ai/models?endpoint=rerank",
      apiKey,
    );
    if (!res.ok) return [...RERANK_FALLBACK_MODELS];
    const json = res.data as { data?: unknown } | null;
    const models: InfomaniakModel[] = Array.isArray(json?.data)
      ? (json.data as InfomaniakModel[])
      : [];
    const ids = models
      .map((m) => m.name)
      .filter((n): n is string => typeof n === "string");
    return ids.length > 0 ? Array.from(new Set(ids)).sort() : [...RERANK_FALLBACK_MODELS];
  } catch (err) {
    logger.warn({ err }, "Infomaniak rerank models fetch failed");
    return [...RERANK_FALLBACK_MODELS];
  }
}

// ---------------------------------------------------------------------------
// OpenAI-compatible générique + repli Ollama
// ---------------------------------------------------------------------------

async function detectOpenAiCompatible(
  apiBaseUrl: string,
  apiKey: string | null | undefined,
): Promise<DetectModelsResult> {
  if (invalidBaseUrl(apiBaseUrl)) {
    return { models: [], error: INVALID_BASE_URL_ERROR };
  }

  const headers: Record<string, string> = { "Content-Type": "application/json" };
  if (apiKey) headers["Authorization"] = `Bearer ${apiKey}`;

  const trimmedBase = trimTrailingSlash(apiBaseUrl);
  const endsWithV1 = /\/v1$/.test(trimmedBase);
  const candidateUrls = endsWithV1
    ? [`${trimmedBase}/models`, `${trimmedBase}/v1/models`]
    : [`${trimmedBase}/v1/models`, `${trimmedBase}/models`];

  for (const url of candidateUrls) {
    try {
      const res = await outboundJson(url, headers);
      if (res.ok) {
        const models = parseModelIds(res.data);
        if (models.length > 0) return { models: models.sort() };
      }
    } catch {
      // URL candidate suivante
    }
  }

  // Repli Ollama (/api/tags)
  try {
    const url = `${trimmedBase}/api/tags`;
    const res = await outboundJson(url, headers);
    if (res.ok) {
      const data = res.data as { models?: { name?: string }[] };
      const models: string[] = (data.models || [])
        .map((m: { name?: string }) => m.name)
        .filter((n: unknown): n is string => typeof n === "string");
      if (models.length > 0) return { models: models.sort() };
    }
  } catch {
    // Les deux stratégies ont échoué
  }

  return { models: [], error: "Impossible de récupérer la liste des modèles" };
}

// ---------------------------------------------------------------------------
// Point d'entrée
// ---------------------------------------------------------------------------

export async function detectModels(
  input: DetectModelsInput,
): Promise<DetectModelsResult> {
  const { connectorType } = input;
  const apiKey = input.apiKey || undefined;

  // Mistral : URL officielle par défaut si non renseignée.
  const apiBaseUrl =
    connectorType === "mistral" && !input.apiBaseUrl
      ? "https://api.mistral.ai"
      : input.apiBaseUrl;

  if (connectorType === "anthropic") {
    return detectAnthropic(apiBaseUrl, apiKey);
  }

  if (!apiBaseUrl) {
    return { models: [], error: "L'URL de base est requise" };
  }

  if (invalidBaseUrl(apiBaseUrl)) {
    return { models: [], error: INVALID_BASE_URL_ERROR };
  }

  // Infomaniak : branche dédiée (parsing défensif + tarifs, pas de repli Ollama).
  // Le test porte sur le nom d'hôte réel, pas sur une sous-chaîne de l'URL :
  // `https://mallory.test/?ref=api.infomaniak.com` citait le domaine et
  // récupérait ainsi le traitement réservé à Infomaniak, token compris.
  if (isInfomaniakBaseUrl(apiBaseUrl)) {
    return detectInfomaniak(apiBaseUrl, apiKey);
  }

  return detectOpenAiCompatible(apiBaseUrl, apiKey);
}
