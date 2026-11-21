/**
 * Résolution ET validation de la base cible de `create_row` / `update_row`.
 *
 * Même modèle que `target-space.ts` : la base visée peut venir de la
 * CONFIGURATION de l'action (`databaseId`, interpolable), donc de quiconque
 * édite l'automatisation. Règles, dans l'ordre :
 *
 * 1. Aucune base configurée : base de l'automatisation (périmètre propre).
 * 2. Base demandée = base de l'automatisation : acceptée sans autre contrôle.
 * 3. Base introuvable, ou d'une autre organisation que l'ancre structurelle de
 *    l'automatisation : REFUS, même message (pas d'oracle d'existence).
 * 4. Même organisation, autre base : l'AUTEUR de l'automatisation (`createdBy`)
 *    doit détenir un droit d'écriture (`editor`/`admin`) sur l'espace de la
 *    base cible, via `getSpacePermission` (ou simplement de lecture quand
 *    `access: "read"`, pour `find_row`). Sans auteur, refus.
 */
import { eq } from "drizzle-orm";
import { db } from "@/lib/db";
import { userDatabases } from "@/lib/db/schema";
import { getSpacePermission } from "@/lib/auth/check-access";
import { interpolate } from "@/lib/automations/interpolate";
import {
  AutomationTargetSpaceError,
  WRITE_LEVELS,
  organizationOfSpace,
  resolveAutomationAnchor,
} from "./target-space";
import type { AutomationRow, ExecutionContext } from "./actions/types";

export interface ResolveTargetDatabaseInput {
  actionType: string;
  /** `databaseId` de la config de l'action, NON interpolé (interpolé ici). */
  configDatabaseId?: string;
  automation: AutomationRow;
  ctx: ExecutionContext;
  /** Niveau exigé de l'auteur sur l'espace cible : écriture (défaut) ou lecture. */
  access?: "write" | "read";
}

export async function resolveTargetDatabaseId({
  actionType,
  configDatabaseId,
  automation,
  ctx,
  access = "write",
}: ResolveTargetDatabaseInput): Promise<string> {
  const interpolated = configDatabaseId
    ? interpolate(configDatabaseId, ctx).trim()
    : "";
  const requested = interpolated || automation.databaseId || undefined;

  const deny = (raison: string): never => {
    throw new AutomationTargetSpaceError(
      `${actionType} : base cible refusée (${raison})`
    );
  };

  if (!requested) {
    return deny("aucune base cible");
  }
  if (requested === automation.databaseId) return requested;

  const anchor = await resolveAutomationAnchor(automation);
  if (!anchor) {
    return deny("organisation de l'automatisation indéterminable");
  }

  const [target] = await db
    .select({ spaceId: userDatabases.spaceId })
    .from(userDatabases)
    .where(eq(userDatabases.id, requested))
    .limit(1);
  const targetOrgId = target ? await organizationOfSpace(target.spaceId) : null;
  if (!target || !targetOrgId || targetOrgId !== anchor.organizationId) {
    return deny("hors du périmètre de l'automatisation");
  }

  const authorId = automation.createdBy ?? undefined;
  if (!authorId) {
    return deny(`aucun auteur identifiable pour vérifier les droits de ${access === "read" ? "lecture" : "écriture"}`);
  }
  const level = await getSpacePermission(authorId, target.spaceId);
  if (access === "read") {
    // Tout niveau non nul (viewer, commenter, editor, admin) vaut lecture.
    if (!level) return deny("droit de lecture manquant sur la base demandée");
  } else if (!level || !WRITE_LEVELS.has(level)) {
    return deny("droit d'écriture manquant sur la base demandée");
  }
  return requested;
}
