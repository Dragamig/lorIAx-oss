import { createAnthropic } from "@ai-sdk/anthropic";
import { createMistral } from "@ai-sdk/mistral";
import { createOpenAI } from "@ai-sdk/openai";
import { and, eq, isNull, or } from "drizzle-orm";
import { db } from "@/lib/db";
import { aiProviders, organizations } from "@/lib/db/schema";
import { aiModelAssignments } from "@/lib/db/schema-ai";
import { decrypt } from "@/lib/crypto";
import logger from "@/lib/logger";
import { deriveRerankBaseUrl } from "@/lib/ai/rerank-url";

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

export type UsageType =
  | "chat"
  | "summary_doc"
  | "summary_meeting"
  | "embeddings"
  | "playground"
  | "automation_ai"
  | "help"
  | "voice_note_summary"
  | "voice_note_cleanup"
  | "rerank"
  | "chat_database_actions"
  | "creation";

export interface ResolvedProvider {
  provider: ReturnType<typeof createAnthropic> | ReturnType<typeof createOpenAI> | ReturnType<typeof createMistral>;
  model: string;
  providerId: string | null;
  providerName: string;
  isFallback: boolean;
  // "openai_compatible" → doit utiliser .chat() car .languageModel() route vers Responses API en v3
  connectorType: "anthropic" | "mistral" | "openai_compatible";
}

export interface ResolvedLanguageModel {
  languageModel: ReturnType<ResolvedProvider["provider"]["languageModel"]>;
  providerId: string | null;
  providerName: string;
  model: string;
  isFallback: boolean;
}

/**
 * Embedding provider resolved from the admin config (`ai_model_assignments`,
 * usage `embeddings`). Normalised so the embedding caller only needs a `kind`,
 * the credentials and the model — no DB/provider details leak out.
 *
 * `kind` includes "ollama" for symmetry with the env fallback, but an admin
 * assignment only ever yields "mistral" or "openai" (an Ollama endpoint is
 * configured as an `openai_compatible` provider).
 */
export interface ResolvedEmbeddingProvider {
  kind: "mistral" | "openai" | "ollama";
  apiKey: string | null;
  baseUrl: string | null;
  model: string;
  providerId: string;
}

// ---------------------------------------------------------------------------
// Helpers (internal)
// ---------------------------------------------------------------------------

function decryptApiKey(encrypted: string | null): string | null {
  if (!encrypted) return null;
  try {
    return decrypt(encrypted);
  } catch (err) {
    logger.warn({ err }, "Failed to decrypt API key for AI provider");
    return null;
  }
}

function buildProviderInstance(
  record: typeof aiProviders.$inferSelect,
): { provider: ReturnType<typeof createAnthropic> | ReturnType<typeof createOpenAI> | ReturnType<typeof createMistral>; connectorType: ResolvedProvider["connectorType"] } {
  const apiKey = decryptApiKey(record.apiKeyEnc);

  if (record.connectorType === "anthropic") {
    return { provider: createAnthropic({ apiKey: apiKey || undefined }), connectorType: "anthropic" };
  }

  if (record.connectorType === "mistral") {
    return { provider: createMistral({ apiKey: apiKey || undefined }), connectorType: "mistral" };
  }

  // openai_compatible (Ollama, OpenAI, LM Studio, etc.)
  // IMPORTANT : @ai-sdk/openai v3 — languageModel() pointe vers Responses API.
  // Il faut utiliser provider.chat() pour forcer Chat Completions.
  return {
    provider: createOpenAI({
      baseURL: record.apiBaseUrl || undefined,
      apiKey: apiKey || "no-key",
    }),
    connectorType: "openai_compatible",
  };
}

// ---------------------------------------------------------------------------
// Portée d'organisation (cloisonnement, audit AZ-06 lot 6)
// ---------------------------------------------------------------------------

