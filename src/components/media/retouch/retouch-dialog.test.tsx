// @vitest-environment jsdom
import { readFileSync } from "fs";
import { resolve } from "path";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react";
import { LIBRARY_ACTIONS } from "@/lib/media/actions";

vi.mock("next-intl", async () => (await import("../test-fixtures")).intlMock());
vi.mock("sonner", () => ({ toast: { success: vi.fn(), info: vi.fn(), error: vi.fn() } }));

const cv = vi.hoisted(() => ({
  state: { ready: true, error: null as null | { code: string } },
  setRecipe: vi.fn(),
  showBefore: vi.fn(),
  exportBlob: vi.fn(async () => new Blob(["x"])),
  retry: vi.fn(),
  onLoaded: undefined as undefined | ((s: { width: number; height: number }) => void),
}));
vi.mock("./use-retouch-canvas", () => ({
  useRetouchCanvas: (o: { onLoaded?: (s: { width: number; height: number }) => void }) => {
    cv.onLoaded = o.onLoaded;
    return { ...cv.state, setRecipe: cv.setRecipe, showBefore: cv.showBefore, exportBlob: cv.exportBlob, retry: cv.retry };
  },
}));

import { RetouchDialog, type RetouchDialogMedia, type RetouchDialogProps } from "./retouch-dialog";
import { useEffect } from "react";

const media: RetouchDialogMedia = {
  id: "m1",
  filename: "photo.png",
  title: null,
  kind: "image",
  mimeType: "image/png",
  spaceId: "s1",
  folderId: null,
  currentVersion: 2,
  canWrite: true,
  width: 1600,
  height: 1000,
};

function Loaded(props: RetouchDialogProps) {
  // Simule la fin du chargement de l'image dans le hook mocké.
  useEffect(() => {
    cv.onLoaded?.({ width: 1600, height: 1000 });
  }, []);
  return <RetouchDialog {...props} />;
}

function setup(over: Partial<RetouchDialogProps> = {}) {
  const props: RetouchDialogProps = {
    media,
    spaces: [{ id: "s1", name: "Direction" }],
    folders: [],
    canWriteSpace: true,
    onClose: vi.fn(),
    onSaved: vi.fn(),
    ...over,
  };
  const view = render(<Loaded {...props} />);
  // Le hook est appelé au rendu : on relance après avoir fourni onLoaded.
  view.rerender(<Loaded {...props} />);
  return props;
}

beforeEach(() => {
  cv.state = { ready: true, error: null };
  vi.stubGlobal("fetch", vi.fn(async () => new Response("{}")));
});
afterEach(() => {
  cleanup();
  vi.clearAllMocks();
  vi.unstubAllGlobals();
});

const key = (k: string, o: KeyboardEventInit = {}) => fireEvent.keyDown(screen.getByRole("dialog"), { key: k, ...o });

