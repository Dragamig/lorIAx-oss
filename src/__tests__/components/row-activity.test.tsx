// @vitest-environment jsdom
import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { cleanup, fireEvent, screen, waitFor } from "@testing-library/react";
import { toast } from "sonner";
import { RowActivity } from "@/components/bases/row-activity";
import type { DbColumn } from "@/components/editor/extensions/database-block/types";
import type { RowHistoryItem } from "@/lib/databases/row-history-types";
import type { RowActivityComment, RowActivityItem, RowActivityPage, RowActivityTaskEvent } from "@/lib/databases/row-activity-types";
import { renderWithIntl } from "./support/render-intl";

vi.mock("sonner", () => {
  const fn = Object.assign(vi.fn(), { info: vi.fn(), success: vi.fn(), error: vi.fn() });
  return { toast: fn };
});

let seq = 0;
function entry(over: Partial<RowHistoryItem> = {}, at = "2026-11-14T10:00:00.000Z"): RowHistoryItem & { type: "change" } {
  seq += 1;
  return {
    type: "change",
    id: `h${seq}`,
    kind: "updated",
    source: "ui",
    actor: { id: "u1", name: "Ana" },
    actorLabel: null,
    automationId: null,
    batchId: `b${seq}`,
    changes: [{ columnId: "c", columnName: "Ville", columnType: "text", before: "Lyon", after: "Paris" }],
    createdAt: at,
    ...over,
  };
}

function page(items: RowActivityItem[], extra: Partial<RowActivityPage> = {}): RowActivityPage {
  return { items, nextCursor: null, canClear: false, permission: "editor", viewerId: "u1", ...extra };
}

function comment(over: Partial<RowActivityComment> = {}): RowActivityComment {
  seq += 1;
  return {
    type: "comment",
    id: `c${seq}`,
    createdAt: "2026-11-14T11:00:00.000Z",
    actor: { id: "u1", name: "Ana" },
    body: "Bonjour",
    mentions: [],
    editedAt: null,
    deleted: false,
    ...over,
  };
}

function taskEvent(type: RowActivityTaskEvent["type"], over: Partial<RowActivityTaskEvent> = {}): RowActivityTaskEvent {
  seq += 1;
  return {
    type,
    id: `t${seq}`,
    createdAt: "2026-11-14T12:00:00.000Z",
    actor: { id: "u1", name: "Ana" },
    taskId: "task-1",
    taskTitle: "Appeler Acme",
    ...over,
  };
}

function json(body: unknown, status = 200) {
  return Promise.resolve(new Response(JSON.stringify(body), { status, headers: { "Content-Type": "application/json" } }));
}

const fetchMock = vi.fn();

function mount(onOpenTask?: (id: string) => void) {
  return renderWithIntl(<RowActivity databaseId="d1" rowId="r1" revision="{}" columns={[]} onOpenTask={onOpenTask} />);
}

beforeEach(() => {
  vi.clearAllMocks();
  fetchMock.mockReset();
  vi.stubGlobal("fetch", fetchMock);
});
afterEach(() => {
  cleanup();
  vi.unstubAllGlobals();
});