/**
 * Portée de sélection d'un fournisseur d'IA.
 *
 * `ai_providers` porte deux populations, exactement comme les verbes
 * d'administration les distinguent dans `src/app/api/admin/ai/providers/scope.ts` :
 * - `organization_id` renseigné : fournisseur d'un tenant, utilisable par lui
 *   seul ;
 * - `organization_id` NULL : fournisseur de portée instance, utilisable par
 *   tous, c'est le cas de l'auto-hébergement mono-tenant.
 *
 * La sélection ne lisait aucune de ces colonnes : le fournisseur d'un tenant
 * pouvait servir les requêtes d'un autre, donc consommer sa clé d'API et faire
 * transiter ses données par un point de terminaison qu'il ne contrôle pas. On
 * passe donc l'organisation en paramètre EXPLICITE et OBLIGATOIRE, pour que la
 * décision se lise dans l'appelant et non dans la bibliothèque.
 *
 * `null` signifie « aucune organisation connue » : seuls les fournisseurs de
 * portée instance sont alors sélectionnables. Ce n'est jamais « toutes les
 * organisations ».
 */
export type ProviderOrgScope = string | null;

/** Fournisseurs sélectionnables pour une portée : ceux de l'org, et ceux d'instance. */
function selectableProvidersFilter(organizationId: ProviderOrgScope) {
  return organizationId === null
    ? isNull(aiProviders.organizationId)
    : or(eq(aiProviders.organizationId, organizationId), isNull(aiProviders.organizationId));
}

/**
 * Charge un fournisseur par identifiant, borné à la portée.
 *
 * Le filtre est dans la clause `where`, pas dans un test après coup : un
 * fournisseur d'un autre tenant est indissociable d'un fournisseur inexistant,
 * et les deux mènent au même repli.
 */
async function loadProviderInScope(
  id: string,
  organizationId: ProviderOrgScope,
): Promise<typeof aiProviders.$inferSelect | undefined> {
  const [row] = await db
    .select()
    .from(aiProviders)
    .where(and(eq(aiProviders.id, id), selectableProvidersFilter(organizationId)))
    .limit(1);
  return row;
}

/**
 * Fournisseur « par défaut » de la portée. `isDefault` est exclusif PAR portée
 * (cf. `defaultScopeFilter` côté administration) : au plus une ligne pour
 * l'organisation, au plus une pour l'instance. On préfère celle de
 * l'organisation, et on se rabat sur celle d'instance.
 */
async function pickDefaultProviderInScope(
  organizationId: ProviderOrgScope,
): Promise<typeof aiProviders.$inferSelect | undefined> {
  const rows = await db
    .select()
    .from(aiProviders)
    .where(and(eq(aiProviders.isDefault, true), selectableProvidersFilter(organizationId)));

  return (
    (organizationId === null
      ? undefined
      : rows.find((r) => r.organizationId === organizationId)) ??
    rows.find((r) => r.organizationId === null)
  );
}

/**
 * Portée d'une décision qui appartient réellement à l'INSTANCE, et non à un
 * tenant. Réservée aux traitements dont le résultat est partagé par toutes les
 * organisations : la ré-indexation vectorielle et le modèle d'embedding, dont
 * la dimension définit une colonne SQL unique (`document_embeddings.embedding`,
 * `kb_chunks.embedding`). Deux organisations ne peuvent pas y écrire des
 * vecteurs de dimensions différentes : le choix du modèle n'est pas un réglage
 * de tenant.
 *
 * Elle ne rend pas `null` sèchement. La migration 0014 a rattaché TOUS les
 * fournisseurs préexistants à l'organisation `default` : sur une instance
 * auto-hébergée, aucun fournisseur n'est resté de portée instance, et résoudre
 * `null` priverait le cas majoritaire de sa configuration d'embeddings. On rend
 * donc l'organisation de l'instance quand elle est unique, et `null` dès qu'il
 * y en a plusieurs : jamais un choix arbitraire entre des tenants, donc jamais
 * d'emprunt possible. Sur une instance multi-tenant, la résolution se limite
 * aux fournisseurs de portée instance puis aux variables d'environnement.
 *
 * Elle a deux emplois, et deux seulement :
 * 1. les traitements dont le résultat appartient à l'INSTANCE (ré-indexation,
 *    modèle d'embedding, base de connaissances d'aide), à commenter au point
 *    d'appel ;
 * 2. LE repli unique de « je n'ai pas su dériver d'organisation », via
 *    `porteeSansOrganisation` de `@/lib/ai/org-scope` et le champ
 *    `organizationId` laissé à `undefined` dans `@/lib/ai/rerank`. Rendre un
 *    `null` sec à sa place priverait l'auto-hébergement mono-organisation de
 *    sa configuration, silencieusement.
 *
 * Tout chemin qui traite la donnée d'un tenant doit, lui, passer son
 * organisation, dérivée au besoin par `@/lib/ai/org-scope`.
 */
