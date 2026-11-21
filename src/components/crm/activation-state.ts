import type { CandidateStatus } from "@/lib/crm/plan";
import { CRM_ROLES, type CrmActivateBodyV2, type CrmRole } from "@/lib/crm/fields";
import type { ActivationPreview } from "@/lib/crm/preview";

export type RoleMode = "connect" | "complete" | "create";

export interface ActivationState {
  orgSlug: string;
  /** `"create"` : créer l'espace des bases. */
  spaceId: string | "create";
  roles: Record<CrmRole, { mode: RoleMode; databaseId: string | null }>;
  /** Rôles dont le serveur a refusé la création (nom déjà pris hors de l'aperçu) : valeur = nom de la base. */
  blockedCreate?: Partial<Record<CrmRole, string>>;
}

export interface ModeAvailability {
  ok: boolean;
  /** Clé i18n dans le namespace `crm` (jamais de texte en dur). */
  reason?: string;
  /** Valeurs d'interpolation de la raison. */
  reasonValues?: Record<string, string>;
}

type CandidateLike = { status: CandidateStatus };

export function defaultMode(_role: CrmRole, candidates: readonly CandidateLike[]): RoleMode {
  if (candidates.some((c) => c.status === "compatible")) return "connect";
  if (candidates.some((c) => c.status === "almost")) return "complete";
  return "create";
}

/** Rôle (autre que `role`) qui utilise déjà cette base en raccordement ou complétion. */
export function takenBy(databaseId: string, role: CrmRole, state: ActivationState): CrmRole | null {
  for (const other of CRM_ROLES) {
    if (other === role) continue;
    const r = state.roles[other];
    if (r.mode !== "create" && r.databaseId === databaseId) return other;
  }
  return null;
}

/**
 * Collision de nom pour un rôle créé : la base du même nom dans l'espace cible. Les collisions de
 * l'aperçu portent sur l'espace suggéré : toute autre cible (dont un espace à créer) n'en a pas.
 */
export function collisionOf(
  role: CrmRole,
  preview: Pick<ActivationPreview, "collisions" | "suggestedSpaceId">,
  spaceId: string | "create" | null = preview.suggestedSpaceId,
): { databaseId: string; name: string } | null {
  if (spaceId === null || spaceId !== preview.suggestedSpaceId) return null;
  return preview.collisions[role][0] ?? null;
}

export function availableModes(
  role: CrmRole,
  state: ActivationState,
  preview: ActivationPreview,
): Record<RoleMode, ModeAvailability> {
  const candidates = preview.roles[role].candidates;
  const free = (status: CandidateStatus) =>
    candidates.filter((c) => c.status === status && takenBy(c.databaseId, role, state) === null);
  const any = (status: CandidateStatus) => candidates.some((c) => c.status === status);

  const unavailable = (status: CandidateStatus, emptyKey: string): ModeAvailability =>
    free(status).length > 0
      ? { ok: true }
      : { ok: false, reason: any(status) ? "activation.mode.allTaken" : emptyKey };

  const collision = collisionOf(role, preview, state.spaceId);
  return {
    connect: unavailable("compatible", "activation.mode.connectUnavailable"),
    complete: unavailable("almost", "activation.mode.completeUnavailable"),
    create: collision
      ? { ok: false, reason: "activation.mode.createUnavailable", reasonValues: { name: collision.name } }
      : state.blockedCreate?.[role]
        ? { ok: false, reason: "activation.mode.createUnavailable", reasonValues: { name: state.blockedCreate[role] as string } }
        : { ok: true },
  };
}

export function isSpaceSelectorDisabled(state: ActivationState): boolean {
  return !CRM_ROLES.some((r) => state.roles[r].mode === "create");
}

/** Rôles raccordés ou complétés sans base choisie (Confirmer doit alors rester désactivé). */
export function missingBases(state: ActivationState): CrmRole[] {
  return CRM_ROLES.filter((r) => state.roles[r].mode !== "create" && !state.roles[r].databaseId);
}

/** Rôles dont le mode courant est indisponible (collision en create, base prise, etc.). */
export function invalidRoles(state: ActivationState, preview: ActivationPreview): CrmRole[] {
  return CRM_ROLES.filter((r) => !availableModes(r, state, preview)[state.roles[r].mode].ok);
}

/**
 * État initial : pour chaque rôle, premier mode disponible (connect, complete, create) avec sa base.
 * En collision, la base existante est la cible préférée (connect si compatible, complete si presque).
 * Si rien n'est disponible, le rôle reste en create (signalé par `invalidRoles`).
 */
export function initialState(preview: ActivationPreview, orgSlug: string): ActivationState {
  const state: ActivationState = {
    orgSlug,
    spaceId: preview.suggestedSpaceId ?? "create",
    roles: {
      contacts: { mode: "create", databaseId: null },
      dossiers: { mode: "create", databaseId: null },
      interactions: { mode: "create", databaseId: null },
    },
  };
  for (const role of CRM_ROLES) {
    const modes = availableModes(role, state, preview);
    const collided = collisionOf(role, preview, state.spaceId)?.databaseId;
    const pick = (status: CandidateStatus): string | null => {
      const free = preview.roles[role].candidates.filter(
        (c) => c.status === status && takenBy(c.databaseId, role, state) === null,
      );
      return (free.find((c) => c.databaseId === collided) ?? free[0])?.databaseId ?? null;
    };
    const wanted: RoleMode[] = ["connect", "complete", "create"];
    const mode = wanted.find((m) => modes[m].ok) ?? "create";
    const databaseId = mode === "connect" ? pick("compatible") : mode === "complete" ? pick("almost") : null;
    state.roles[role] = { mode, databaseId };
  }
  return state;
}

/** Corps de `POST activate` : jamais d'`orgId` ni de colonnes, le serveur recalcule le plan. */
export function toRequestBody(state: ActivationState): CrmActivateBodyV2 {
  const missing = missingBases(state);
  if (missing.length > 0) throw new Error(`Base manquante pour : ${missing.join(", ")}`);
  const roles: CrmActivateBodyV2["roles"] = {};
  for (const role of CRM_ROLES) {
    const { mode, databaseId } = state.roles[role];
    if (mode === "create") roles[role] = { mode: "create" };
    else roles[role] = { mode, databaseId: databaseId as string };
  }
  return {
    space: state.spaceId === "create" ? { mode: "create" } : { mode: "existing", spaceId: state.spaceId },
    roles,
  };
}
