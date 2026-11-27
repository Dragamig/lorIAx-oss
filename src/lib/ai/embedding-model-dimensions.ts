// Table des dimensions d'embedding connues. Module pur, sans import serveur,
// utilisable depuis les composants client.

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
  // Modèles Infomaniak. Qwen3-Embedding-8B est natif en 4096 dimensions mais
  // appelé avec `dimensions: 1024` (troncature Matryoshka côté serveur, vecteur
  // déjà normalisé) pour garder les colonnes `vector(1024)` et l'index HNSW
  // (limite pgvector de 2000 dimensions). Nom exact côté API : `Qwen/Qwen3-Embedding-8B`.
  "qwen3-embedding-8b": 1024,
  bge_multilingual_gemma2: 3584,
  mini_lm_l12_v2: 384,
};

/** Modèles tronqués par le paramètre OpenAI `dimensions` (Matryoshka). */
const MATRYOSHKA_TRUNCATED_MODELS: Record<string, number> = {
  "qwen3-embedding-8b": 1024,
};

/**
 * Dimension à demander explicitement au fournisseur (paramètre `dimensions`)
 * pour les modèles à troncature Matryoshka, `undefined` sinon. Même
 * normalisation du nom que {@link dimensionForModel} (casse, préfixe `qwen/`).
 */
export function requestedEmbeddingDimensions(
  model: string | null | undefined
): number | undefined {
  if (!model) return undefined;
  let normalized = model.trim().toLowerCase();
  for (const prefix of KNOWN_PREFIXES) {
    if (normalized.startsWith(prefix)) {
      normalized = normalized.slice(prefix.length);
      break;
    }
  }
  return MATRYOSHKA_TRUNCATED_MODELS[normalized];
}

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