export async function instanceProviderScope(): Promise<ProviderOrgScope> {
  try {
    const rows = await db
      .select({ id: organizations.id })
      .from(organizations)
      .where(eq(organizations.isActive, true))
      .limit(2);
    return rows.length === 1 ? rows[0].id : null;
  } catch (err) {
    logger.warn({ err }, "instanceProviderScope: DB lookup failed, falling back to instance-only scope");
    return null;
  }
}

// ---------------------------------------------------------------------------
// Legacy fallback (env vars)
// ---------------------------------------------------------------------------

async function legacyFallback(
  organizationId: ProviderOrgScope,
): Promise<ResolvedProvider> {
  // Try to find a default provider in DB first, within the requested scope.
  const defaultProvider = await pickDefaultProviderInScope(organizationId);

  if (defaultProvider && defaultProvider.isEnabled) {
    const { provider, connectorType } = buildProviderInstance(defaultProvider);
    const model = defaultProvider.defaultModel || "gemma4:e4b";

    logger.info(
      { provider: defaultProvider.name, model },
      "Using default DB provider (legacy fallback)",
    );

    return {
      provider,
      model,
      providerId: defaultProvider.id,
      providerName: defaultProvider.displayName,
      isFallback: false,
      connectorType,
    };
  }

  // Pure env-based fallback
  const providerName =
    (process.env.DEFAULT_AI_PROVIDER as string) || "ollama";
  const model = process.env.DEFAULT_AI_MODEL || "gemma4:e4b";

  let provider: ReturnType<typeof createAnthropic> | ReturnType<typeof createOpenAI> | ReturnType<typeof createMistral>;
  let connectorType: ResolvedProvider["connectorType"];

  if (providerName === "anthropic" || providerName === "claude") {
    provider = createAnthropic({ apiKey: process.env.ANTHROPIC_API_KEY });
    connectorType = "anthropic";
  } else if (providerName === "mistral") {
    provider = createMistral({ apiKey: process.env.MISTRAL_API_KEY });
    connectorType = "mistral";
  } else {
    // openai_compatible / ollama / anything else
    const baseURL =
      providerName === "ollama"
        ? (process.env.OLLAMA_BASE_URL || "http://localhost:11434") + "/v1"
        : undefined;

    provider = createOpenAI({
      baseURL,
      apiKey: process.env.OPENAI_API_KEY || "no-key",
    });
    connectorType = "openai_compatible";
  }

  logger.info(
    { provider: providerName, model },
    "Using env-based provider (legacy fallback)",
  );

  return {
    provider,
    model,
    providerId: null,
    providerName,
    isFallback: false,
    connectorType,
  };
}

// ---------------------------------------------------------------------------
// Main resolver
// ---------------------------------------------------------------------------

/**
 * Resolve which AI provider and model to use for a given usage type.
 *
 * Resolution order:
 * 1. `ai_model_assignments` entry for the usage type
 * 2. If primary provider disabled or missing → fallback provider from assignment
 * 3. If no assignment exists → legacy fallback (default DB provider or env vars)
 *
 * Cloisonnement : chaque chargement de fournisseur est borné à
 * `organizationId` (celui de l'organisation, ou ceux de portée instance). Les
 * assignations, elles, sont de portée instance (`usage_type` est unique dans
 * `ai_model_assignments`) : une assignation peut donc désigner le fournisseur
 * d'un autre tenant. Ce fournisseur est alors traité comme indisponible, et la
 * résolution poursuit sur le fournisseur de repli puis sur le repli historique,
 * exactement comme pour un fournisseur désactivé.
 */