describe("RowActivity", () => {
  it("état chargement : squelettes, puis liste", async () => {
    fetchMock.mockReturnValue(json(page([entry()])));
    mount();
    expect(screen.getByRole("status", { name: "Chargement de l'activité" })).toBeTruthy();
    expect(await screen.findByText(/Ana a modifié Ville/)).toBeTruthy();
    expect(screen.getByText("Lyon")).toBeTruthy();
    expect(screen.getByText(/Paris/)).toBeTruthy();
  });

  it("état vide", async () => {
    fetchMock.mockReturnValue(json(page([])));
    mount();
    expect(await screen.findByText(/Aucune modification/)).toBeTruthy();
  });

  it("état erreur puis Réessayer recharge", async () => {
    fetchMock.mockReturnValueOnce(json({ error: "x" }, 500));
    mount();
    const retry = await screen.findByRole("button", { name: "Réessayer" });
    fetchMock.mockReturnValue(json(page([entry()])));
    fireEvent.click(retry);
    expect(await screen.findByText(/Ana a modifié Ville/)).toBeTruthy();
    expect(fetchMock).toHaveBeenCalledTimes(2);
  });

  it("Voir plus charge la page suivante avec le curseur", async () => {
    fetchMock.mockReturnValueOnce(json(page([entry({ actor: { id: "u1", name: "Ana" } })], { nextCursor: "CUR 1" })));
    mount();
    const more = await screen.findByRole("button", { name: "Voir plus" });
    fetchMock.mockReturnValueOnce(
      json(page([entry({ actor: { id: "u2", name: "Bob" } }, "2026-11-13T10:00:00.000Z")])),
    );
    fireEvent.click(more);
    await waitFor(() => expect(fetchMock).toHaveBeenCalledTimes(2));
    expect(fetchMock.mock.calls[1][0]).toContain("cursor=CUR%201");
    expect(await screen.findByText(/Bob a modifié Ville/)).toBeTruthy();
  });

  it("groupe : dépliable au clic", async () => {
    const a = entry({}, "2026-11-14T10:00:30.000Z");
    const b = entry(
      { changes: [{ columnId: "n", columnName: "Nom", columnType: "text", before: "x", after: "y" }] },
      "2026-11-14T10:00:00.000Z",
    );
    fetchMock.mockReturnValue(json(page([a, b])));
    mount();
    expect(await screen.findByText(/Ana a modifié 2 champs/)).toBeTruthy();
    const btn = screen.getByRole("button", { name: "Déplier" });
    expect(btn.getAttribute("aria-expanded")).toBe("false");
    expect(screen.queryByText("Nom")).toBeNull();
    fireEvent.click(btn);
    expect(screen.getByRole("button", { name: "Replier" }).getAttribute("aria-expanded")).toBe("true");
    expect(screen.getByText("Nom")).toBeTruthy();
  });

  it("libellé de source", async () => {
    const mk = (source: RowHistoryItem["source"], extra: Partial<RowHistoryItem> = {}, i = 0) =>
      entry({ source, actor: null, ...extra }, `2026-11-${10 + i}T10:00:00.000Z`);
    fetchMock.mockReturnValue(
      json(
        page([
          mk("public_form", {}, 7),
          mk("sync", {}, 6),
          mk("relation_sync", {}, 5),
          mk("restore", {}, 4),
          mk("import", {}, 3),
          mk("system", {}, 2),
          mk("automation", { actorLabel: "Relance J+3" }, 1),
          mk("ai", {}, 8),
        ]),
      ),
    );
    mount();
    for (const label of [
      "Formulaire public",
      "Synchronisation",
      "Relation synchronisée",
      "Restauration",
      "Import",
      "Système",
      "Automatisme Relance J+3",
      "Assistant IA",
    ]) {
      expect(await screen.findByText(new RegExp(`^${label.replace("+", "\\+")}`))).toBeTruthy();
    }
  });

  it("écriture de l'assistant : acteur humain et source IA", async () => {
    fetchMock.mockReturnValue(json(page([entry({ source: "ai", actor: { id: "u1", name: "Ana" } })])));
    mount();
    expect(await screen.findByText(/Ana via Assistant IA a modifié Ville/)).toBeTruthy();
  });

  it("canClear faux : pas de bouton d'effacement", async () => {
    fetchMock.mockReturnValue(json(page([entry()])));
    mount();
    await screen.findByText(/Ana a modifié/);
    expect(screen.queryByRole("button", { name: "Effacer l'historique de la ligne" })).toBeNull();
  });

  it("canClear vrai : modale, Annuler ne supprime rien, Effacer appelle DELETE", async () => {
    fetchMock.mockImplementation((_url: string, init?: RequestInit) =>
      init?.method === "DELETE" ? json({ ok: true }) : json(page([entry()], { canClear: true })),
    );
    mount();
    const open = await screen.findByRole("button", { name: "Effacer l'historique de la ligne" });
    fireEvent.click(open);
    expect(await screen.findByText(/irréversible/)).toBeTruthy();
    fireEvent.click(screen.getByRole("button", { name: "Annuler" }));
    expect(fetchMock.mock.calls.some((c) => c[1]?.method === "DELETE")).toBe(false);

    fireEvent.click(await screen.findByRole("button", { name: "Effacer l'historique de la ligne" }));
    fireEvent.click(await screen.findByRole("button", { name: "Effacer" }));
    await waitFor(() => expect(fetchMock.mock.calls.some((c) => c[1]?.method === "DELETE")).toBe(true));
    await waitFor(() => expect(toast.success).toHaveBeenCalledWith("Historique effacé"));
    const gets = fetchMock.mock.calls.filter((c) => !c[1]?.method || c[1].method === "GET");
    expect(gets.length).toBeGreaterThanOrEqual(2);
  });

  it("effacement : appel DELETE sur la route history, toast de succès, rechargement", async () => {
    fetchMock.mockImplementation((_url: string, init?: RequestInit) =>
      init?.method === "DELETE" ? json({ erased: 2 }) : json(page([entry()], { canClear: true })),
    );
    mount();
    fireEvent.click(await screen.findByRole("button", { name: "Effacer l'historique de la ligne" }));
    fireEvent.click(await screen.findByRole("button", { name: "Effacer" }));
    await waitFor(() => expect(toast.success).toHaveBeenCalledWith("Historique effacé"));
    const del = fetchMock.mock.calls.find((c) => c[1]?.method === "DELETE");
    expect(del?.[0]).toBe("/api/databases/d1/rows/r1/history");
    expect(toast.error).not.toHaveBeenCalled();
    const gets = fetchMock.mock.calls.filter((c) => !c[1]?.method || c[1].method === "GET");
    expect(gets.length).toBeGreaterThanOrEqual(2);
  });

  it("effacement en échec : toast d'erreur, pas de toast de succès", async () => {
    fetchMock.mockImplementation((_url: string, init?: RequestInit) =>
      init?.method === "DELETE" ? json({ error: "Accès refusé" }, 403) : json(page([entry()], { canClear: true })),
    );
    mount();
    fireEvent.click(await screen.findByRole("button", { name: "Effacer l'historique de la ligne" }));
    fireEvent.click(await screen.findByRole("button", { name: "Effacer" }));
    await waitFor(() => expect(toast.error).toHaveBeenCalledWith("Impossible d'effacer l'historique"));
    expect(toast.success).not.toHaveBeenCalled();
  });

  it("pas de titre « Activité » dupliquant l'onglet ; la région reste nommée", async () => {
    fetchMock.mockReturnValue(json(page([entry()], { canClear: true })));
    mount();
    await screen.findByRole("button", { name: "Effacer l'historique de la ligne" });
    expect(screen.queryByRole("heading", { name: "Activité" })).toBeNull();
    expect(screen.getByRole("region", { name: "Activité" })).toBeTruthy();
  });

  it("l'info-bulle du bouton d'effacement apparaît au focus clavier", async () => {
    fetchMock.mockReturnValue(json(page([entry()], { canClear: true })));
    mount();
    const btn = await screen.findByRole("button", { name: "Effacer l'historique de la ligne" });
    fireEvent.focus(btn);
    await waitFor(() => expect(screen.getByText("Effacer l'historique de la ligne")).toBeTruthy());
  });

  it("appelle la route activity avec limit=20", async () => {
    fetchMock.mockReturnValue(json(page([entry()])));
    mount();
    await screen.findByText(/Ana a modifié/);
    expect(fetchMock.mock.calls[0][0]).toBe("/api/databases/d1/rows/r1/activity?limit=20");
  });

  it("une entrée de commentaire affiche le nom, le corps et la marque modifié", async () => {
    fetchMock.mockReturnValue(json(page([comment({ body: "Rappeler lundi", editedAt: "2026-11-14T11:30:00.000Z" })])));
    mount();
    expect(await screen.findByText("Rappeler lundi")).toBeTruthy();
    expect(screen.getByText("Ana")).toBeTruthy();
    expect(screen.getByText("(modifié)")).toBeTruthy();
  });

  it("libellé de mention forgé : le nom affiché est celui résolu pour l'identifiant, pas le libellé du corps", async () => {
    const id = "11111111-1111-4111-8111-111111111111";
    fetchMock.mockImplementation((url: string) =>
      String(url).includes("/api/users/search")
        ? json([{ id, name: "Bob Vrai", email: "b@x.fr", avatarUrl: null }])
        : json(page([comment({ body: `Salut @[Faux Nom](user:${id}) ok`, mentions: [id] })])),
    );
    mount();
    expect(await screen.findByText("@Bob Vrai")).toBeTruthy();
    expect(document.body.textContent).not.toContain("Faux Nom");
  });

  it("identifiant de mention non résolu : texte simple, aucun lien", async () => {
    const id = "22222222-2222-4222-8222-222222222222";
    fetchMock.mockReturnValue(json(page([comment({ body: `Voir @[Inconnu](user:${id})`, mentions: [] })])));
    mount();
    await screen.findByText(/Voir/);
    expect(document.querySelector("[data-mention]")).toBeNull();
    expect(screen.queryByRole("link")).toBeNull();
    expect(document.body.textContent).toContain("@Inconnu");
    expect(fetchMock.mock.calls.some((c) => String(c[0]).includes("/api/users/search"))).toBe(false);
  });

  it("commentaire supprimé : Commentaire supprimé sans texte", async () => {
    fetchMock.mockReturnValue(json(page([comment({ deleted: true, body: null, mentions: [] })])));
    mount();
    expect(await screen.findByText("Commentaire supprimé")).toBeTruthy();
    expect(document.body.textContent).not.toContain("Bonjour");
  });

  it("auteur nul : libellé Utilisateur supprimé", async () => {
    fetchMock.mockReturnValue(json(page([comment({ actor: null, body: "Orphelin" })])));
    mount();
    expect(await screen.findByText("Orphelin")).toBeTruthy();
    expect(screen.getByText("Utilisateur supprimé")).toBeTruthy();
  });

  it("événements de tâche : trois libellés avec le titre, et le lien appelle onOpenTask", async () => {
    const onOpenTask = vi.fn();
    fetchMock.mockReturnValue(
      json(
        page([
          taskEvent("task_created", { createdAt: "2026-11-14T12:03:00.000Z" }),
          taskEvent("task_completed", { createdAt: "2026-11-14T12:02:00.000Z" }),
          taskEvent("task_reopened", { createdAt: "2026-11-14T12:01:00.000Z", taskTitle: null }),
        ]),
      ),
    );
    mount(onOpenTask);
    expect(await screen.findByText(/a créé la tâche/)).toBeTruthy();
    expect(screen.getByText(/a terminé la tâche/)).toBeTruthy();
    expect(screen.getByText(/a rouvert la tâche/)).toBeTruthy();
    fireEvent.click(screen.getAllByRole("button", { name: "Ouvrir la tâche Appeler Acme" })[0]);
    expect(onOpenTask).toHaveBeenCalledWith("task-1");
    expect(screen.getByRole("button", { name: "Ouvrir la tâche Tâche sans titre" })).toBeTruthy();
  });

  it("sans onOpenTask : pas de bouton, le titre reste affiché", async () => {
    fetchMock.mockReturnValue(json(page([taskEvent("task_created")])));
    mount();
    expect(await screen.findByText(/Appeler Acme/)).toBeTruthy();
    expect(screen.queryByRole("button", { name: /Ouvrir la tâche/ })).toBeNull();
  });

  it("relation, personne et lien de document : libellés lisibles, jamais d'identifiant", async () => {
    const cols = [{ id: "rel", name: "Interactions", type: "relation", config: { targetDatabaseId: "t1" } }] as unknown as DbColumn[];
    const relationData = {
      t1: {
        columns: [{ id: "n", name: "Nom", type: "text" }] as unknown as DbColumn[],
        rows: [{ id: "row-aaaa", cells: { n: "Appel Acme" } }] as never,
      },
    };
    const changes = [
      { columnId: "rel", columnName: "Interactions", columnType: "relation", before: [], after: ["row-aaaa", "row-gone"] },
      { columnId: "p", columnName: "Responsable", columnType: "person", before: null, after: ["user-1"] },
      {
        columnId: "d",
        columnName: "Contrat",
        columnType: "document_link",
        before: null,
        after: '{"id":"doc-1","title":"Contrat cadre","spaceSlug":"s"}',
      },
    ];
    fetchMock.mockImplementation((url: string) =>
      String(url).includes("/api/users/search")
        ? json([{ id: "user-1", name: "Bob", email: "b@x.fr", avatarUrl: null }])
        : json(page([entry({ changes }, "2026-11-14T10:00:00.000Z")])),
    );
    renderWithIntl(<RowActivity databaseId="d1" rowId="r1" revision="{}" columns={cols} relationData={relationData} />);
    fireEvent.click(await screen.findByRole("button", { name: "Déplier" }));
    expect(await screen.findByText(/Appel Acme, 1 élément lié/)).toBeTruthy();
    expect(await screen.findByText("Bob")).toBeTruthy();
    expect(screen.getByText("Contrat cadre")).toBeTruthy();
    expect(document.body.textContent).not.toMatch(/row-aaaa|row-gone|user-1|doc-1/);
  });
});
