// @vitest-environment jsdom
import { afterEach, describe, expect, it, vi } from "vitest";
import { cleanup, fireEvent, render, screen } from "@testing-library/react";

vi.mock("next-intl", async () => (await import("../../test-fixtures")).intlMock());

import { applyOp, emptyRecipe, outputSize } from "../recipe";
import { ResizePanel } from "./resize-panel";
import { RotatePanel } from "./rotate-panel";

afterEach(cleanup);
const recipe = emptyRecipe({ width: 1000, height: 500 });

describe("RotatePanel", () => {
  it("pivote, miroite, règle l'angle", () => {
    const onChange = vi.fn();
    render(<RotatePanel recipe={recipe} onChange={onChange} />);
    fireEvent.click(screen.getByRole("button", { name: "Pivoter à droite" }));
    expect(onChange).toHaveBeenLastCalledWith({ type: "rotate", quarters: 1 });
    fireEvent.click(screen.getByRole("button", { name: "Pivoter à gauche" }));
    expect(onChange).toHaveBeenLastCalledWith({ type: "rotate", quarters: -1 });
    fireEvent.click(screen.getByRole("button", { name: "Miroir horizontal" }));
    expect(onChange).toHaveBeenLastCalledWith({ type: "flip", axis: "h" });
    fireEvent.keyDown(screen.getByRole("slider", { name: "Angle fin" }), { key: "ArrowRight" });
    expect(onChange).toHaveBeenLastCalledWith({ type: "setAngle", angle: 1 });
  });

  it("les raccourcis R et Maj+H agissent, pas dans un champ", () => {
    const onChange = vi.fn();
    render(<RotatePanel recipe={recipe} onChange={onChange} />);
    fireEvent.keyDown(document.body, { key: "r" });
    expect(onChange).toHaveBeenLastCalledWith({ type: "rotate", quarters: 1 });
    fireEvent.keyDown(document.body, { key: "H", shiftKey: true });
    expect(onChange).toHaveBeenLastCalledWith({ type: "flip", axis: "h" });
    onChange.mockClear();
    fireEvent.keyDown(screen.getByLabelText("Angle fin, valeur"), { key: "r" });
    expect(onChange).not.toHaveBeenCalled();
  });

  it("le miroir actif est exposé en aria-pressed et chaque bouton a une info-bulle", () => {
    render(<RotatePanel recipe={{ ...recipe, flipV: true }} onChange={vi.fn()} />);
    expect(screen.getByRole("button", { name: "Miroir vertical" }).getAttribute("aria-pressed")).toBe("true");
    expect(screen.getByRole("button", { name: "Miroir horizontal" }).getAttribute("aria-pressed")).toBe("false");
    fireEvent.focus(screen.getByRole("button", { name: "Pivoter à droite" }));
    expect(screen.getByRole("tooltip").textContent).toBe("Pivoter à droite (R)");
  });
});

describe("ResizePanel", () => {
  it("verrou actif : la hauteur suit la largeur saisie", () => {
    const onChange = vi.fn();
    render(<ResizePanel recipe={recipe} onChange={onChange} />);
    const w = screen.getByLabelText("Largeur (px)");
    fireEvent.change(w, { target: { value: "500" } });
    fireEvent.blur(w);
    expect(onChange).toHaveBeenLastCalledWith({ type: "resize", width: 500, lockRatio: true });
    expect(outputSize(applyOp(recipe, onChange.mock.calls[0][0]))).toEqual({ width: 500, height: 250 });
  });

  it("verrou levé : l'autre côté est conservé", () => {
    const onChange = vi.fn();
    render(<ResizePanel recipe={recipe} onChange={onChange} />);
    const lock = screen.getByRole("button", { name: "Ratio verrouillé" });
    expect(lock.getAttribute("aria-pressed")).toBe("true");
    fireEvent.click(lock);
    expect(screen.getByRole("button", { name: "Ratio libre" }).getAttribute("aria-pressed")).toBe("false");
    const h = screen.getByLabelText("Hauteur (px)");
    fireEvent.change(h, { target: { value: "100" } });
    fireEvent.keyDown(h, { key: "Enter" });
    const next = applyOp(recipe, onChange.mock.calls[0][0]);
    expect(outputSize(next)).toEqual({ width: 1000, height: 100 });
  });

  it("une valeur invalide est annulée sans envoi", () => {
    const onChange = vi.fn();
    render(<ResizePanel recipe={recipe} onChange={onChange} />);
    const w = screen.getByLabelText("Largeur (px)") as HTMLInputElement;
    fireEvent.change(w, { target: { value: "0" } });
    fireEvent.blur(w);
    expect(onChange).not.toHaveBeenCalled();
    expect(w.value).toBe("1000");
  });

  it("signale un dépassement des plafonds", () => {
    render(<ResizePanel recipe={recipe} onChange={vi.fn()} />);
    fireEvent.change(screen.getByLabelText("Largeur (px)"), { target: { value: "9000" } });
    expect(screen.getByRole("status").textContent).toContain("plafonnée");
  });

  it("les échelles passent par des boutons nommés", () => {
    const onChange = vi.fn();
    render(<ResizePanel recipe={recipe} onChange={onChange} />);
    fireEvent.click(screen.getByRole("button", { name: "Échelle 50 %" }));
    expect(onChange).toHaveBeenLastCalledWith({ type: "resize", width: 500, lockRatio: true });
  });
});
