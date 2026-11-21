// @vitest-environment jsdom
import { describe, it, expect, vi } from "vitest";
import { render, screen, fireEvent } from "@testing-library/react";
import { DatabaseToolbar } from "../database-toolbar";
import type { DbData } from "../types";

const data = { id: "d", spaceId: "s", name: "N", description: null, columns: [], rows: [] } as unknown as DbData;

function renderToolbar(extra: Record<string, unknown> = {}) {
  const onViewModeChange = vi.fn();
  render(
    <DatabaseToolbar
      data={data}
      viewMode="table"
      onViewModeChange={onViewModeChange}
      showFilters={false}
      onFiltersOpenChange={() => {}}
      filtersCount={0}
      filterContent={null}
      showSort={false}
      onToggleSort={() => {}}
      hasSort={false}
      onShowImport={() => {}}
      onRefresh={() => {}}
      {...extra}
    />,
  );
  return onViewModeChange;
}

describe("DatabaseToolbar sélecteur de vue", () => {
  it("sans carte de désactivation : appelle onViewModeChange (bloc éditeur)", () => {
    const onChange = renderToolbar();
    fireEvent.click(screen.getByTitle("Kanban"));
    expect(onChange).toHaveBeenCalledWith("kanban");
  });
  it("mode désactivé : bouton désactivé avec la raison en title et aria-label", () => {
    const reason = "Aucune vue Galerie dans cette base : ajoutez-en une depuis la colonne Vues";
    const onChange = renderToolbar({ viewModeDisabledReasons: { gallery: reason } });
    const btn = screen.getByTitle(reason) as HTMLButtonElement;
    expect(btn.disabled).toBe(true);
    expect(btn.getAttribute("aria-label")).toBe(reason);
    fireEvent.click(btn);
    expect(onChange).not.toHaveBeenCalled();
    expect((screen.getByTitle("Kanban") as HTMLButtonElement).disabled).toBe(false);
  });
});
