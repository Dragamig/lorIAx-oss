import { dimensionForModel } from "@/lib/ai/embedding-model-dimensions";

export interface AssignedEmbedding {
  providerId: string;
  model: string;
}

export interface CurrentEmbeddingIndex {
  providerId: string | null;
  model: string;
  dimensions: number;
}

export type EmbeddingAssignmentState =
  | "unassigned"
  | "no-index"
  | "same"
  | "different";

/**
 * Compare l'assignation enregistrée au modèle de l'index actuel.
 * Identique = même modèle, même fournisseur et, si la dimension assignée est
 * connue, même dimension. Fonction pure.
 */
export function compareAssignedToCurrent(
  assigned: AssignedEmbedding | null | undefined,
  current: CurrentEmbeddingIndex | null | undefined
): EmbeddingAssignmentState {
  if (!assigned || !assigned.model) return "unassigned";
  if (!current) return "no-index";
  const sameModel = assigned.model === current.model;
  const sameProvider = (assigned.providerId || null) === (current.providerId || null);
  const dim = dimensionForModel(assigned.model);
  const sameDim = dim == null || dim === current.dimensions;
  return sameModel && sameProvider && sameDim ? "same" : "different";
}
