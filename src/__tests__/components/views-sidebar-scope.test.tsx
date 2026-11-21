// @vitest-environment jsdom
import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { cleanup, fireEvent, render, screen, waitFor, act } from "@testing-library/react";
import { NextIntlClientProvider } from "next-intl";
import fr from "../../../messages/fr.json";
import { ViewsSidebar } from "@/components/bases/base-viewer";
import type { ViewDef } from "@/components/bases/view-scope";

const toastSuccess = vi.fn();
const toastError = vi.fn();
vi.mock("sonner", () => ({
  toast: Object.assign(vi.fn(), {
    success: (...a: unknown[]) => toastSuccess(...a),
    error: (...a: unknown[]) => toastError(...a),
  }),
}));

const fetchMock = vi.fn();

function v(over: Partial<ViewDef> & { id: string }): ViewDef {
  return { name: over.id, type: "grid", isDefault: false, position: 0, config: {}, scope: "shared", createdBy: "me", ...over };
}

const views: ViewDef[] = [
  v({ id: "s1", name: "Pipeline", isDefault: true, type: "kanban" }),
  v({ id: "s2", name: "Relances", createdBy: "other" }),
  v({ id: "p1", name: "Mes demandes", scope: "personal" }),
];

function mount(over: Partial<React.ComponentProps<typeof ViewsSidebar>> = {}) {
  const onCreateView = vi.fn().mockResolvedValue(undefined);
  const onChanged = vi.fn();
  const onDeleted = vi.fn();
  const props = {
    views, activeViewId: "s1", databaseId: "db", spaceIdParam: "sp", viewerId: "me", readOnly: false,
    isPending: false, onCreateView, onChanged, onDeleted, ...over,
  } as React.ComponentProps<typeof ViewsSidebar>;
  render(
    <NextIntlClientProvider locale="fr" messages={fr}><ViewsSidebar {...props} /></NextIntlClientProvider>,
  );
  return { onCreateView, onChanged, onDeleted };
}

beforeEach(() => {
  fetchMock.mockReset();
  fetchMock.mockResolvedValue({ ok: true, json: async () => ({ id: "new" }) });
  vi.stubGlobal("fetch", fetchMock);
  toastSuccess.mockReset();
  toastError.mockReset();
});
afterEach(() => { cleanup(); vi.unstubAllGlobals(); });

async function openMenu(name: string) {
  fireEvent.click(screen.getByRole("button", { name: `Options de la vue ${name}` }));
}

