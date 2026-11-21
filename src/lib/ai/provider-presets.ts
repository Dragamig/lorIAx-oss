// ---------------------------------------------------------------------------
// Catalogue des fournisseurs IA (presets)
//
// L'admin choisit un fournisseur par son nom plutôt qu'un « connecteur »
// technique. Chaque preset porte le bon connecteur sous le capot, le bon
// modèle d'URL, le mode d'authentification et une aide contextuelle.
//
// Fichier 100 % données + helpers purs : importable côté client.
// ---------------------------------------------------------------------------

export type ConnectorType = "anthropic" | "openai_compatible" | "mistral";

export interface ProviderPreset {
  /** Clé stable du preset (usage interne UI). */
  id: string;
  /** Nom affiché à l'utilisateur. */
  label: string;
  /** Connecteur technique utilisé sous le capot. */
  connectorType: ConnectorType;
  /**
   * Modèle d'URL de base. Peut contenir le jeton `{product_id}` (Infomaniak)
   * qui sera substitué par la valeur saisie par l'utilisateur.
   */
  baseUrl: string;
  /** Une clé API est-elle requise ? (faux pour Ollama local). */
  needsKey: boolean;
  /** Le fournisseur exige-t-il un identifiant produit dans l'URL ? */
  needsProductId?: boolean;
  /** Nom proposé par défaut dans le champ « Nom affiché ». */
  defaultDisplayName: string;
  /** Aide contextuelle affichée sous le sélecteur. */
  help?: string;
  /** Placeholder du champ clé API. */
  keyPlaceholder?: string;
}

export const PRODUCT_ID_TOKEN = "{product_id}";

export const PROVIDER_PRESETS: ProviderPreset[] = [
  {
    id: "ollama",
    label: "Ollama (local)",
    connectorType: "openai_compatible",
    baseUrl: "http://localhost:11434/v1",
    needsKey: false,
    defaultDisplayName: "Ollama local",
    help: "Serveur Ollama auto-hébergé. Aucune clé requise.",
  },
  {
    id: "infomaniak",
    label: "Infomaniak AI Services",
    connectorType: "openai_compatible",
    baseUrl: `https://api.infomaniak.com/2/ai/${PRODUCT_ID_TOKEN}/openai/v1`,
    needsKey: true,
    needsProductId: true,
    defaultDisplayName: "Infomaniak AI",
    help: "Souverain (CH). Renseignez l'identifiant de votre produit « Service IA » (Manager Infomaniak) et votre token d'API.",
    keyPlaceholder: "Token Infomaniak",
  },
  {
    id: "openrouter",
    label: "OpenRouter",
    connectorType: "openai_compatible",
    baseUrl: "https://openrouter.ai/api/v1",
    needsKey: true,
    defaultDisplayName: "OpenRouter",
    help: "Agrégateur multi-modèles compatible OpenAI.",
    keyPlaceholder: "sk-or-...",
  },
  {
    id: "anthropic",
    label: "Anthropic (Claude)",
    connectorType: "anthropic",
    baseUrl: "https://api.anthropic.com",
    needsKey: true,
    defaultDisplayName: "Anthropic",
    help: "API Claude officielle.",
    keyPlaceholder: "sk-ant-...",
  },
  {
    id: "gemini",
    label: "Google Gemini",
    connectorType: "openai_compatible",
    baseUrl: "https://generativelanguage.googleapis.com/v1beta/openai",
    needsKey: true,
    defaultDisplayName: "Gemini",
    help: "Endpoint compatible OpenAI de Google Gemini.",
    keyPlaceholder: "Clé API Google AI Studio",
  },
  {
    id: "mistral",
    label: "Mistral AI",
    connectorType: "mistral",
    baseUrl: "https://api.mistral.ai",
    needsKey: true,
    defaultDisplayName: "Mistral AI",
    help: "API Mistral officielle (souverain FR).",
    keyPlaceholder: "Clé API Mistral",
  },
  {
    id: "openai",
    label: "OpenAI",
    connectorType: "openai_compatible",
    baseUrl: "https://api.openai.com/v1",
    needsKey: true,
    defaultDisplayName: "OpenAI",
    keyPlaceholder: "sk-...",
  },
  {
    id: "huggingface",
    label: "Hugging Face",
    connectorType: "openai_compatible",
    baseUrl: "https://router.huggingface.co/v1",
    needsKey: true,
    defaultDisplayName: "Hugging Face",
    help: "Routeur d'inférence Hugging Face compatible OpenAI.",
    keyPlaceholder: "hf_...",
  },
  {
    id: "nvidia",
    label: "NVIDIA NIM",
    connectorType: "openai_compatible",
    baseUrl: "https://integrate.api.nvidia.com/v1",
    needsKey: true,
    defaultDisplayName: "NVIDIA NIM",
    help: "Microservices d'inférence NVIDIA (build.nvidia.com), compatibles OpenAI.",
    keyPlaceholder: "nvapi-...",
  },
  {
    id: "custom",
    label: "Personnalisé (avancé)",
    connectorType: "openai_compatible",
    baseUrl: "",
    needsKey: true,
    defaultDisplayName: "",
    help: "Configuration manuelle : choisissez le connecteur et l'URL de base.",
  },
];

export function getPreset(id: string): ProviderPreset | undefined {
  return PROVIDER_PRESETS.find((p) => p.id === id);
}

/** Construit l'URL de base effective en substituant le product_id si besoin. */
export function buildPresetBaseUrl(
  preset: ProviderPreset,
  productId: string
): string {
  if (!preset.needsProductId) return preset.baseUrl;
  return preset.baseUrl.replace(
    PRODUCT_ID_TOKEN,
    encodeURIComponent(productId.trim())
  );
}

/** True si l'URL contient encore le jeton non substitué (product_id manquant). */
export function hasUnresolvedProductId(baseUrl: string): boolean {
  return baseUrl.includes(PRODUCT_ID_TOKEN);
}

/**
 * Devine le preset d'un fournisseur existant à partir de son connecteur et de
 * son URL de base (pour l'édition). Renvoie "custom" si aucune correspondance.
 */
export function inferPresetId(
  connectorType: ConnectorType,
  baseUrl: string | null
): string {
  const url = (baseUrl || "").replace(/\/+$/, "");
  if (connectorType === "anthropic") return "anthropic";
  if (connectorType === "mistral") return "mistral";
  if (url.startsWith("https://api.infomaniak.com")) return "infomaniak";
  if (url.startsWith("https://openrouter.ai")) return "openrouter";
  if (url.startsWith("https://generativelanguage.googleapis.com")) return "gemini";
  if (url.startsWith("https://api.openai.com")) return "openai";
  if (url.startsWith("https://router.huggingface.co")) return "huggingface";
  if (url.startsWith("https://integrate.api.nvidia.com")) return "nvidia";
  if (url.startsWith("http://localhost:11434") || url.includes(":11434"))
    return "ollama";
  return "custom";
}

/** Extrait le product_id d'une URL Infomaniak existante. */
export function extractProductId(baseUrl: string | null): string {
  const m = (baseUrl || "").match(/\/ai\/([^/]+)\/openai/);
  return m ? decodeURIComponent(m[1]) : "";
}
