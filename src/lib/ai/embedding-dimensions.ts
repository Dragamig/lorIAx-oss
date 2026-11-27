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

export {
  KNOWN_EMBEDDING_DIMENSIONS,
  requestedEmbeddingDimensions,
  dimensionForModel,
} from "@/lib/ai/embedding-model-dimensions";
import { dimensionForModel } from "@/lib/ai/embedding-model-dimensions";

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
