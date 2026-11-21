// @vitest-environment jsdom
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react";

const h = vi.hoisted(() => ({
  toast: Object.assign(vi.fn(), { error: vi.fn(), success: vi.fn() }),
  pickerProps: null as null | { max?: number; mode?: string; open: boolean; onPick: (i: unknown[], o: object) => void },
}));

vi.mock("next-intl", async () => (await import("@/components/media/test-fixtures")).intlMock());
vi.mock("sonner", () => ({ toast: h.toast }));
vi.mock("@/components/media/picker/media-picker", () => ({
  MediaPicker: (p: { max?: number; mode?: string; open: boolean; onPick: (i: unknown[], o: object) => void }) => {
    h.pickerProps = p;
    return p.open ? <div role="dialog" data-testid="picker" /> : null;
  },
}));

import { AttachmentCell } from "../attachment-cell";

const M1 = "11111111-1111-4111-8111-111111111111";
const M2 = "22222222-2222-4222-8222-222222222222";
const att = (mediaId: string, filename: string) => ({ mediaId, filename, mimeType: "application/pdf", size: 2048 });
const picked = (id: string, filename: string) => ({
  id, url: `/api/media/${id}`, filename, title: null, altText: null, mimeType: "application/pdf", kind: "pdf", sizeBytes: 10,
});

const fetchMock = vi.fn();
beforeEach(() => {
  h.toast.mockReset();
  h.toast.error.mockReset();
  h.toast.success.mockReset();
  fetchMock.mockReset();
  fetchMock.mockResolvedValue({ ok: true, status: 200, json: async () => ({}) });
  vi.stubGlobal("fetch", fetchMock);
});
afterEach(() => {
  cleanup();
  vi.unstubAllGlobals();
});

async function openList() {
  fireEvent.click(screen.getByRole("button", { name: /Pièces jointes/ }));
  await screen.findByRole("list", { name: "Pièces jointes" });
}

