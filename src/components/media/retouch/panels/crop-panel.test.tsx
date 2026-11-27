// @vitest-environment jsdom
import { afterEach, describe, expect, it, vi } from "vitest";
import { cleanup, fireEvent, render, screen } from "@testing-library/react";

vi.mock("next-intl", async () => (await import("../../test-fixtures")).intlMock());

import { emptyRecipe } from "../recipe";
import { CropPanel } from "./crop-panel";
import { CropOverlay } from "./crop-overlay";
import { useCropDraft } from "./use-crop-draft";

afterEach(cleanup);
const recipe = emptyRecipe({ width: 1000, height: 500 });

function Harness({ onChange }: { onChange: (op: unknown) => void }) {
  const draft = useCropDraft(recipe);
  return (
    <div>
      <CropPanel recipe={recipe} onChange={onChange} draft={draft} />
      <CropOverlay draft={draft} />
    </div>
  );
}

describe("CropPanel", () => {
  it("chaque bouton a un aria-label et une info-bulle", () => {
    render(<CropPanel recipe={recipe} onChange={vi.fn()} />);
    const buttons = screen.getAllByRole("button");
    expect(buttons.length).toBeGreaterThanOrEqual(10);
    for (const b of buttons) {
      expect(b.getAttribute("aria-label"), b.outerHTML).toBeTruthy();
      fireEvent.focus(b);
      expect(screen.getByRole("tooltip").textContent).toBeTruthy();
      fireEvent.blur(b);
    }
  });

  it("le ratio 1:1 recentre la zone et l'indique", () => {
    render(<Harness onChange={vi.fn()} />);
    fireEvent.click(screen.getByRole("button", { name: "Format 1:1" }));
    expect(screen.getByRole("button", { name: "Format 1:1" }).getAttribute("aria-pressed")).toBe("true");
    expect(screen.getByRole("status").textContent).toBe("Zone : 500 × 500 px");
  });

  it("un ratio saisi invalide est refusé avec un message", () => {
    const onChange = vi.fn();
    render(<CropPanel recipe={recipe} onChange={onChange} />);
    fireEvent.change(screen.getByLabelText("Largeur"), { target: { value: "0" } });
    fireEvent.change(screen.getByLabelText("Hauteur"), { target: { value: "4" } });
    fireEvent.click(screen.getByRole("button", { name: "Appliquer le ratio saisi" }));
    expect(screen.getByRole("alert").textContent).toBe("Saisissez deux nombres supérieurs à 0.");
    fireEvent.change(screen.getByLabelText("Largeur"), { target: { value: "5" } });
    fireEvent.click(screen.getByRole("button", { name: "Appliquer le ratio saisi" }));
    expect(screen.queryByRole("alert")).toBeNull();
    expect(screen.getByRole("status").textContent).toBe("Zone : 625 × 500 px");
  });

  it("Appliquer envoie la zone, Entrée aussi, Échap revient à la recette", () => {
    const onChange = vi.fn();
    render(<Harness onChange={onChange} />);
    fireEvent.click(screen.getByRole("button", { name: "Format 1:1" }));
    fireEvent.click(screen.getByRole("button", { name: "Appliquer le recadrage" }));
    expect(onChange).toHaveBeenCalledWith({ type: "setCrop", crop: expect.objectContaining({ w: 0.5, h: 1 }) });
    onChange.mockClear();
    fireEvent.keyDown(document.body, { key: "Enter" });
    expect(onChange).toHaveBeenCalledTimes(1);
    fireEvent.keyDown(document.body, { key: "Escape" });
    expect(screen.getByRole("status").textContent).toMatch(/^Zone : 1\s000 × 500 px$/);
  });

  it("les poignées sont atteignables au clavier avec rôle et valeur", () => {
    render(<Harness onChange={vi.fn()} />);
    fireEvent.click(screen.getByRole("button", { name: "Format 1:1" }));
    const handles = screen.getAllByRole("slider");
    expect(handles).toHaveLength(8);
    for (const h of handles) {
      expect(h.getAttribute("tabindex")).toBe("0");
      expect(h.getAttribute("aria-label")).toBeTruthy();
      expect(h.getAttribute("aria-valuetext")).toBe("Zone 500 × 500 px");
    }
    const east = screen.getByRole("slider", { name: "Poignée droite" });
    fireEvent.keyDown(east, { key: "ArrowLeft", shiftKey: true });
    expect(east.getAttribute("aria-valuetext")).toBe("Zone 490 × 490 px");
  });

  it("les flèches sur la zone la déplacent de 1 px", () => {
    render(<Harness onChange={vi.fn()} />);
    fireEvent.click(screen.getByRole("button", { name: "Format 1:1" }));
    const zone = screen.getByRole("group", { name: "Zone de recadrage" });
    const before = zone.style.left;
    fireEvent.keyDown(zone, { key: "ArrowRight" });
    expect(parseFloat(zone.style.left)).toBeCloseTo(parseFloat(before) + 0.1, 6);
  });
});
