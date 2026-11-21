import type { ViewMode } from "@/components/editor/extensions/database-block/types";

type ViewLike = { id: string; name: string; type: string };

const MODE_TO_VIEW_TYPE: Record<ViewMode, string> = {
  table: "grid",
  kanban: "kanban",
  gallery: "gallery",
};

const MODE_LABELS: Record<ViewMode, string> = {
  table: "Tableau",
  kanban: "Kanban",
  gallery: "Galerie",
};

export interface ViewModeNavigation {
  hrefs: Partial<Record<ViewMode, string>>;
  disabledReasons: Partial<Record<ViewMode, string>>;
}

/** Pour chaque mode de la barre d'outils : URL de la première vue du type (vues triées par position), sinon raison de désactivation. */
export function resolveViewModeNavigation(
  views: ViewLike[],
  databaseId: string,
  spaceIdParam: string,
): ViewModeNavigation {
  const hrefs: ViewModeNavigation["hrefs"] = {};
  const disabledReasons: ViewModeNavigation["disabledReasons"] = {};
  for (const mode of Object.keys(MODE_TO_VIEW_TYPE) as ViewMode[]) {
    const target = views.find((v) => v.type === MODE_TO_VIEW_TYPE[mode]);
    if (target) {
      hrefs[mode] = `/bases/${databaseId}/views/${target.id}?spaceId=${spaceIdParam}`;
    } else {
      disabledReasons[mode] = `Aucune vue ${MODE_LABELS[mode]} dans cette base : ajoutez-en une depuis la colonne Vues`;
    }
  }
  return { hrefs, disabledReasons };
}
