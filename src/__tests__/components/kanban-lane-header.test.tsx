// @vitest-environment jsdom
import { afterEach, describe, expect, it, vi } from "vitest";
import { cleanup, fireEvent, screen } from "@testing-library/react";
import { KanbanLaneHeader } from "@/components/bases/kanban-lane-header";
import { renderWithIntl } from "./support/render-intl";

const base = {
  laneKey: "Gagnée",
  totals: null,
  weight: null,
  closed: false,
  showWeighted: false,
  currency: "EUR",
  locale: "fr",
  count: 3,
};

afterEach(cleanup);

describe("KanbanLaneHeader : bouton d'ajout optionnel", () => {
  it("sans onAdd, aucun bouton « + » n'est rendu", () => {
    renderWithIntl(<KanbanLaneHeader {...base} />);
    expect(screen.queryByRole("button")).toBeNull();
    expect(screen.getByText("3")).toBeTruthy();
  });

  it("avec onAdd, le bouton est rendu et appelle onAdd", () => {
    const onAdd = vi.fn();
    renderWithIntl(<KanbanLaneHeader {...base} onAdd={onAdd} busy={false} />);
    fireEvent.click(screen.getByRole("button", { name: "Ajouter une carte dans Gagnée" }));
    expect(onAdd).toHaveBeenCalledTimes(1);
  });
});
