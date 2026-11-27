// @vitest-environment jsdom
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react";

vi.mock("next-intl", async () => (await import("../../test-fixtures")).intlMock());
const toast = vi.hoisted(() => ({ success: vi.fn(), info: vi.fn(), error: vi.fn() }));
vi.mock("sonner", () => ({ toast }));

import { SavePanel, type SavePanelProps } from "./save-panel";
import type { SaveOutcome } from "../save-flow";

const webp = vi.hoisted(() => ({ ok: true }));
vi.mock("../render", async (orig) => ({ ...(await orig<typeof import("../render")>()), canEncodeWebp: () => webp.ok }));

const fetchMock = vi.fn();
beforeEach(() => vi.stubGlobal("fetch", fetchMock));
afterEach(() => {
  cleanup();
  vi.clearAllMocks();
  fetchMock.mockReset();
});

const usages = { entries: [{ targetType: "document", targetId: "d1", title: "Rapport", href: "/d/1" }], hiddenCount: 1 };
const json = (b: unknown, status = 200) => new Response(JSON.stringify(b), { status });

function setup(over: Partial<SavePanelProps> = {}, media: Partial<SavePanelProps["media"]> = {}) {
  const save = vi.fn<NonNullable<SavePanelProps["save"]>>(async () => ({ kind: "created", mediaId: "n", undo: async () => {} }) as SaveOutcome);
  const props: SavePanelProps = {
    open: true,
    onOpenChange: vi.fn(),
    media: { id: "m1", filename: "photo.png", mimeType: "image/png", spaceId: "s1", folderId: null, currentVersion: 3, ...media },
    canWriteOriginal: true,
    spaces: [{ id: "s1", name: "Direction" }],
    folders: [{ id: "f1", name: "Affiches" }],
    getBlob: async () => new Blob(["x"]),
    onSaved: vi.fn(),
    save,
    ...over,
  };
  render(<SavePanel {...props} />);
  return { props, save };
}

