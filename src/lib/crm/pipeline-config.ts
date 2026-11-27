import { kanbanTotalsSchema, type KanbanTotalsConfig } from "@/lib/bases/view-config";

export interface PipelineTotalsSource {
  viewId: string | null;
  config: KanbanTotalsConfig | null;
}

/**
 * Config de totaux du pipeline : première vue partagée (ordre fourni) dont
 * `config.kanbanTotals` est valide. La colonne de montant est toujours celle
 * du raccordement. Sans vue valide ou sans montant : aucune config.
 */
export function pickTotalsSource(
  views: { id: string; scope: string; config: unknown }[],
  amountColumnId: string | null,
): PipelineTotalsSource {
  if (!amountColumnId) return { viewId: null, config: null };
  for (const view of views) {
    if (view.scope !== "shared") continue;
    const cfg = view.config;
    if (!cfg || typeof cfg !== "object" || Array.isArray(cfg)) continue;
    const parsed = kanbanTotalsSchema.safeParse((cfg as Record<string, unknown>).kanbanTotals);
    if (!parsed.success) continue;
    return { viewId: view.id, config: { ...parsed.data, amountColumnId } };
  }
  return { viewId: null, config: null };
}

/** Repli sans vue Pipeline : aucune pondération, aucune voie close supposée. */
export function defaultTotalsConfig(amountColumnId: string | null): KanbanTotalsConfig | null {
  if (!amountColumnId) return null;
  return { amountColumnId, closedLanes: [], weights: {}, currency: "EUR", showWeighted: false };
}
