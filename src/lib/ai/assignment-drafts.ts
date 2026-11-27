// Fonctions pures pour l'édition par brouillon des assignations modèle/usage.

export const DEFAULT_TIMEOUT_SECONDS = 30;
export const DEFAULT_MAX_RETRIES = 1;

export interface AssignmentLike {
  usageType: string;
  providerId?: string | null;
  model?: string | null;
  fallbackProviderId?: string | null;
  fallbackModel?: string | null;
  timeoutSeconds?: number | null;
  maxRetries?: number | null;
  isEnabled?: boolean | null;
}

export interface AssignmentDraft {
  providerId: string;
  model: string;
  fallbackProviderId: string;
  fallbackModel: string;
  timeoutSeconds: number;
  maxRetries: number;
  isEnabled: boolean;
}

export type DraftMap = Record<string, AssignmentDraft>;

export interface SaveResult {
  usageType: string;
  ok: boolean;
  /** Snapshot du brouillon tel qu'envoyé au serveur. */
  sent: AssignmentDraft;
}

export function toDraft(a?: Partial<AssignmentLike> | null): AssignmentDraft {
  return {
    providerId: a?.providerId || "",
    model: a?.model || "",
    fallbackProviderId: a?.fallbackProviderId || "",
    fallbackModel: a?.fallbackModel || "",
    timeoutSeconds: a?.timeoutSeconds ?? DEFAULT_TIMEOUT_SECONDS,
    maxRetries: a?.maxRetries ?? DEFAULT_MAX_RETRIES,
    isEnabled: a?.isEnabled ?? true,
  };
}

export function buildPristine(assignments: AssignmentLike[]): DraftMap {
  const out: DraftMap = {};
  for (const a of assignments) out[a.usageType] = toDraft(a);
  return out;
}

function norm(d: Partial<AssignmentDraft> | undefined | null): AssignmentDraft {
  return toDraft(d);
}

export function draftsEqual(
  a: Partial<AssignmentDraft> | undefined | null,
  b: Partial<AssignmentDraft> | undefined | null
): boolean {
  const x = norm(a);
  const y = norm(b);
  return (
    x.providerId === y.providerId &&
    x.model === y.model &&
    x.fallbackProviderId === y.fallbackProviderId &&
    x.fallbackModel === y.fallbackModel &&
    x.timeoutSeconds === y.timeoutSeconds &&
    x.maxRetries === y.maxRetries &&
    x.isEnabled === y.isEnabled
  );
}

export function isRowDirty(
  pristine: Partial<AssignmentDraft> | undefined | null,
  draft: Partial<AssignmentDraft> | undefined | null
): boolean {
  return !draftsEqual(pristine, draft);
}

export function dirtyUsages(pristine: DraftMap, drafts: DraftMap): string[] {
  return Object.keys(drafts).filter((u) =>
    isRowDirty(pristine[u], drafts[u])
  );
}

export function countDirty(pristine: DraftMap, drafts: DraftMap): number {
  return dirtyUsages(pristine, drafts).length;
}

/**
 * Fusionne le résultat d'un enregistrement : un usage ne devient pristine que
 * s'il a réussi ET si son brouillon courant égale le snapshot envoyé (sinon
 * l'utilisateur a modifié pendant l'envoi et la ligne reste dirty).
 */
export function applySavedRows(
  pristine: DraftMap,
  drafts: DraftMap,
  results: SaveResult[]
): DraftMap {
  const next: DraftMap = { ...pristine };
  for (const r of results) {
    if (!r.ok) continue;
    if (draftsEqual(drafts[r.usageType], r.sent)) {
      next[r.usageType] = { ...norm(r.sent) };
    }
  }
  return next;
}

export function resetRow(
  pristine: DraftMap,
  drafts: DraftMap,
  usageType: string
): DraftMap {
  return { ...drafts, [usageType]: norm(pristine[usageType]) };
}

export function resetAll(pristine: DraftMap, drafts: DraftMap): DraftMap {
  const next: DraftMap = { ...drafts };
  for (const u of Object.keys(next)) next[u] = norm(pristine[u]);
  return next;
}

export function validateDraft(
  draft: Partial<AssignmentDraft> | undefined | null
): { valid: boolean; errors: string[] } {
  const d = norm(draft);
  const errors: string[] = [];
  if (!d.providerId.trim()) errors.push("providerId");
  if (!d.model.trim()) errors.push("model");
  return { valid: errors.length === 0, errors };
}
