import type { SessionUser } from "@/types";
import { resolveAutomationAnchor } from "@/lib/automations/target-space";
import { cellsReferenceMedia, type MediaGuardActor } from "@/lib/databases/attachment-cell-guard";
import type { AutomationRow, ExecutionContext } from "@/lib/automations/actions/types";

/**
 * Garde de médias d'une action d'écriture de lignes. L'acteur est le
 * propriétaire de l'automatisme (`createdBy`), à défaut l'utilisateur déclencheur.
 * Aucun média n'est référencé dans les cellules : pas de garde, aucune requête.
 * Acteur ou organisation indéterminables : garde sans utilisateur, qui refuse
 * toute référence de média.
 */
export async function automationMediaGuard(
  automation: AutomationRow,
  ctx: ExecutionContext,
  cells: Record<string, unknown>
): Promise<MediaGuardActor | undefined> {
  if (!cellsReferenceMedia(cells)) return undefined;
  const anchor = await resolveAutomationAnchor(automation);
  const actorId = automation.createdBy ?? ctx.user?.id ?? null;
  if (!anchor || !actorId) return { user: null, orgId: anchor?.organizationId ?? "" };
  const user: SessionUser = {
    id: actorId,
    email: ctx.user?.email ?? "",
    name: ctx.user?.name ?? "",
    globalRole: "editor",
    capabilities: [],
  };
  return { user, orgId: anchor.organizationId };
}
