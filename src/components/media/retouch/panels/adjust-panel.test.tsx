// @vitest-environment jsdom
import { afterEach, describe, expect, it, vi } from "vitest";
import { cleanup, fireEvent, render, screen } from "@testing-library/react";

vi.mock("next-intl", async () => (await import("../../test-fixtures")).intlMock());

import { emptyRecipe } from "../recipe";
import { AdjustPanel } from "./adjust-panel";
import { DetailPanel } from "./detail-panel";

afterEach(cleanup);
const recipe = emptyRecipe({ width: 100, height: 100 });

describe("AdjustPanel", () => {
  it("curseur : valeur annoncée, flèches, Maj, Début, Fin", () => {
    const onChange = vi.fn();
    render(<AdjustPanel recipe={{ ...recipe, adjustments: { ...recipe.adjustments, contrast: 20 } }} onChange={onChange} />);
    const s = screen.getByRole("slider", { name: "Contraste" });
    expect(s.getAttribute("aria-valuenow")).toBe("20");
    expect(s.getAttribute("aria-valuetext")).toBe("20");
    expect(s.getAttribute("aria-valuemin")).toBe("-100");
    fireEvent.keyDown(s, { key: "ArrowRight" });
    expect(onChange).toHaveBeenLastCalledWith({ type: "setAdjustment", key: "contrast", value: 21 });
    fireEvent.keyDown(s, { key: "ArrowLeft", shiftKey: true });
    expect(onChange).toHaveBeenLastCalledWith({ type: "setAdjustment", key: "contrast", value: 10 });
    fireEvent.keyDown(s, { key: "Home" });
    expect(onChange).toHaveBeenLastCalledWith({ type: "setAdjustment", key: "contrast", value: -100 });
    fireEvent.keyDown(s, { key: "End" });
    expect(onChange).toHaveBeenLastCalledWith({ type: "setAdjustment", key: "contrast", value: 100 });
  });

  it("l'exposition avance par 0,05 depuis 1", () => {
    const onChange = vi.fn();
    render(<AdjustPanel recipe={recipe} onChange={onChange} />);
    const s = screen.getByRole("slider", { name: "Exposition" });
    expect(s.getAttribute("aria-valuetext")).toBe("1.00");
    fireEvent.keyDown(s, { key: "ArrowUp" });
    expect(onChange).toHaveBeenLastCalledWith({ type: "setAdjustment", key: "exposure", value: 1.05 });
  });

  it("la valeur numérique est saisissable", () => {
    const onChange = vi.fn();
    render(<AdjustPanel recipe={recipe} onChange={onChange} />);
    fireEvent.change(screen.getByLabelText("Saturation, valeur"), { target: { value: "35" } });
    expect(onChange).toHaveBeenLastCalledWith({ type: "setAdjustment", key: "saturation", value: 35 });
  });

  it("double-clic et bouton Rétablir remettent la valeur neutre", () => {
    const onChange = vi.fn();
    const r = { ...recipe, adjustments: { ...recipe.adjustments, brightness: -30 } };
    render(<AdjustPanel recipe={r} onChange={onChange} />);
    fireEvent.doubleClick(screen.getByRole("slider", { name: "Luminosité" }));
    expect(onChange).toHaveBeenLastCalledWith({ type: "setAdjustment", key: "brightness", value: 0 });
    onChange.mockClear();
    fireEvent.click(screen.getByRole("button", { name: "Rétablir : Luminosité" }));
    expect(onChange).toHaveBeenLastCalledWith({ type: "setAdjustment", key: "brightness", value: 0 });
  });

  it("le bouton Rétablir d'une valeur neutre est désactivé avec sa raison", () => {
    render(<AdjustPanel recipe={recipe} onChange={vi.fn()} />);
    const b = screen.getByRole("button", { name: "Rétablir : Contraste" }) as HTMLButtonElement;
    expect(b.disabled).toBe(true);
    fireEvent.mouseEnter(b);
    expect(screen.getAllByRole("tooltip").some((t) => t.textContent === "Déjà à la valeur neutre")).toBe(true);
  });

  it("Réinitialiser les réglages ne touche que les valeurs modifiées", () => {
    const onChange = vi.fn();
    const r = { ...recipe, adjustments: { ...recipe.adjustments, tint: 12, exposure: 1.5 } };
    render(<AdjustPanel recipe={r} onChange={onChange} />);
    fireEvent.click(screen.getByRole("button", { name: "Réinitialiser les réglages" }));
    expect(onChange.mock.calls.map((c) => c[0])).toEqual([
      { type: "setAdjustment", key: "exposure", value: 1 },
      { type: "setAdjustment", key: "tint", value: 0 },
    ]);
  });
});

describe("DetailPanel", () => {
  it("règle netteté et flou, avec réinitialisation", () => {
    const onChange = vi.fn();
    render(<DetailPanel recipe={{ ...recipe, sharpen: 40, blur: 10 }} onChange={onChange} />);
    fireEvent.keyDown(screen.getByRole("slider", { name: "Netteté" }), { key: "ArrowRight" });
    expect(onChange).toHaveBeenLastCalledWith({ type: "setSharpen", value: 41 });
    fireEvent.keyDown(screen.getByRole("slider", { name: "Flou" }), { key: "End" });
    expect(onChange).toHaveBeenLastCalledWith({ type: "setBlur", value: 100 });
    onChange.mockClear();
    fireEvent.click(screen.getByRole("button", { name: "Réinitialiser netteté et flou" }));
    expect(onChange.mock.calls.map((c) => c[0])).toEqual([
      { type: "setSharpen", value: 0 },
      { type: "setBlur", value: 0 },
    ]);
  });
});