describe("SavePanel", () => {
  it("dérivé par défaut : nom proposé, mode derived, espace et dossier choisis", async () => {
    const { props, save } = setup();
    expect((screen.getByLabelText("Nom du fichier") as HTMLInputElement).value).toBe("photo (retouché)");
    expect((screen.getByLabelText("Espace") as HTMLSelectElement).value).toBe("s1");
    fireEvent.change(screen.getByLabelText("Dossier"), { target: { value: "f1" } });
    fireEvent.click(screen.getByRole("button", { name: "Enregistrer" }));
    await waitFor(() => expect(save).toHaveBeenCalled());
    expect(save.mock.calls[0][0]).toMatchObject({ sourceId: "m1", mode: "derived", spaceId: "s1", folderId: "f1", format: "png", quality: 90 });
    await waitFor(() => expect(props.onSaved).toHaveBeenCalled());
    expect(props.onOpenChange).toHaveBeenCalledWith(false);
    expect(toast.success).toHaveBeenCalled();
  });

  it("la case nouvelle version reste désactivée sans droit d'écriture, avec la raison", () => {
    setup({ canWriteOriginal: false });
    const box = screen.getByLabelText("Enregistrer comme nouvelle version de l'original") as HTMLInputElement;
    expect(box.disabled).toBe(true);
    expect(screen.getByText(/Vous n'avez pas le droit de modifier l'original/)).toBeTruthy();
    expect(box.closest("label")?.getAttribute("title")).toMatch(/pas le droit/);
  });

  it("en mode version, la liste Utilisé dans est chargée avant la validation", async () => {
    let resolve!: (r: Response) => void;
    fetchMock.mockReturnValue(new Promise<Response>((r) => (resolve = r)));
    const { save } = setup();
    fireEvent.click(screen.getByLabelText("Enregistrer comme nouvelle version de l'original"));
    const confirm = screen.getByRole("button", { name: "Enregistrer" }) as HTMLButtonElement;
    expect(confirm.disabled).toBe(true);
    expect(fetchMock.mock.calls[0][0]).toBe("/api/media/m1/usages");
    expect(screen.getByRole("status").textContent).toMatch(/Chargement/);
    resolve(json(usages));
    await screen.findByText("Rapport");
    expect(screen.getByText(/2 emplacements/)).toBeTruthy();
    // l'ordre du DOM : la liste précède le bouton de validation
    const list = screen.getByText("Rapport");
    expect(list.compareDocumentPosition(confirm) & Node.DOCUMENT_POSITION_FOLLOWING).toBeTruthy();
    expect((screen.getByRole("button", { name: "Enregistrer" }) as HTMLButtonElement).disabled).toBe(false);
    fireEvent.click(screen.getByRole("button", { name: "Enregistrer" }));
    await waitFor(() => expect(save).toHaveBeenCalled());
    expect(save.mock.calls[0][0]).toMatchObject({ mode: "version", expectedVersion: 3, folderId: null });
  });

  it("échec du chargement des usages : validation bloquée, Réessayer disponible", async () => {
    fetchMock.mockResolvedValueOnce(json({}, 500)).mockResolvedValueOnce(json(usages));
    setup();
    fireEvent.click(screen.getByLabelText("Enregistrer comme nouvelle version de l'original"));
    expect((await screen.findByRole("alert")).textContent).toMatch(/Impossible de charger/);
    expect((screen.getByRole("button", { name: "Enregistrer" }) as HTMLButtonElement).disabled).toBe(true);
    fireEvent.click(screen.getByRole("button", { name: "Réessayer" }));
    await screen.findByText("Rapport");
  });

  it("lecture seule : Enregistrer désactivé avec la raison", () => {
    setup({ spaces: [] });
    expect((screen.getByRole("button", { name: "Enregistrer" }) as HTMLButtonElement).disabled).toBe(true);
    expect(screen.getAllByText(/Vous n'avez le droit d'écrire dans aucun espace/).length).toBeGreaterThan(0);
  });

  it("avertissements GIF animé et position GPS", () => {
    setup({}, { mimeType: "image/gif", hasLocation: true });
    expect(screen.getByText(/seule la première image est conservée/)).toBeTruthy();
    expect(screen.getByText(/position GPS/)).toBeTruthy();
  });

  it("507 : message de quota dans la boîte et en toast, la boîte reste ouverte", async () => {
    const { props } = setup({ save: vi.fn(async () => ({ kind: "error", status: 507, message: "", quotaFull: true }) as SaveOutcome) });
    fireEvent.click(screen.getByRole("button", { name: "Enregistrer" }));
    expect((await screen.findByRole("alert")).textContent).toMatch(/Quota de stockage atteint/);
    expect(toast.error).toHaveBeenCalledWith(expect.stringMatching(/Quota de stockage atteint/));
    expect(props.onOpenChange).not.toHaveBeenCalledWith(false);
    expect(props.onSaved).not.toHaveBeenCalled();
  });

  it("progression pendant l'envoi puis boutons réactivés", async () => {
    let done!: (o: SaveOutcome) => void;
    setup({ save: vi.fn(() => new Promise<SaveOutcome>((r) => (done = r))) });
    fireEvent.click(screen.getByRole("button", { name: "Enregistrer" }));
    expect(await screen.findByRole("progressbar")).toBeTruthy();
    done({ kind: "duplicate", mediaId: "x" });
    await waitFor(() => expect(screen.queryByRole("progressbar")).toBeNull());
  });

  it("qualité visible seulement pour jpeg et webp ; boutons avec libellé accessible", () => {
    setup();
    expect(screen.queryByLabelText(/Qualité/)).toBeNull();
    fireEvent.change(screen.getByLabelText("Format"), { target: { value: "jpeg" } });
    expect(screen.getByLabelText("Qualité : 90")).toBeTruthy();
    for (const b of screen.getAllByRole("button")) expect(b.getAttribute("aria-label") || b.textContent).toBeTruthy();
  });

  it("texte d'intro propre à chaque mode", () => {
    fetchMock.mockResolvedValue(json(usages));
    setup();
    expect(screen.getByText(/devient un nouveau média/)).toBeTruthy();
    fireEvent.click(screen.getByLabelText("Enregistrer comme nouvelle version de l'original"));
    expect(screen.queryByText(/devient un nouveau média/)).toBeNull();
    expect(screen.getByText(/remplace l.image par une nouvelle version/)).toBeTruthy();
  });

  it("option WebP désactivée avec explication quand le navigateur ne l'encode pas", () => {
    webp.ok = false;
    setup();
    const opt = screen.getByRole("option", { name: "WebP" }) as HTMLOptionElement;
    expect(opt.disabled).toBe(true);
    expect(opt.title).toMatch(/WebP/);
    webp.ok = true;
  });
});