describe("ViewsSidebar portée", () => {
  it("affiche Partagées puis Personnelles", () => {
    mount();
    const heads = screen.getAllByRole("heading", { level: 3 }).map((h) => h.textContent ?? "");
    expect(heads[0]).toContain("Partagées");
    expect(heads[1]).toContain("Personnelles");
    expect(screen.getByRole("link", { name: /Mes demandes/ })).toBeTruthy();
  });

  it("groupe Personnelles absent sans vue personnelle", () => {
    mount({ views: views.filter((x) => x.scope === "shared") });
    expect(screen.queryByText("Personnelles")).toBeNull();
  });

  it("le formulaire propose Personnelle par défaut et envoie scope personal", async () => {
    const { onCreateView } = mount();
    fireEvent.click(screen.getByRole("button", { name: "Ajouter une vue" }));
    fireEvent.click(await screen.findByText("Kanban"));
    const personal = (await screen.findByRole("radio", { name: /Personnelle/ })) as HTMLInputElement;
    expect(personal.checked).toBe(true);
    fireEvent.click(screen.getByRole("button", { name: "Créer" }));
    await waitFor(() => expect(onCreateView).toHaveBeenCalledWith("Kanban", "kanban", "personal"));
  });

  it("choisir Partagée envoie scope shared", async () => {
    const { onCreateView } = mount();
    fireEvent.click(screen.getByRole("button", { name: "Ajouter une vue" }));
    fireEvent.click(await screen.findByText("Grille"));
    fireEvent.click(await screen.findByRole("radio", { name: /Partagée/ }));
    fireEvent.click(screen.getByRole("button", { name: "Créer" }));
    await waitFor(() => expect(onCreateView).toHaveBeenCalledWith(expect.any(String), "grid", "shared"));
  });

  it("Rendre personnelle désactivée avec infobulle pour un non-auteur, au focus clavier aussi", async () => {
    mount();
    await openMenu("Relances");
    const item = await screen.findByRole("menuitem", { name: "Rendre personnelle" });
    expect(item.getAttribute("aria-disabled")).toBe("true");
    act(() => item.focus());
    expect(await screen.findByText("Seul l'auteur de la vue peut changer sa visibilité")).toBeTruthy();
    fireEvent.click(item);
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it("vue par défaut : Rendre personnelle désactivée", async () => {
    mount();
    await openMenu("Pipeline");
    const item = await screen.findByRole("menuitem", { name: "Rendre personnelle" });
    expect(item.getAttribute("aria-disabled")).toBe("true");
    act(() => item.focus());
    expect(await screen.findByText("La vue par défaut doit rester partagée")).toBeTruthy();
  });

  it("rendre partagée : PATCH, toast de visibilité, Annuler repasse en personal", async () => {
    const { onChanged } = mount();
    await openMenu("Mes demandes");
    fireEvent.click(await screen.findByRole("menuitem", { name: "Rendre partagée" }));
    await waitFor(() => expect(toastSuccess).toHaveBeenCalled());
    expect(fetchMock.mock.calls[0][0]).toBe("/api/databases/db/views/p1");
    expect(JSON.parse(fetchMock.mock.calls[0][1].body)).toEqual({ scope: "shared" });
    const [msg, opts] = toastSuccess.mock.calls[0];
    expect(msg).toBe("Vue « Mes demandes » partagée : visible par toute l'organisation");
    expect(onChanged).toHaveBeenCalled();
    await act(async () => { opts.action.onClick(); });
    expect(JSON.parse(fetchMock.mock.calls[1][1].body)).toEqual({ scope: "personal" });
  });

  it("erreur serveur : message du serveur dans un toast d'erreur", async () => {
    fetchMock.mockResolvedValue({ ok: false, status: 400, json: async () => ({ error: "La vue par défaut ne peut pas devenir personnelle" }) });
    mount();
    await openMenu("Relances");
    // Relances est d'un autre auteur : on teste via une vue dont l'auteur est le lecteur
    cleanup();
    mount({ views: [v({ id: "s1", isDefault: true }), v({ id: "s2", name: "Autre" }), v({ id: "s3", name: "Troisième" })] });
    await openMenu("Autre");
    fireEvent.click(await screen.findByRole("menuitem", { name: "Rendre personnelle" }));
    await waitFor(() => expect(toastError).toHaveBeenCalledWith("La vue par défaut ne peut pas devenir personnelle"));
  });

  it("suppression de la dernière vue partagée désactivée avec explication", async () => {
    mount({ views: [v({ id: "s1", name: "Unique" }), v({ id: "p1", name: "Perso", scope: "personal" })] });
    await openMenu("Unique");
    const del = await screen.findByRole("menuitem", { name: "Supprimer la vue" });
    expect(del.getAttribute("aria-disabled")).toBe("true");
    act(() => del.focus());
    expect(await screen.findByText("Une base garde au moins une vue partagée")).toBeTruthy();
    fireEvent.click(del);
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it("suppression d'une vue personnelle : Annuler recrée avec la même portée, nom, type et config", async () => {
    const perso = v({ id: "p1", name: "Mes demandes", type: "kanban", scope: "personal", config: { groupBy: "x" } });
    const { onDeleted } = mount({ views: [views[0], views[1], perso] });
    await openMenu("Mes demandes");
    fireEvent.click(await screen.findByRole("menuitem", { name: "Supprimer la vue" }));
    await waitFor(() => expect(toastSuccess).toHaveBeenCalled());
    expect(fetchMock.mock.calls[0][1].method).toBe("DELETE");
    expect(onDeleted).toHaveBeenCalledWith("p1");
    const [msg, opts] = toastSuccess.mock.calls[0];
    expect(msg).toBe("Vue « Mes demandes » supprimée");
    await act(async () => { opts.action.onClick(); });
    const [url, init] = fetchMock.mock.calls[1];
    expect(url).toBe("/api/databases/db/views");
    expect(init.method).toBe("POST");
    expect(JSON.parse(init.body)).toEqual({ name: "Mes demandes", type: "kanban", scope: "personal", config: { groupBy: "x" } });
  });

  it("toutes les entrées de vue ont la même hauteur", () => {
    mount();
    const rows = document.querySelectorAll("[data-view-row]");
    expect(rows.length).toBe(3);
    rows.forEach((r) => expect(r.className).toContain("h-8"));
  });

  it("lecteur : création et menus désactivés avec explication", () => {
    mount({ readOnly: true });
    expect(screen.getByRole("button", { name: "Ajouter une vue" }).getAttribute("aria-disabled")).toBe("true");
  });
});
