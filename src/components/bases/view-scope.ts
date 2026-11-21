export type ViewScope = "shared" | "personal";

export interface ViewDef {
  id: string;
  name: string;
  type: string;
  isDefault: boolean;
  position: number;
  config: Record<string, unknown>;
  scope: ViewScope;
  createdBy: string | null;
}

export type ScopeBlockedReason = "not_author" | "is_default" | "last_shared" | "no_author";

/** Sépare les vues par portée en conservant l'ordre d'origine (une portée absente vaut partagée). */
export function groupViews(views: ViewDef[]): { shared: ViewDef[]; personal: ViewDef[] } {
  const shared: ViewDef[] = [];
  const personal: ViewDef[] = [];
  for (const view of views) (view.scope === "personal" ? personal : shared).push(view);
  return { shared, personal };
}

/** Miroir côté client de `decideViewUpdate` (serveur) : sert à expliquer l'entrée désactivée. */
export function scopeChangeBlockedReason(args: {
  view: ViewDef;
  viewerId: string;
  sharedCount: number;
  target: ViewScope;
}): ScopeBlockedReason | null {
  const { view, viewerId, sharedCount, target } = args;
  const current: ViewScope = view.scope === "personal" ? "personal" : "shared";
  if (target === current) return null;
  if (target === "personal" && view.createdBy == null) return "no_author";
  if (view.createdBy !== viewerId) return "not_author";
  if (target === "personal") {
    if (view.isDefault) return "is_default";
    if (sharedCount <= 1) return "last_shared";
  }
  return null;
}
