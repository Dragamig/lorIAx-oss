import { describe, it, expect } from "vitest";
import { resolveViewModeNavigation } from "../view-mode-navigation";

const views = [
  { id: "v-grid", name: "Tableau", type: "grid" },
  { id: "v-k1", name: "Kanban 1", type: "kanban" },
  { id: "v-k2", name: "Kanban 2", type: "kanban" },
];

describe("resolveViewModeNavigation", () => {
  it("Kanban : URL de la première vue kanban", () => {
    const nav = resolveViewModeNavigation(views, "db1", "sp1");
    expect(nav.hrefs.kanban).toBe("/bases/db1/views/v-k1?spaceId=sp1");
    expect(nav.hrefs.table).toBe("/bases/db1/views/v-grid?spaceId=sp1");
  });
  it("Galerie sans vue : raison de désactivation en français", () => {
    const nav = resolveViewModeNavigation(views, "db1", "sp1");
    expect(nav.hrefs.gallery).toBeUndefined();
    expect(nav.disabledReasons.gallery).toBe(
      "Aucune vue Galerie dans cette base : ajoutez-en une depuis la colonne Vues",
    );
    expect(nav.disabledReasons.kanban).toBeUndefined();
  });
});