export async function resolveProviderForUsageInOrg(
  usageType: UsageType,
  organizationId: ProviderOrgScope,
): Promise<ResolvedProvider> {
  try {
    // 1. Look up the assignment for this usage type
    const [assignment] = await db
      .select()
      .from(aiModelAssignments)
      .where(eq(aiModelAssignments.usageType, usageType))
      .limit(1);

    if (!assignment || !assignment.isEnabled) {
      logger.debug(
        { usageType },
        "No active assignment found, using legacy fallback",
      );
      return legacyFallback(organizationId);
    }

    // 2. Load primary provider (borné à la portée demandée)
    const primaryProvider = await loadProviderInScope(
      assignment.providerId,
      organizationId,
    );

    if (primaryProvider && primaryProvider.isEnabled) {
      const { provider, connectorType } = buildProviderInstance(primaryProvider);

      logger.debug(
        {
          usageType,
          provider: primaryProvider.name,
          model: assignment.model,
        },
        "Resolved primary provider for usage",
      );

      return {
        provider,
        model: assignment.model,
        providerId: primaryProvider.id,
        providerName: primaryProvider.displayName,
        isFallback: false,
        connectorType,
      };
    }

    // 3. Primary unavailable — try fallback
    if (assignment.fallbackProviderId && assignment.fallbackModel) {
      const fallbackProvider = await loadProviderInScope(
        assignment.fallbackProviderId,
        organizationId,
      );

      if (fallbackProvider && fallbackProvider.isEnabled) {
        const { provider, connectorType } = buildProviderInstance(fallbackProvider);

        logger.info(
          {
            usageType,
            fallbackProvider: fallbackProvider.name,
            fallbackModel: assignment.fallbackModel,
          },
          "Primary provider unavailable, using fallback",
        );

        return {
          provider,
          model: assignment.fallbackModel,
          providerId: fallbackProvider.id,
          providerName: fallbackProvider.displayName,
          isFallback: true,
          connectorType,
        };
      }
    }

    // 4. Neither primary nor fallback available
    logger.warn(
      { usageType },
      "Neither primary nor fallback provider available, using legacy fallback",
    );
    return legacyFallback(organizationId);
  } catch (err) {
    logger.error(
      { err, usageType },
      "Error resolving provider for usage, falling back to legacy",
    );
    return legacyFallback(organizationId);
  }
}

/**
 * Resolve the embedding provider/model from the admin config.
 *
 * Looks up the active `embeddings` assignment and its provider, then returns a
 * normalised config. Returns `null` when there is no active assignment (or the
 * provider is missing/disabled), so the caller can fall back to env vars.
 *
 * `connectorType` mapping:
 * - `mistral`           → kind "mistral"
 * - `openai_compatible` → kind "openai" (uses `apiBaseUrl`; also covers Ollama
 *                          exposed through an OpenAI-compatible endpoint)
 * - `anthropic`         → `null` (Anthropic has no embeddings API) + warning
 */
export async function resolveEmbeddingProviderInOrg(
  organizationId: ProviderOrgScope,
): Promise<ResolvedEmbeddingProvider | null> {
  try {
    const [assignment] = await db
      .select()
      .from(aiModelAssignments)
      .where(eq(aiModelAssignments.usageType, "embeddings"))
      .limit(1);

    if (!assignment || !assignment.isEnabled) {
      return null;
    }

    const provider = await loadProviderInScope(assignment.providerId, organizationId);

    if (!provider || !provider.isEnabled) {
      logger.debug(
        { usageType: "embeddings" },
        "Embedding assignment provider missing or disabled, falling back to env",
      );
      return null;
    }

    if (provider.connectorType === "anthropic") {
      logger.warn(
        { providerId: provider.id, providerName: provider.displayName },
        "Embedding assignment points to an Anthropic provider, which has no embeddings API; ignoring (env fallback)",
      );
      return null;
    }

    const kind: ResolvedEmbeddingProvider["kind"] =
      provider.connectorType === "mistral" ? "mistral" : "openai";

    return {
      kind,
      apiKey: decryptApiKey(provider.apiKeyEnc),
      baseUrl: provider.apiBaseUrl ?? null,
      model: assignment.model,
      providerId: provider.id,
    };
  } catch (err) {
    logger.error(
      { err },
      "Error resolving embedding provider, caller should fall back to env",
    );
    return null;
  }
}

