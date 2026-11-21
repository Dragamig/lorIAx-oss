// @vitest-environment jsdom
import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { act, cleanup, fireEvent, screen, waitFor } from "@testing-library/react";
import { toast } from "sonner";
import { CommentEntryMenu } from "@/components/bases/comment-entry-menu";
import { RowActivity } from "@/components/bases/row-activity";
import type { RowActivityComment, RowActivityPage } from "@/lib/databases/row-activity-types";
import type { PermissionLevel } from "@/types";
import { renderWithIntl } from "./support/render-intl";

vi.mock("sonner", () => {
  const fn = Object.assign(vi.fn(), { info: vi.fn(), success: vi.fn(), error: vi.fn() });
  return { toast: fn };
});

const fetchMock = vi.fn();
const json = (b: unknown, status = 200) =>
  Promise.resolve(new Response(JSON.stringify(b), { status, headers: { "Content-Type": "application/json" } }));

function comment(over: Partial<RowActivityComment> = {}): RowActivityComment {
  return {
    type: "comment",
    id: "c1",
    createdAt: "2026-11-14T11:00:00.000Z",
    actor: { id: "u1", name: "Ana" },
    body: "Bonjour",
    mentions: [],
    editedAt: null,
    deleted: false,
    ...over,
  };
}
function page(items: RowActivityComment[], extra: Partial<RowActivityPage> = {}): RowActivityPage {
  return { items, nextCursor: null, canClear: false, permission: "editor", viewerId: "u1", ...extra };
}

function mountMenu(viewerId: string, permission: PermissionLevel, c: RowActivityComment = comment()) {
  const onEdit = vi.fn();
  const onDelete = vi.fn().mockResolvedValue(undefined);
  renderWithIntl(<CommentEntryMenu comment={c} viewerId={viewerId} permission={permission} onEdit={onEdit} onDelete={onDelete} />);
  return { onEdit, onDelete };
}
const trigger = () => screen.queryByRole("button", { name: "Actions du commentaire" });
function openMenu() {
  const t = trigger() as HTMLElement;
  fireEvent.keyDown(t, { key: "Enter" });
  fireEvent.click(t);
}
const items = () => screen.queryAllByRole("menuitem").map((e) => e.textContent);

beforeEach(() => {
  vi.clearAllMocks();
  fetchMock.mockReset();
  vi.stubGlobal("fetch", fetchMock);
});
afterEach(() => {
  cleanup();
  vi.unstubAllGlobals();
});

describe("CommentEntryMenu", () => {
  it("l'auteur voit Modifier et Supprimer", async () => {
    mountMenu("u1", "editor");
    openMenu();
    await waitFor(() => expect(items()).toEqual(["Modifier", "Supprimer"]));
  });

  it("un admin d'espace non auteur voit Supprimer et pas Modifier", async () => {
    mountMenu("u2", "admin");
    openMenu();
    await waitFor(() => expect(items()).toEqual(["Supprimer"]));
  });

  it("un éditeur non auteur : aucun menu", () => {
    mountMenu("u2", "editor");
    expect(trigger()).toBeNull();
  });

  it("viewer : aucun menu", () => {
    mountMenu("u1", "viewer");
    expect(trigger()).toBeNull();
  });

  it("auteur nul : pas de Modifier, Supprimer pour l'admin", async () => {
    mountMenu("u1", "admin", comment({ actor: null }));
    openMenu();
    await waitFor(() => expect(items()).toEqual(["Supprimer"]));
  });

  it("auteur nul et éditeur : aucun menu", () => {
    mountMenu("u1", "editor", comment({ actor: null }));
    expect(trigger()).toBeNull();
  });

  it("le menu a info-bulle et aria-label", () => {
    mountMenu("u1", "editor");
    const t = trigger() as HTMLElement;
    expect(t.getAttribute("aria-label")).toBe("Actions du commentaire");
    expect(t.getAttribute("aria-haspopup")).toBe("menu");
  });

  it("Modifier appelle onEdit, Supprimer appelle onDelete", async () => {
    const { onEdit, onDelete } = mountMenu("u1", "editor");
    openMenu();
    fireEvent.click(await screen.findByRole("menuitem", { name: "Modifier" }));
    expect(onEdit).toHaveBeenCalledTimes(1);
    openMenu();
    fireEvent.click(await screen.findByRole("menuitem", { name: "Supprimer" }));
    await waitFor(() => expect(onDelete).toHaveBeenCalledTimes(1));
  });
});

function mountActivity(items: RowActivityComment[], extra: Partial<RowActivityPage> = {}) {
  fetchMock.mockImplementation((url: string, init?: RequestInit) => {
    if (!init?.method || init.method === "GET") return json(page(items, extra));
    return json({ comment: { id: "c1" } });
  });
  return renderWithIntl(<RowActivity databaseId="d1" rowId="r1" revision="{}" columns={[]} />);
}
const calls = (method: string) => fetchMock.mock.calls.filter((c) => c[1]?.method === method);
const editArea = () => screen.getByRole("combobox", { name: "Modifier le commentaire" }) as HTMLTextAreaElement;