describe("RetouchDialog", () => {
  it("chaque bouton affiché vient du registre : data-action connu, groupe retouch ou panneau, nom accessible", () => {
    setup();
    const dlg = screen.getByRole("dialog");
    const buttons = dlg.querySelectorAll("button");
    expect(buttons.length).toBeGreaterThan(10);
    buttons.forEach((b) => {
      const id = b.getAttribute("data-action");
      expect(id, b.outerHTML).toBeTruthy();
      expect(LIBRARY_ACTIONS[id as keyof typeof LIBRARY_ACTIONS], String(id)).toBeTruthy();
      expect(b.getAttribute("aria-label"), String(id)).toBeTruthy();
    });
  });

  it("les raccourcis d'outils changent de panneau, le pivot est actif sans ouvrir son panneau", () => {
    setup();
    expect(screen.getByTestId("retouch-tool-panel").textContent).toContain("Recadrer");
    key("f");
    expect(screen.getByTestId("retouch-tool-panel").textContent).toContain("Filtres");
    key("a");
    expect(screen.getByTestId("retouch-tool-panel").textContent).toContain("Réglages");
    key("r");
    expect(screen.getByRole("button", { name: /^Annuler la modification/ }).hasAttribute("disabled")).toBe(false);
  });

  it("Ctrl+Z annule, Ctrl+Maj+Z rétablit", async () => {
    setup();
    const undoBtn = () => screen.getByRole("button", { name: /^Annuler la modification/ });
    const redoBtn = () => screen.getByRole("button", { name: /^Rétablir la modification/ });
    expect(undoBtn().hasAttribute("disabled")).toBe(true);
    key("r");
    expect(undoBtn().hasAttribute("disabled")).toBe(false);
    key("z", { ctrlKey: true });
    expect(undoBtn().hasAttribute("disabled")).toBe(true);
    expect(redoBtn().hasAttribute("disabled")).toBe(false);
    key("Z", { ctrlKey: true, shiftKey: true });
    expect(redoBtn().hasAttribute("disabled")).toBe(true);
  });

  it("antislash bascule la comparaison avant/après", () => {
    setup();
    key("\\");
    expect(cv.showBefore).toHaveBeenLastCalledWith(true);
    expect(screen.getByRole("button", { name: /^Comparer avec l'original/ }).getAttribute("aria-pressed")).toBe("true");
    key("\\");
    expect(cv.showBefore).toHaveBeenLastCalledWith(false);
  });

  it("fermer sans modification ferme directement", () => {
    const props = setup();
    fireEvent.click(screen.getByRole("button", { name: /^Fermer le retoucheur/ }));
    expect(props.onClose).toHaveBeenCalled();
  });

  it("fermer avec modifications ouvre le panneau interne, sans confirm natif", () => {
    const confirm = vi.fn();
    vi.stubGlobal("confirm", confirm);
    const props = setup();
    key("r");
    fireEvent.click(screen.getByRole("button", { name: /^Fermer le retoucheur/ }));
    expect(props.onClose).not.toHaveBeenCalled();
    expect(screen.getByText("Abandonner les modifications ?")).toBeTruthy();
    expect(confirm).not.toHaveBeenCalled();
    fireEvent.click(screen.getByRole("button", { name: /^Abandonner les modifications/ }));
    expect(props.onClose).toHaveBeenCalled();
  });

  it("lecture seule : Enregistrer désactivé avec sa raison, Télécharger reste possible", () => {
    setup({ canWriteSpace: false, media: { ...media, canWrite: false } });
    key("r");
    const save = screen.getAllByRole("button", { name: "Enregistrer" })[0];
    expect(save.hasAttribute("disabled")).toBe(true);
    expect(screen.getByText(/Lecture seule : vous ne pouvez pas enregistrer/)).toBeTruthy();
    expect(screen.getByRole("button", { name: /^Télécharger le résultat/ }).hasAttribute("disabled")).toBe(false);
  });

  it("sans modification, Enregistrer est désactivé et explique pourquoi", () => {
    setup();
    expect(screen.getByRole("button", { name: "Enregistrer" }).hasAttribute("disabled")).toBe(true);
    expect(screen.getByText("Aucune modification à enregistrer.")).toBeTruthy();
  });

  it("chargement : outils inertes et message de chargement", () => {
    cv.state = { ready: false, error: null };
    setup();
    expect(screen.getByRole("status", { name: "Chargement de l'image…" })).toBeTruthy();
    expect(screen.getByRole("button", { name: /^Comparer/ }).hasAttribute("disabled")).toBe(true);
  });

  it("erreur de chargement : message et Réessayer", () => {
    cv.state = { ready: false, error: { code: "network" } };
    setup();
    expect(screen.getByRole("alert").textContent).toContain("n'a pas pu être chargée");
    fireEvent.click(screen.getByRole("button", { name: "Réessayer" }));
    expect(cv.retry).toHaveBeenCalled();
  });

  it("Enregistrer ouvre la boîte d'enregistrement avec le rendu complet de la recette", async () => {
    setup();
    key("r");
    fireEvent.click(screen.getByRole("button", { name: "Enregistrer" }));
    await waitFor(() => expect(screen.getByText("Enregistrer la retouche")).toBeTruthy());
  });

  it("le module n'importe pas Fabric hors du hook de canevas, et la page le charge à la demande", () => {
    const dir = resolve(__dirname, "..");
    const page = readFileSync(resolve(dir, "library-page.tsx"), "utf-8");
    expect(page).toMatch(/dynamic\(\(\) => import\("\.\/retouch\/retouch-dialog"\)/);
    expect(page).not.toMatch(/from "\.\/retouch\/retouch-dialog"/);
    for (const f of ["properties-panel.tsx", "preview-dialog.tsx", "library-page.tsx"]) {
      const src = readFileSync(resolve(dir, f), "utf-8");
      expect(src, f).not.toMatch(/from "fabric"/);
      expect(src, f).not.toMatch(/from "[^"]*retouch\/(render|use-retouch-canvas|retouch-dialog)"/);
    }
  });
});
