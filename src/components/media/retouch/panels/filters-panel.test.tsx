// @vitest-environment jsdom
import { afterEach, describe, expect, it, vi } from "vitest";
import { cleanup, fireEvent, render, screen, within } from "@testing-library/react";

vi.mock("next-intl", async () => (await import("../../test-fixtures")).intlMock());

import { applyOp, emptyRecipe, PRESET_KEYS } from "../recipe";
import { createHistory } from "../history";
import { FiltersPanel, PRESET_TILE_CLASS } from "./filters-panel";

afterEach(cleanup);
const recipe = emptyRecipe({ width: 100, height: 100 });

describe("FiltersPanel", () => {
  it("affiche les 8 filtres en tuiles de même gabarit, pied tronqué", () => {
    render(<FiltersPanel recipe={recipe} onChange={vi.fn()} sourceUrl="/api/media/m1" />);
    const group = screen.getByRole("group", { name: "Filtres prédéfinis" });
    const tiles = within(group).getAllByRole("button");
    expect(tiles).toHaveLength(PRESET_KEYS.length);
    for (const t of tiles) {
      expect(t.className).toContain(PRESET_TILE_CLASS);
      expect(t.querySelector(".truncate")).toBeTruthy();
      expect((t.parentElement as HTMLElement).className).toContain("w-full");
      expect(t.querySelector("img")?.getAttribute("src")).toBe("/api/media/m1");
    }
  });

  it("une tuile a un nom accessible, une info-bulle et marque le filtre actif", () => {
    render(<FiltersPanel recipe={{ ...recipe, preset: "sepia" }} onChange={vi.fn()} />);
    const sepia = screen.getByRole("button", { name: "Filtre Sépia" });
    expect(sepia.getAttribute("aria-pressed")).toBe("true");
    expect(screen.getByRole("button", { name: "Filtre Chaud" }).getAttribute("aria-pressed")).toBe("false");
    fireEvent.focus(sepia);
    expect(screen.getByRole("tooltip").textContent).toBe("Filtre Sépia");
  });

  it("choisir un filtre l'applique et Annuler le retire", () => {
    const hist = createHistory(recipe);
    const onChange = vi.fn((op) => hist.push(applyOp(hist.present, op)));
    render(<FiltersPanel recipe={recipe} onChange={onChange} />);
    fireEvent.click(screen.getByRole("button", { name: "Filtre Froid" }));
    expect(onChange).toHaveBeenCalledWith({ type: "setPreset", preset: "cool" });
    expect(hist.present.preset).toBe("cool");
    expect(hist.undo().preset).toBe("none");
  });
});