async function startEdit() {
  const t = await screen.findByRole("button", { name: "Actions du commentaire" });
  fireEvent.keyDown(t, { key: "Enter" });
  fireEvent.click(t);
  fireEvent.click(await screen.findByRole("menuitem", { name: "Modifier" }));
}

describe("Commentaire : édition et suppression dans la chronologie", () => {
  it("Modifier : Ctrl+Entrée enregistre, toast, retour à l'affichage", async () => {
    mountActivity([comment({ body: "Bonjour" })]);
    await startEdit();
    expect(editArea().value).toBe("Bonjour");
    fireEvent.change(editArea(), { target: { value: "Salut", selectionStart: 5 } });
    fireEvent.keyDown(editArea(), { key: "Enter", ctrlKey: true });
    await waitFor(() => expect(calls("PATCH")).toHaveLength(1));
    expect(calls("PATCH")[0][0]).toBe("/api/databases/d1/rows/r1/comments/c1");
    expect(JSON.parse(calls("PATCH")[0][1].body)).toEqual({ body: "Salut" });
    await waitFor(() => expect(screen.queryByRole("combobox", { name: "Modifier le commentaire" })).toBeNull());
    expect(toast.success).toHaveBeenCalledWith("Commentaire modifié");
  });

  it("Modifier : Échap annule sans appel réseau et ne se propage pas", async () => {
    mountActivity([comment()]);
    await startEdit();
    const outer = vi.fn();
    document.addEventListener("keydown", outer);
    fireEvent.change(editArea(), { target: { value: "autre", selectionStart: 5 } });
    fireEvent.keyDown(editArea(), { key: "Escape" });
    document.removeEventListener("keydown", outer);
    expect(screen.queryByRole("combobox", { name: "Modifier le commentaire" })).toBeNull();
    expect(screen.getByText("Bonjour")).toBeTruthy();
    expect(calls("PATCH")).toHaveLength(0);
    expect(outer).not.toHaveBeenCalled();
  });

  it("Échap rend le focus à l'entrée du commentaire", async () => {
    mountActivity([comment()]);
    await startEdit();
    fireEvent.keyDown(editArea(), { key: "Escape" });
    await waitFor(() => expect(document.activeElement?.tagName).toBe("LI"));
  });

  it("Échap avec le focus sur Enregistrer annule et ne se propage pas", async () => {
    mountActivity([comment()]);
    await startEdit();
    fireEvent.change(editArea(), { target: { value: "autre", selectionStart: 5 } });
    const outer = vi.fn();
    document.addEventListener("keydown", outer);
    fireEvent.keyDown(screen.getByRole("button", { name: "Enregistrer" }), { key: "Escape" });
    document.removeEventListener("keydown", outer);
    expect(screen.queryByRole("combobox", { name: "Modifier le commentaire" })).toBeNull();
    expect(outer).not.toHaveBeenCalled();
    expect(calls("PATCH")).toHaveLength(0);
  });

  it("Échap avec le focus sur Annuler annule et ne se propage pas", async () => {
    mountActivity([comment()]);
    await startEdit();
    const outer = vi.fn();
    document.addEventListener("keydown", outer);
    fireEvent.keyDown(screen.getByRole("button", { name: "Annuler" }), { key: "Escape" });
    document.removeEventListener("keydown", outer);
    expect(screen.queryByRole("combobox", { name: "Modifier le commentaire" })).toBeNull();
    expect(outer).not.toHaveBeenCalled();
  });

  it("Enregistrer sans changement : pas de PATCH, sortie de l'édition", async () => {
    mountActivity([comment({ body: "Bonjour" })]);
    await startEdit();
    fireEvent.keyDown(editArea(), { key: "Enter", ctrlKey: true });
    await waitFor(() => expect(screen.queryByRole("combobox", { name: "Modifier le commentaire" })).toBeNull());
    expect(calls("PATCH")).toHaveLength(0);
    expect(toast.success).not.toHaveBeenCalled();
  });

  it("Modifier : le bouton Annuler la modification annule", async () => {
    mountActivity([comment()]);
    await startEdit();
    fireEvent.click(screen.getByRole("button", { name: "Annuler" }));
    expect(screen.queryByRole("combobox", { name: "Modifier le commentaire" })).toBeNull();
  });

  it("Modifier : les mentions existantes sont conservées à l'enregistrement", async () => {
    const id = "22222222-2222-4222-8222-222222222222";
    mountActivity([comment({ body: `Salut @[Bob](user:${id}) ok`, mentions: [id] })]);
    await startEdit();
    expect(editArea().value).toBe("Salut @Bob ok");
    fireEvent.change(editArea(), { target: { value: "Salut @Bob bien", selectionStart: 15 } });
    fireEvent.keyDown(editArea(), { key: "Enter", ctrlKey: true });
    await waitFor(() => expect(calls("PATCH")).toHaveLength(1));
    expect(JSON.parse(calls("PATCH")[0][1].body)).toEqual({ body: `Salut @[Bob](user:${id}) bien` });
  });

  it("échec d'enregistrement : le texte reste et un toast d'erreur apparaît", async () => {
    fetchMock.mockImplementation((url: string, init?: RequestInit) =>
      !init?.method || init.method === "GET" ? json(page([comment()])) : json({ error: "x" }, 500),
    );
    renderWithIntl(<RowActivity databaseId="d1" rowId="r1" revision="{}" columns={[]} />);
    await startEdit();
    fireEvent.change(editArea(), { target: { value: "Nouveau", selectionStart: 7 } });
    fireEvent.keyDown(editArea(), { key: "Enter", ctrlKey: true });
    await waitFor(() => expect(toast.error).toHaveBeenCalledWith("Impossible de modifier le commentaire"));
    expect(editArea().value).toBe("Nouveau");
  });

  it("Supprimer : DELETE, toast avec Annuler, entrée Commentaire supprimé", async () => {
    let deleted = false;
    fetchMock.mockImplementation((url: string, init?: RequestInit) => {
      if (init?.method === "DELETE") {
        deleted = true;
        return json({ comment: { id: "c1" } });
      }
      return json(page([deleted ? comment({ deleted: true, body: null }) : comment()]));
    });
    renderWithIntl(<RowActivity databaseId="d1" rowId="r1" revision="{}" columns={[]} />);
    const t = await screen.findByRole("button", { name: "Actions du commentaire" });
    fireEvent.keyDown(t, { key: "Enter" });
    fireEvent.click(t);
    fireEvent.click(await screen.findByRole("menuitem", { name: "Supprimer" }));
    await waitFor(() => expect(calls("DELETE")).toHaveLength(1));
    expect(calls("DELETE")[0][0]).toBe("/api/databases/d1/rows/r1/comments/c1");
    await waitFor(() => expect(toast.success).toHaveBeenCalled());
    const [msg, opts] = (toast.success as ReturnType<typeof vi.fn>).mock.calls[0];
    expect(msg).toBe("Commentaire supprimé");
    expect(opts.action.label).toBe("Annuler");
    expect(await screen.findByText("Commentaire supprimé")).toBeTruthy();
  });

  async function deleteAndGetUndo(restoreStatus: number) {
    fetchMock.mockImplementation((url: string, init?: RequestInit) => {
      if (!init?.method || init.method === "GET") return json(page([comment()]));
      if (String(url).endsWith("/restore")) return json({ comment: { id: "c1" } }, restoreStatus);
      return json({ comment: { id: "c1" } });
    });
    renderWithIntl(<RowActivity databaseId="d1" rowId="r1" revision="{}" columns={[]} />);
    const t = await screen.findByRole("button", { name: "Actions du commentaire" });
    fireEvent.keyDown(t, { key: "Enter" });
    fireEvent.click(t);
    fireEvent.click(await screen.findByRole("menuitem", { name: "Supprimer" }));
    await waitFor(() => expect(toast.success).toHaveBeenCalled());
    return (toast.success as ReturnType<typeof vi.fn>).mock.calls[0][1].action.onClick as () => void;
  }

  it("Annuler appelle restore et rétablit le commentaire", async () => {
    const undo = await deleteAndGetUndo(200);
    await act(async () => undo());
    await waitFor(() => expect(calls("POST")).toHaveLength(1));
    expect(calls("POST")[0][0]).toBe("/api/databases/d1/rows/r1/comments/c1/restore");
    expect(toast.error).not.toHaveBeenCalled();
  });

  it("échec de restore : toast d'erreur", async () => {
    const undo = await deleteAndGetUndo(500);
    await act(async () => undo());
    await waitFor(() => expect(toast.error).toHaveBeenCalledWith("Impossible de restaurer le commentaire"));
  });

  it("échec de suppression : toast d'erreur", async () => {
    fetchMock.mockImplementation((url: string, init?: RequestInit) =>
      !init?.method || init.method === "GET" ? json(page([comment()])) : json({ error: "x" }, 500),
    );
    renderWithIntl(<RowActivity databaseId="d1" rowId="r1" revision="{}" columns={[]} />);
    const t = await screen.findByRole("button", { name: "Actions du commentaire" });
    fireEvent.keyDown(t, { key: "Enter" });
    fireEvent.click(t);
    fireEvent.click(await screen.findByRole("menuitem", { name: "Supprimer" }));
    await waitFor(() => expect(toast.error).toHaveBeenCalledWith("Impossible de supprimer le commentaire"));
  });

  it("un commentaire supprimé n'a pas de menu", async () => {
    mountActivity([comment({ deleted: true, body: null })]);
    expect(await screen.findByText("Commentaire supprimé")).toBeTruthy();
    expect(screen.queryByRole("button", { name: "Actions du commentaire" })).toBeNull();
  });
});
