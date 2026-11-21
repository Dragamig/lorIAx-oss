/**
 * Résolution ET validation de l'espace cible d'une action d'automatisation
 * (constat INJ-12 de l'audit du 2026-08-19, relevé pendant le lot 6).
 *
 * `create_document` et `create_design` résolvaient leur espace par une cascade
 * `cfg.spaceId` (interpolé) → `ctx.spaceId` → `automation.spaceId`, puis
 * écrivaient dedans sans plus de contrôle. Le premier terme de la cascade vient
 * de la CONFIGURATION de l'action, donc de quiconque peut éditer
 * l'automatisation : connaître l'UUID d'un espace d'une AUTRE organisation
 * suffisait à y déposer un document ou un design.
 *
 * Pourquoi ne pas appeler les gardes habituelles (`getRequestOrgId`,
 * `checkSpaceWriteAccess`, `requireOrgScoped`) : les actions s'exécutent depuis
 * `server.ts`, dans une boucle `setInterval`, hors de tout contexte de requête.
 * Ces fonctions descendent sur `headers()` de `next/headers`, qui y échoue.
 * Même démarche que `lib/video/source-key-access.ts` : le contrôle est
 * réimplémenté sans contexte de requête, en remplaçant l'organisation « de la
 * requête » par une ANCRE structurelle, l'organisation de l'automatisation
 * elle-même. `getSpacePermission` (`lib/auth/check-access.ts`) reste utilisable
 * telle quelle : elle prend un identifiant d'utilisateur, pas des en-têtes, et
 * ne lit que la base.
 *
 * L'ancre se remonte comme dans `lib/ai/org-scope.ts` : `spaces` est la seule
 * table qui porte `organization_id` en NOT NULL. Un workflow autonome pointe
 * directement son espace ; une automatisation base-liée a `spaceId` nul et
 * passe par `user_databases.space_id`, NOT NULL lui aussi. Les deux colonnes de
 * l'automatisation étant nullables (invariant seulement applicatif), une ligne
 * sans ancre est représentable : elle vaut refus, jamais laissez-passer.
 *
 * Règles appliquées, dans l'ordre :
 *
 * 1. Aucun espace demandé (ni config, ni contexte, ni automatisation) : rien à
 *    valider, on rend `undefined`. C'est l'appelant qui décide si l'absence est
 *    une erreur (`create_document`) ou un cas normal (`create_design`, dont un
 *    gabarit global n'a pas besoin d'espace).
 * 2. Espace demandé = espace de l'automatisation : accepté sans autre contrôle,
 *    c'est le périmètre propre du workflow.
 * 3. Espace introuvable, ou d'une autre organisation que l'ancre : REFUS. C'est
 *    le trou principal, il se ferme là.
 * 4. Même organisation mais autre espace : l'acteur (utilisateur déclencheur
 *    sinon créateur de l'automatisation) doit y détenir un droit d'ÉCRITURE,
 *    `editor` ou `admin`. Sans acteur identifiable, refus.
 *
 * Le message de refus ne distingue jamais « espace inexistant » de « espace
 * d'une autre organisation » : il ne doit pas servir d'oracle d'existence.
 */
import { eq } from "drizzle-orm";
import { db } from "@/lib/db";
import { spaces, userDatabases } from "@/lib/db/schema";
import { getSpacePermission } from "@/lib/auth/check-access";
import { interpolate } from "@/lib/automations/interpolate";
import type { AutomationRow, ExecutionContext } from "./actions/types";

/**
 * Refus de cible : erreur explicite, destinée à remonter telle quelle dans le
 * journal d'exécution de l'automatisation (`automation_runs`).
 */
export class AutomationTargetSpaceError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "AutomationTargetSpaceError";
  }
}

/** Niveaux de permission d'espace valant un droit d'écriture. */
export const WRITE_LEVELS = new Set(["editor", "admin"]);

/** Ancre d'organisation d'une automatisation : son espace et son organisation. */
export interface AutomationAnchor {
  spaceId: string;
  organizationId: string;
}

/** Organisation propriétaire d'un espace, ou null si l'espace n'existe pas. */
export async function organizationOfSpace(spaceId: string): Promise<string | null> {
  const [row] = await db
    .select({ organizationId: spaces.organizationId })
    .from(spaces)
    .where(eq(spaces.id, spaceId))
    .limit(1);
  return row?.organizationId ?? null;
}

/**
 * Ancre de l'automatisation : `spaceId` direct s'il existe, sinon l'espace de
 * sa base. Rend null quand rien n'est déterminable (ligne sans base ni espace,
 * base ou espace supprimé).
 */
export async function resolveAutomationAnchor(
  automation: AutomationRow
): Promise<AutomationAnchor | null> {
  let anchorSpaceId = automation.spaceId ?? null;

  if (!anchorSpaceId && automation.databaseId) {
    const [row] = await db
      .select({ spaceId: userDatabases.spaceId })
      .from(userDatabases)
      .where(eq(userDatabases.id, automation.databaseId))
      .limit(1);
    anchorSpaceId = row?.spaceId ?? null;
  }

  if (!anchorSpaceId) return null;

  const organizationId = await organizationOfSpace(anchorSpaceId);
  if (!organizationId) return null;

  return { spaceId: anchorSpaceId, organizationId };
}

export interface ResolveTargetSpaceInput {
  /** Nom de l'action, repris dans les messages de refus. */
  actionType: string;
  /** `spaceId` de la config de l'action, NON interpolé (interpolé ici). */
  configSpaceId?: string;
  automation: AutomationRow;
  ctx: ExecutionContext;
}

/**
 * Résout l'espace cible d'une action et le valide contre l'organisation de
 * l'automatisation. Rend `undefined` quand aucune source n'en désigne un ;
 * lève {@link AutomationTargetSpaceError} dès qu'un espace est désigné mais
 * hors périmètre.
 */
export async function resolveTargetSpaceId({
  actionType,
  configSpaceId,
  automation,
  ctx,
}: ResolveTargetSpaceInput): Promise<string | undefined> {
  const requested =
    (configSpaceId ? interpolate(configSpaceId, ctx) : undefined) ||
    ctx.spaceId ||
    automation.spaceId ||
    undefined;

  // Aucune cible demandée : rien à valider, l'appelant tranche.
  if (!requested) return undefined;

  const deny = (raison: string): never => {
    throw new AutomationTargetSpaceError(
      `${actionType} : espace cible refusé (${raison})`
    );
  };

  const anchor = await resolveAutomationAnchor(automation);
  if (!anchor) {
    return deny("organisation de l'automatisation indéterminable");
  }

  // L'espace propre de l'automatisation est toujours acceptable.
  if (requested === anchor.spaceId) return requested;

  // Espace inexistant et espace d'une autre organisation partagent le même
  // message : ne pas divulguer l'existence de l'espace visé.
  const requestedOrgId = await organizationOfSpace(requested);
  if (!requestedOrgId || requestedOrgId !== anchor.organizationId) {
    return deny("hors du périmètre de l'automatisation");
  }

  // Même organisation, autre espace : droit d'écriture exigé sur la cible.
  const actorId = ctx.user?.id ?? automation.createdBy ?? undefined;
  if (!actorId) {
    return deny("aucun acteur identifiable pour vérifier les droits d'écriture");
  }

  const level = await getSpacePermission(actorId, requested);
  if (!level || !WRITE_LEVELS.has(level)) {
    return deny("droit d'écriture manquant sur l'espace demandé");
  }

  return requested;
}