export interface ResolvedRerankProvider {
  apiKey: string | null;
  /** URL de base du reclassement, sans le segment /rerank final. */
  baseUrl: string;
  model: string;
  providerId: string;
}

/**
 * Resout le fournisseur de reclassement depuis la configuration admin
 * (assignation active de l'usage `rerank`). Rend null si l'assignation est
 * absente, desactivee, si le fournisseur est desactive, ou si son URL de base
 * ne permet pas de deriver une URL de reclassement. Aucun repli sur les
 * variables d'environnement : sans assignation, pas de reclassement.
 */
export async function resolveRerankProviderInOrg(
  organizationId: ProviderOrgScope,
): Promise<ResolvedRerankProvider | null> {
  try {
    const [assignment] = await db
      .select()
      .from(aiModelAssignments)
      .where(eq(aiModelAssignments.usageType, "rerank"))
      .limit(1);

    if (!assignment || !assignment.isEnabled) return null;

    const provider = await loadProviderInScope(assignment.providerId, organizationId);

    if (!provider || !provider.isEnabled) return null;

    const baseUrl = deriveRerankBaseUrl(provider.apiBaseUrl ?? null);
    if (!baseUrl) {
      logger.warn(
        { providerId: provider.id },
        "Rerank assignment provider has no usable base URL, reranking disabled",
      );
      return null;
    }

    return {
      apiKey: decryptApiKey(provider.apiKeyEnc),
      baseUrl,
      model: assignment.model,
      providerId: provider.id,
    };
  } catch (err) {
    logger.error({ err }, "Error resolving rerank provider, reranking disabled");
    return null;
  }
}

/**
 * Vérifie qu'au moins un provider IA est utilisable.
 *
 * Source de vérité = la base (`ai_providers` activés, clés chiffrées,
 * configurés via /admin/ai/providers). Repli sur les anciennes variables
 * d'environnement uniquement si aucun provider n'est en base.
 */
export async function isAnyAIProviderConfigured(): Promise<boolean> {
  try {
    const [row] = await db
      .select({ id: aiProviders.id })
      .from(aiProviders)
      .where(eq(aiProviders.isEnabled, true))
      .limit(1);
    if (row) return true;
  } catch (err) {
    logger.warn({ err }, "isAnyAIProviderConfigured: DB lookup failed");
  }

  return !!(
    process.env.ANTHROPIC_API_KEY ||
    process.env.OPENAI_API_KEY ||
    process.env.MISTRAL_API_KEY ||
    process.env.OLLAMA_BASE_URL
  );
}

/**
 * Vérifie qu'une IA est *réellement configurée par l'admin* et exploitable
 * pour répondre (assistant d'aide, etc.).
 *
 * Plus strict que `isAnyAIProviderConfigured` : on exige une configuration
 * explicite — un provider activé en base, un assignment de modèle actif, ou une
 * clé API d'un provider cloud (Anthropic / OpenAI / Mistral). La seule présence
 * d'`OLLAMA_BASE_URL` (souvent une valeur par défaut, sans modèle servi) ne
 * suffit pas : c'est précisément le cas où l'assistant « cherche » sans pouvoir
 * répondre.
 */