describe("AttachmentCell", () => {
  it("affiche la forme héritée sans key (bug connu) sans exception, retirable, téléchargement désactivé", async () => {
    const onChange = vi.fn();
    render(<AttachmentCell value={[{ filename: "a.pdf", mimeType: "application/pdf" }] as never} onChange={onChange} spaceId="s1" />);
    await openList();
    expect(screen.getByText("a.pdf")).toBeTruthy();
    expect(screen.getByText("Fichier introuvable")).toBeTruthy();
    expect(screen.getByRole("button", { name: "Télécharger" }).getAttribute("aria-disabled")).toBe("true");
    fireEvent.click(screen.getByRole("button", { name: "Retirer" }));
    expect(onChange).toHaveBeenCalledWith([]);
  });

  it("tolère null, tableau vide et éléments illisibles", () => {
    render(<AttachmentCell value={null} onChange={vi.fn()} spaceId="s1" />);
    expect(screen.getByRole("button", { name: "Ajouter un fichier" })).toBeTruthy();
    cleanup();
    render(<AttachmentCell value={[null, "x"] as never} onChange={vi.fn()} spaceId="s1" />);
  });

  it("ajoute 3 médias d'un coup avec la nouvelle forme et limite le sélecteur", () => {
    const onChange = vi.fn();
    render(<AttachmentCell value={[att(M1, "a.pdf")]} onChange={onChange} spaceId="s1" />);
    fireEvent.click(screen.getByRole("button", { name: /Pièces jointes/ }));
    fireEvent.click(screen.getByRole("button", { name: "Ajouter un fichier" }));
    expect(h.pickerProps?.mode).toBe("multiple");
    expect(h.pickerProps?.max).toBe(19);
    h.pickerProps!.onPick([picked("a", "1.pdf"), picked("b", "2.pdf"), picked("c", "3.pdf")], {});
    const next = onChange.mock.calls[0][0];
    expect(next).toHaveLength(4);
    expect(next[1]).toEqual({ mediaId: "a", filename: "1.pdf", mimeType: "application/pdf", size: 10 });
    expect(next[0]).toEqual(att(M1, "a.pdf"));
  });

  it("refuse la 21e pièce avec un toast et désactive l'ajout au plafond", () => {
    const full = Array.from({ length: 20 }, (_, i) => att(M1, `f${i}.pdf`));
    const onChange = vi.fn();
    render(<AttachmentCell value={full} onChange={onChange} spaceId="s1" />);
    fireEvent.click(screen.getByRole("button", { name: /Pièces jointes/ }));
    const add = screen.getByRole("button", { name: "Ajouter un fichier" });
    expect(add.getAttribute("aria-disabled")).toBe("true");
    fireEvent.click(add);
    expect(h.pickerProps?.open).toBe(false);
    h.pickerProps!.onPick([picked("z", "z.pdf")], {});
    expect(onChange).not.toHaveBeenCalled();
    expect(h.toast.error).toHaveBeenCalled();
  });

  it("retire avec toast Annuler qui restaure la valeur d'origine", async () => {
    const onChange = vi.fn();
    const value = [att(M1, "a.pdf"), att(M2, "b.pdf")];
    render(<AttachmentCell value={value} onChange={onChange} spaceId="s1" />);
    await openList();
    fireEvent.click(screen.getAllByRole("button", { name: "Retirer" })[0]);
    expect(onChange).toHaveBeenLastCalledWith([value[1]]);
    const opts = h.toast.mock.calls[0][1] as { action: { label: string; onClick: () => void } };
    expect(opts.action.label).toBe("Annuler");
    opts.action.onClick();
    expect(onChange).toHaveBeenLastCalledWith(value);
  });

  it("réordonne au clavier (boutons) et annule", async () => {
    const onChange = vi.fn();
    const value = [att(M1, "a.pdf"), att(M2, "b.pdf")];
    render(<AttachmentCell value={value} onChange={onChange} spaceId="s1" />);
    await openList();
    expect(screen.getAllByRole("button", { name: "Monter" })[0].getAttribute("aria-disabled")).toBe("true");
    fireEvent.click(screen.getAllByRole("button", { name: "Descendre" })[0]);
    expect(onChange).toHaveBeenLastCalledWith([value[1], value[0]]);
    (h.toast.mock.calls[0][1] as { action: { onClick: () => void } }).action.onClick();
    expect(onChange).toHaveBeenLastCalledWith(value);
  });

  it("affiche « Média manquant » quand la fiche rend 404 et désactive le téléchargement", async () => {
    fetchMock.mockImplementation(async (url: string) =>
      url.endsWith("/meta") ? { ok: false, status: 404, json: async () => ({}) } : { ok: true, status: 200, json: async () => ({}) }
    );
    render(<AttachmentCell value={[att(M1, "a.pdf")]} onChange={vi.fn()} spaceId="s1" />);
    await openList();
    await waitFor(() => expect(screen.getByText("Média manquant")).toBeTruthy());
    expect(screen.getByRole("button", { name: "Télécharger" }).getAttribute("aria-disabled")).toBe("true");
  });

  it("affiche « Média manquant » quand la fiche porte deletedAt (corbeille)", async () => {
    fetchMock.mockImplementation(async (url: string) =>
      url.endsWith("/meta")
        ? { ok: true, status: 200, json: async () => ({ media: { deletedAt: "2026-11-15T10:00:00.000Z" } }) }
        : { ok: true, status: 200, json: async () => ({}) }
    );
    render(<AttachmentCell value={[att(M1, "a.pdf")]} onChange={vi.fn()} spaceId="s1" />);
    await openList();
    await waitFor(() => expect(screen.getByText("Média manquant")).toBeTruthy());
  });

  it("n'appelle plus POST /api/attachments", async () => {
    render(<AttachmentCell value={[att(M1, "a.pdf")]} onChange={vi.fn()} spaceId="s1" />);
    await openList();
    expect(fetchMock.mock.calls.some((c) => c[0] === "/api/attachments")).toBe(false);
  });

  it("pièce avec mediaId : aucun appel à l'alias par clé, même si une clé est aussi stockée", async () => {
    fetchMock.mockResolvedValue({ ok: true, status: 200, json: async () => ({ url: "https://s3/x" }) });
    const open = vi.spyOn(window, "open").mockReturnValue(null);
    const value = [{ mediaId: M1, key: "k/a.png", filename: "a.png", mimeType: "image/png", size: 5 }];
    render(<AttachmentCell value={value as never} onChange={vi.fn()} spaceId="s1" />);
    await openList();
    fireEvent.click(screen.getByRole("button", { name: "Télécharger" }));
    expect(fetchMock.mock.calls.some((c) => String(c[0]).includes("/api/attachments/signed"))).toBe(false);
    open.mockRestore();
  });

  it("pièce héritée avec key seule : URL signée par l'alias permanent, échec réseau sans exception", async () => {
    fetchMock.mockRejectedValue(new Error("réseau"));
    const open = vi.spyOn(window, "open").mockReturnValue(null);
    render(<AttachmentCell value={[{ key: "k/a.pdf", filename: "a.pdf", mimeType: "application/pdf", size: 5 }] as never} onChange={vi.fn()} spaceId="s1" />);
    await openList();
    fireEvent.click(screen.getByRole("button", { name: "Télécharger" }));
    await waitFor(() => expect(h.toast.error).toHaveBeenCalledWith("Fichier introuvable"));
    expect(fetchMock).toHaveBeenCalledWith("/api/attachments/signed?key=k%2Fa.pdf");
    expect(open).not.toHaveBeenCalled();
    open.mockRestore();
  });

  it("lecture seule : ni ajout, ni retrait, ni réordonnancement", async () => {
    render(<AttachmentCell value={[att(M1, "a.pdf")]} onChange={vi.fn()} readOnly />);
    await openList();
    expect(screen.queryByRole("button", { name: "Retirer" })).toBeNull();
    expect(screen.queryByRole("button", { name: "Monter" })).toBeNull();
    expect(screen.queryByRole("button", { name: "Ajouter un fichier" })).toBeNull();
  });

  it("Ajouter : info-bulle au focus clavier, pas seulement un title natif", () => {
    render(<AttachmentCell value={null} onChange={vi.fn()} spaceId="s1" />);
    const add = screen.getByRole("button", { name: "Ajouter un fichier" });
    expect(add.getAttribute("title")).toBeNull();
    fireEvent.focus(add);
    expect(screen.getByRole("tooltip").textContent).toBe("Ajouter un fichier");
  });
});
