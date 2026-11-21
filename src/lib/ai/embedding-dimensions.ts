import { getSetting } from "@/lib/settings/system-settings";
import {
  instanceProviderScope,
  resolveEmbeddingProviderInOrg,
} from "@/lib/ai/provider-resolver";
import logger from "@/lib/logger";

// ============================================================
// Dimension vectorielle d'embedding — source de vérité unifiée
//
// Un seul modèle d'embedding sert aux documents utilisateur ET à la KB d'aide
// (usage `embeddings` unique). Changer de modèle change la dimension du vecteur,
// donc la définition SQL des colonnes `document_embeddings.embedding` et
// `kb_chunks.embedding`. Ce module centralise la résolution de la dimension
// active et la table des dimensions connues.
// ============================================================

/** Dimension par défaut si rien n'est résolu (mistral-embed). */
export const DEFAULT_EMBEDDING_DIMENSION = 1024;

/**
 * Dimensions connues par modèle (clé en minuscules, sans préfixe fournisseur).
 * Sert à éviter une sonde réseau quand le modèle est connu.
 */
export const KNOWN_EMBEDDING_DIMENSIONS: Record<string, number> = {
  "mistral-embed": 1024,
  "text-embedding-3-small": 1536,
  "text-embedding-3-large": 3072,
  "text-embedding-ada-002": 1536,
  "bge-m3": 1024,
  "multilingual-e5-large": 1024,
  "nomic-embed-text": 768,
  // Modèles Infomaniak (dimensions mesurées en production).
  "qwen3-embedding-8b": 4096,
  bge_multilingual_gemma2: 3584,
  mini_lm_l12_v2: 384,
};

/**
 * Préfixes fournisseur courants retirés avant le matching (ex. `openai/`,
 * `mistral/`, namespaces HuggingFace). Insensible à la casse.
 */
const KNOWN_PREFIXES = [
  "openai/",
  "mistral/",
  "mistralai/",
  "ollama/",
  "models/",
  "huggingface/",
  "hf/",
  "baai/",
  "intfloat/",
  "nomic-ai/",
  "qwen/",
];

/**
 * Dimension connue pour un nom de modèle. Matching insensible à la casse,
 * tolérant aux préfixes fournisseur et aux suffixes de version/quantization
 * (ex. `bge-m3:latest`, `BAAI/bge-m3-Q4`). Renvoie `null` si inconnu.
 * Fonction pure.
 */
export function dimensionForModel(model: string | null | undefined): number | null {
  if (!model) return null;

  let normalized = model.trim().toLowerCase();
  if (!normalized) return null;

  // Retire un préfixe fournisseur connu (un seul).
  for (const prefix of KNOWN_PREFIXES) {
    if (normalized.startsWith(prefix)) {
      normalized = normalized.slice(prefix.length);
      break;
    }
  }

  // Retire un suffixe de tag/quantization après ':' (ex. ollama "bge-m3:latest").
  const colonIdx = normalized.indexOf(":");
  const base = colonIdx >= 0 ? normalized.slice(0, colonIdx) : normalized;

  // Correspondance exacte (base sans tag, puis nom complet normalisé).
  if (KNOWN_EMBEDDING_DIMENSIONS[base] != null) return KNOWN_EMBEDDING_DIMENSIONS[base];
  if (KNOWN_EMBEDDING_DIMENSIONS[normalized] != null) return KNOWN_EMBEDDING_DIMENSIONS[normalized];

  // Correspondance tolérante : une clé connue contenue dans le nom du modèle.
  for (const [key, dim] of Object.entries(KNOWN_EMBEDDING_DIMENSIONS)) {
    if (base.includes(key) || normalized.includes(key)) return dim;
  }

  return null;
}

/** Forme stockée dans `system_settings.embedding_active`. */
export interface EmbeddingActive {
  providerId: string | null;
  model: string;
  dimensions: number;
}

/**
 * Modèle d'embedding actif résolu (config admin `embeddings`, sinon ENV).
 * Renvoie `null` si aucun modèle n'est résolvable.
 */
export async function resolveActiveEmbeddingModel(): Promise<string | null> {
  try {
    // Portée instance assumée : la dimension résolue ici définit une colonne
    // SQL unique, partagée par toutes les organisations (`document_embeddings`,
    // `kb_chunks`). Il n'existe pas de modèle d'embedding « par tenant » à
    // résoudre, et une portée d'organisation n'aurait donc rien à décider ici.
    const admin = await resolveEmbeddingProviderInOrg(await instanceProviderScope());
    if (admin?.model) return admin.model;
  } catch (err) {
    logger.warn({ err }, "resolveActiveEmbeddingModel: résolution admin échouée");
  }
  return process.env.EMBEDDING_MODEL || null;
}

/**
 * Dimension d'embedding active (source de vérité pour la définition des
 * colonnes vectorielles). Ordre :
 *  1. `system_settings.embedding_active.dimensions` (figée après ré-indexation) ;
 *  2. déduite du modèle résolu (admin → ENV) via la table connue ;
 *  3. défaut {@link DEFAULT_EMBEDDING_DIMENSION}.
 */
export async function getActiveEmbeddingDimension(): Promise<number> {
  // 1. Source de vérité explicite.
  try {
    const active = await getSetting<EmbeddingActive>("embedding_active");
    if (active && typeof active.dimensions === "number" && active.dimensions > 0) {
      return active.dimensions;
    }
  } catch (err) {
    logger.warn({ err }, "getActiveEmbeddingDimension: lecture embedding_active échouée");
  }

  // 2. Déduction depuis le modèle résolu.
  const model = await resolveActiveEmbeddingModel();
  const known = dimensionForModel(model);
  if (known != null) return known;

  // 3. Défaut.
  return DEFAULT_EMBEDDING_DIMENSION;
}

/**
 * Sonde réseau : génère un embedding court et renvoie la longueur du vecteur.
 * Dernier recours quand le modèle est inconnu, et validation de la dimension.
 * Import dynamique de `embeddings.ts` pour éviter un cycle d'import.
 */
export async function probeEmbeddingDimension(): Promise<number> {
  const { generateEmbedding } = await import("@/lib/ai/embeddings");
  const vector = await generateEmbedding("dimension probe");
  return vector.length;
}
