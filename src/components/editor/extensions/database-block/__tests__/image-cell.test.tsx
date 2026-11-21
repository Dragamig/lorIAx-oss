// @vitest-environment jsdom
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { act, cleanup, fireEvent, render, screen } from "@testing-library/react";
import { ImageCell } from "../image-cell";

const h = vi.hoisted(() => ({
  toastSuccess: vi.fn(),
  pickerProps: null as null | { open: boolean; onPick: (items: unknown[], o: object) => void; accept: string[]; mode: string; tabs: string[]; spaceId: string | null },
}));

vi.mock("next-intl", async () => (await import("@/components/media/test-fixtures")).intlMock());
vi.mock("sonner", () => ({ toast: { success: h.toastSuccess, error: vi.fn() } }));
vi.mock("@/components/media/picker/media-picker", () => ({
  MediaPicker: (props: NonNullable<typeof h.pickerProps>) => {
    h.pickerProps = props;
    return props.open ? <div data-testid="picker" /> : null;
  },
}));

const ID = "0b1c2d3e-0000-4000-8000-000000000000";
const fetchMock = vi.fn();

beforeEach(() => {
  h.toastSuccess.mockReset();
  h.pickerProps = null;
  fetchMock.mockReset();
  vi.stubGlobal("fetch", fetchMock);
});
afterEach(() => {
  cleanup();
  vi.unstubAllGlobals();
});

const setup = (value: string | null, editable = true) => {
  const onChange = vi.fn();
  render(<ImageCell value={value} onChange={onChange} spaceId="s1" editable={editable} />);
  return onChange;
};

describe("ImageCell", () => {
  it.each([
    ["data:image/png;base64,AAA", "data:image/png;base64,AAA"],
    ["https://x.test/y.png", "https://x.test/y.png"],
    ["/api/attachments/org/abc%20d.png", "/api/attachments/org/abc%20d.png"],
    [`/api/media/${ID}`, `/api/media/${ID}`],
  ])("affiche la valeur héritée %s et propose de la remplacer", (value, expected) => {
    setup(value);
    expect(document.querySelector("img")?.getAttribute("src")).toBe(expected);
    expect(screen.getByRole("button", { name: "Remplacer l'image" })).toBeTruthy();
  });

  it("choisir un média écrit exactement /api/media/<id>, avec le sélecteur de la médiathèque", () => {
    const onChange = setup(null);
    fireEvent.click(screen.getByRole("button", { name: "Choisir dans la médiathèque" }));
    expect(screen.getByTestId("picker")).toBeTruthy();
    expect(h.pickerProps).toMatchObject({ accept: ["image"], mode: "single", tabs: ["library", "upload"], spaceId: "s1" });
    act(() => h.pickerProps!.onPick([{ id: ID }], {}));
    expect(onChange).toHaveBeenCalledWith(`/api/media/${ID}`);
  });

  it("Retirer écrit une chaîne vide, Annuler restaure la valeur d'origine exacte", () => {
    const original = "https://x.test/y.png";
    const onChange = setup(original);
    fireEvent.click(screen.getByRole("button", { name: "Retirer l'image" }));
    expect(onChange).toHaveBeenLastCalledWith("");
    const opts = h.toastSuccess.mock.calls[0][1] as { action: { onClick: () => void } };
    opts.action.onClick();
    expect(onChange).toHaveBeenLastCalledWith(original);
  });

  it("lecture seule : aucun bouton d'édition", () => {
    setup(`/api/media/${ID}`, false);
    expect(screen.queryByRole("button", { name: "Remplacer l'image" })).toBeNull();
    expect(screen.queryByRole("button", { name: "Retirer l'image" })).toBeNull();
    cleanup();
    setup(null, false);
    expect(screen.queryByRole("button")).toBeNull();
  });

  it("média manquant : cadre accessible, sans exception", () => {
    setup(`/api/media/${ID}`);
    fireEvent.error(document.querySelector("img")!);
    expect(document.querySelector("[data-media-missing]")).toBeTruthy();
    expect(screen.getByRole("img", { name: "Média manquant" })).toBeTruthy();
  });

  it("valeur illisible : traitée comme vide, jamais réécrite d'office", () => {
    const onChange = setup("javascript:alert(1)");
    expect(document.querySelector("img")).toBeNull();
    expect(onChange).not.toHaveBeenCalled();
  });

  it("n'appelle plus l'ancien téléversement direct", () => {
    setup(null);
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it("zoom : info-bulle visible au focus clavier, pas seulement un title natif", () => {
    setup(`/api/media/${ID}`);
    const zoom = screen.getByRole("button", { name: "Agrandir l'image" });
    expect(zoom.getAttribute("title")).toBeNull();
    fireEvent.focus(zoom);
    expect(screen.getByRole("tooltip").textContent).toBe("Agrandir l'image");
  });

  it("média à la corbeille : vignette manquante", async () => {
    fetchMock.mockResolvedValue(new Response(JSON.stringify({ media: { deletedAt: "2026-01-01" } }), { status: 200 }));
    setup("/api/media/0b1c2d3e-0000-4000-8000-0000000000bb");
    const frame = await screen.findByRole("img", { name: "Média manquant" });
    expect(frame.getAttribute("data-media-missing")).toBe("true");
  });
});
