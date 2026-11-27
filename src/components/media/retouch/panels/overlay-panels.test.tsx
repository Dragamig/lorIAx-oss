// @vitest-environment jsdom
import { afterEach, describe, expect, it, vi } from "vitest";
import { cleanup, fireEvent, render, screen } from "@testing-library/react";

vi.mock("next-intl", async () => (await import("../../test-fixtures")).intlMock());

import { emptyRecipe, applyOp, type RetouchRecipe } from "../recipe";
import { addShape, addText } from "../overlays";
import { ShapesPanel } from "./shapes-panel";
import { TextPanel } from "./text-panel";

afterEach(cleanup);
const base = emptyRecipe({ width: 100, height: 100 });

function withText(): { recipe: RetouchRecipe; id: string } {
  const r = addText(base, "Salut");
  if (!r.ok) throw new Error();
  return { recipe: r.recipe, id: r.id };
}

describe("TextPanel", () => {
  it("Ajouter est désactivé tant que le texte est vide, avec la raison", () => {
    render(<TextPanel recipe={base} onChange={vi.fn()} selectedId={null} onSelect={vi.fn()} />);
    const add = screen.getByRole("button", { name: "Ajouter un texte" }) as HTMLButtonElement;
    expect(add.disabled).toBe(true);
    expect(screen.getByText("Saisissez un texte pour l'ajouter")).toBeTruthy();
  });

  it("ajoute un calque et le sélectionne", () => {
    const onChange = vi.fn();
    const onSelect = vi.fn();
    render(<TextPanel recipe={base} onChange={onChange} selectedId={null} onSelect={onSelect} />);
    fireEvent.change(screen.getByLabelText("Texte"), { target: { value: "Bonjour" } });
    fireEvent.click(screen.getByRole("button", { name: "Ajouter un texte" }));
    expect(onChange).toHaveBeenCalledWith(expect.objectContaining({ type: "addLayer", layer: expect.objectContaining({ type: "text", text: "Bonjour" }) }));
    expect(onSelect).toHaveBeenCalledOnce();
  });

  it("limite de 20 calques : bouton désactivé avec le message", () => {
    let r = base;
    for (let i = 0; i < 20; i++) {
      const s = addShape(r, "rect");
      if (s.ok) r = s.recipe;
    }
    render(<TextPanel recipe={r} onChange={vi.fn()} selectedId={null} onSelect={vi.fn()} />);
    fireEvent.change(screen.getByLabelText("Texte"), { target: { value: "x" } });
    expect((screen.getByRole("button", { name: "Ajouter un texte" }) as HTMLButtonElement).disabled).toBe(true);
    expect(screen.getByText("Limite de 20 calques atteinte")).toBeTruthy();
  });

  it("flèches, Maj et Suppr agissent sur le calque sélectionné", () => {
    const { recipe, id } = withText();
    const onChange = vi.fn();
    const onSelect = vi.fn();
    render(<TextPanel recipe={recipe} onChange={onChange} selectedId={id} onSelect={onSelect} />);
    const row = screen.getByRole("option", { name: "Calque Salut" });
    fireEvent.keyDown(row, { key: "ArrowRight" });
    expect(onChange).toHaveBeenLastCalledWith({ type: "updateLayer", id, patch: { x: expect.closeTo(recipe.layers[0].x + 0.01, 5), y: recipe.layers[0].y } });
    fireEvent.keyDown(row, { key: "ArrowDown", shiftKey: true });
    expect(onChange).toHaveBeenLastCalledWith({ type: "updateLayer", id, patch: { x: recipe.layers[0].x, y: expect.closeTo(recipe.layers[0].y + 0.1, 5) } });
    fireEvent.keyDown(row, { key: "Delete" });
    expect(onChange).toHaveBeenLastCalledWith({ type: "removeLayer", id });
    expect(onSelect).toHaveBeenLastCalledWith(null);
  });

  it("vider le texte du calque sélectionné envoie un texte vide (le calque disparaît)", () => {
    const { recipe, id } = withText();
    const onChange = vi.fn();
    render(<TextPanel recipe={recipe} onChange={onChange} selectedId={id} onSelect={vi.fn()} />);
    const areas = screen.getAllByLabelText("Texte");
    fireEvent.change(areas[areas.length - 1], { target: { value: "" } });
    const op = onChange.mock.calls.at(-1)![0];
    expect(applyOp(recipe, op).layers).toHaveLength(0);
  });

  it("les polices proposées sont celles des piles système", () => {
    render(<TextPanel recipe={base} onChange={vi.fn()} selectedId={null} onSelect={vi.fn()} />);
    const opts = Array.from((screen.getByLabelText("Police") as HTMLSelectElement).options).map((o) => o.textContent);
    expect(opts).toEqual(["Sans empattement", "Avec empattement", "Chasse fixe", "Titre"]);
  });
});

describe("ShapesPanel", () => {
  it("quatre formes, chacune avec son bouton nommé", () => {
    const onChange = vi.fn();
    render(<ShapesPanel recipe={base} onChange={onChange} selectedId={null} onSelect={vi.fn()} />);
    for (const name of ["Rectangle", "Ellipse", "Ligne", "Flèche"]) expect(screen.getByRole("button", { name })).toBeTruthy();
    fireEvent.click(screen.getByRole("button", { name: "Flèche" }));
    expect(onChange).toHaveBeenCalledWith(expect.objectContaining({ layer: expect.objectContaining({ shape: "arrow" }) }));
  });

  it("édition d'une forme : remplissage et épaisseur", () => {
    const s = addShape(base, "rect");
    if (!s.ok) throw new Error();
    const onChange = vi.fn();
    render(<ShapesPanel recipe={s.recipe} onChange={onChange} selectedId={s.id} onSelect={vi.fn()} />);
    fireEvent.click(screen.getByLabelText("Remplir la forme"));
    expect(onChange).toHaveBeenLastCalledWith(expect.objectContaining({ type: "updateLayer", patch: { fill: "#ff3b30" } }));
    fireEvent.keyDown(screen.getByRole("slider", { name: "Épaisseur du trait" }), { key: "ArrowRight" });
    expect(onChange).toHaveBeenLastCalledWith({ type: "updateLayer", id: s.id, patch: { strokeWidth: 7 } });
  });
});