export async function isAiConfiguredForAssistant(): Promise<boolean> {
  try {
    const [provider] = await db
      .select({ id: aiProviders.id })
      .from(aiProviders)
      .where(eq(aiProviders.isEnabled, true))
      .limit(1);
    if (provider) return true;

    const [assignment] = await db
      .select({ id: aiModelAssignments.id })
      .from(aiModelAssignments)
      .where(eq(aiModelAssignments.isEnabled, true))
      .limit(1);
    if (assignment) return true;
  } catch (err) {
    logger.warn({ err }, "isAiConfiguredForAssistant: DB lookup failed");
  }

  return !!(
    process.env.ANTHROPIC_API_KEY ||
    process.env.OPENAI_API_KEY ||
    process.env.MISTRAL_API_KEY
  );
}

async function isAssignmentUsableInOrg(
  usageType: UsageType,
  organizationId: ProviderOrgScope,
): Promise<boolean> {
  try {
    const [assignment] = await db
      .select()
      .from(aiModelAssignments)
      .where(eq(aiModelAssignments.usageType, usageType))
      .limit(1);
    if (!assignment) return false;
    const primary = await loadProviderInScope(assignment.providerId, organizationId);
    if (primary && primary.isEnabled) return true;
    if (assignment.fallbackProviderId && assignment.fallbackModel) {
      const fb = await loadProviderInScope(assignment.fallbackProviderId, organizationId);
      return !!(fb && fb.isEnabled);
    }
    return false;
  } catch {
    return false;
  }
}

/**
 * Usage dédié avec repli sur un autre usage : si `usageType` a une assignation
 * ACTIVE, on le résout ; sinon on résout `fallbackUsage` (même schéma que
 * l'assistant d'aide qui retombe sur « chat »). Le cloisonnement par
 * organisation est celui de `resolveProviderForUsageInOrg`. Rend aussi l'usage
 * effectivement retenu, pour le journal d'utilisation.
 */
export async function getLanguageModelForUsageWithFallbackInOrg(
  usageType: UsageType,
  fallbackUsage: UsageType,
  organizationId: ProviderOrgScope,
): Promise<ResolvedLanguageModel & { usageType: UsageType }> {
  let effective: UsageType = fallbackUsage;
  try {
    const [assignment] = await db
      .select({ id: aiModelAssignments.id })
      .from(aiModelAssignments)
      .where(
        and(
          eq(aiModelAssignments.usageType, usageType),
          eq(aiModelAssignments.isEnabled, true),
        ),
      )
      .limit(1);
    if (assignment) effective = usageType;
  } catch (err) {
    logger.warn({ err, usageType }, "Assignment lookup failed, using fallback usage");
  }
  // Assignation dédiée active mais inutilisable pour cette portée (primaire et
  // repli absents, désactivés ou d'un autre tenant) : repli sur `fallbackUsage`
  // plutôt que sur le défaut de l'organisation.
  if (effective === usageType && !(await isAssignmentUsableInOrg(usageType, organizationId))) {
    effective = fallbackUsage;
  }
  const resolved = await getLanguageModelForUsageInOrg(effective, organizationId);
  return { ...resolved, usageType: effective };
}

/**
 * Convenience wrapper: resolve provider + return a ready-to-use LanguageModel.
 */
export async function getLanguageModelForUsageInOrg(
  usageType: UsageType,
  organizationId: ProviderOrgScope,
): Promise<ResolvedLanguageModel> {
  const resolved = await resolveProviderForUsageInOrg(usageType, organizationId);

  // @ai-sdk/openai v3 : languageModel() route vers Responses API (POST /v1/responses).
  // Ollama et providers openai_compatible ne supportent que Chat Completions.
  // → utiliser .chat() pour ces providers.
  const languageModel =
    resolved.connectorType === "openai_compatible"
      ? (resolved.provider as ReturnType<typeof createOpenAI>).chat(resolved.model)
      : resolved.provider.languageModel(resolved.model);

  return {
    languageModel,
    providerId: resolved.providerId,
    providerName: resolved.providerName,
    model: resolved.model,
    isFallback: resolved.isFallback,
  };
}
