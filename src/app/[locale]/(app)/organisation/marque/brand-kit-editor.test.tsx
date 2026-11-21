// @vitest-environment jsdom
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { act, cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react";
import { BrandKitEditor } from "./brand-kit-editor";

const h = vi.hoisted(() => ({
  toastSuccess: vi.fn(),
  toastError: vi.fn(),
  pickerProps: null as null | {
    open: boolean;
    accept: string[];
    spaceId?: string | null;
    max: number;
    onPick: (items: unknown[], o: object) => void | Promise<void>;
  },
}));

vi.mock("next-intl", async () => (await import("@/components/media/test-fixtures")).intlMock());
vi.mock("sonner", () => ({ toast: { success: h.toastSuccess, error: h.toastError } }));
vi.mock("@/components/media/picker/media-picker", () => ({
  MediaPicker: (props: NonNullable<typeof h.pickerProps>) => {
    h.pickerProps = props;
    return props.open ? <div data-testid="picker" /> : null;
  },
}));

const ID = "0b1c2d3e-0000-4000-8000-000000000000";
const fetchMock = vi.fn();
let spacesList: object[] = [];
const putBodies: { logos: { url: string; name: string }[] }[] = [];

beforeEach(() => {
  h.toastSuccess.mockReset();
  h.toastError.mockReset();
  h.pickerProps = null;
  putBodies.length = 0;
  spacesList = [
    { id: "sp-team", type: "team", classification: "internal" },
    { id: "sp-secret", type: "organization", classification: "secret" },
    { id: "sp-org", type: "organization", classification: "internal" },
  ];
  fetchMock.mockReset();
  fetchMock.mockImplementation(async (url: string, init?: RequestInit) => {
    if (url === "/api/studio/brand-kit" && init?.method === "PUT") {
      putBodies.push(JSON.parse(String(init.body)));
      return { ok: true, json: async () => ({ ok: true }) };
    }
    if (url === "/api/spaces") return { ok: true, json: async () => spacesList };
    if (url === "/api/studio/brand-kit")
      return {
        ok: true,
        json: async () => ({
          colors: [],
          logos: [{ url: "/api/studio/images/old", name: "Ancien" }],
          fontHeading: null,
          fontBody: null,
        }),
      };
    return { ok: true, json: async () => ({ role: "owner" }) };
  });
  vi.stubGlobal("fetch", fetchMock);
});
afterEach(() => {
  cleanup();
  vi.unstubAllGlobals();
});

describe("BrandKitEditor, logos de la médiathèque", () => {
  it("ouvre le sélecteur d'images, plafonné au nombre de places restantes", async () => {
    render(<BrandKitEditor />);
    fireEvent.click(await screen.findByRole("button", { name: "Choisir un logo dans la médiathèque" }));
    expect(screen.getByTestId("picker")).toBeTruthy();
    expect(h.pickerProps?.accept).toEqual(["image"]);
    expect(h.pickerProps?.max).toBe(7);
  });

  it("garde le logo ancien affiché et écrit /api/media/<id> avec le titre du média", async () => {
    render(<BrandKitEditor />);
    await screen.findByRole("button", { name: "Choisir un logo dans la médiathèque" });
    expect(document.querySelector("img")?.getAttribute("src")).toBe("/api/studio/images/old");
    await act(async () => {
      await h.pickerProps?.onPick([{ id: ID, filename: "f.png", title: "Mon logo" }], {});
    });
    await waitFor(() => expect(putBodies.length).toBe(1));
    expect(putBodies[0].logos).toEqual([
      { url: "/api/studio/images/old", name: "Ancien" },
      { url: `/api/media/${ID}`, name: "Mon logo" },
    ]);
    expect(h.toastSuccess).toHaveBeenCalled();
  });

  it("affiche une erreur et aucun succès quand l'enregistrement échoue", async () => {
    render(<BrandKitEditor />);
    await screen.findByRole("button", { name: "Choisir un logo dans la médiathèque" });
    fetchMock.mockImplementationOnce(async () => ({ ok: false, json: async () => ({}) }));
    await act(async () => {
      await h.pickerProps?.onPick([{ id: ID, filename: "f.png", title: null }], {});
    });
    expect(h.toastError).toHaveBeenCalled();
    expect(h.toastSuccess).not.toHaveBeenCalled();
  });

  it("verrouille le sélecteur sur l'espace d'organisation (jamais un espace restreint)", async () => {
    render(<BrandKitEditor />);
    fireEvent.click(await screen.findByRole("button", { name: "Choisir un logo dans la médiathèque" }));
    expect(h.pickerProps?.spaceId).toBe("sp-org");
  });

  it("sans espace d'organisation : bouton désactivé et info-bulle explicative au focus", async () => {
    spacesList = [{ id: "sp-team", type: "team", classification: "internal" }];
    render(<BrandKitEditor />);
    const btn = (await screen.findByRole("button", {
      name: "Choisir un logo dans la médiathèque",
    })) as HTMLButtonElement;
    await waitFor(() => expect(btn.disabled).toBe(true));
    fireEvent.focus(btn.parentElement as HTMLElement);
    expect(screen.getByRole("tooltip").textContent).toBe("Aucun espace d'organisation disponible pour héberger les logos");
  });
});
