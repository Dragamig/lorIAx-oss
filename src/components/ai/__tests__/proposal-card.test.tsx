// @vitest-environment jsdom
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react";

const toastMock = vi.hoisted(() => ({
  success: vi.fn(),
  error: vi.fn(),
}));
vi.mock("sonner", () => ({ toast: toastMock }));

import { ProposalCard } from "../proposal-card";

const ID = "11111111-1111-4111-8111-111111111111";

function mergeProposal(over: Record<string, unknown> = {}) {
  const row = (id: string, tel: string) => ({ id, cells: { email: "a@b.fr", tel }, position: 0 });
  return {
    id: ID,
    databaseId: "db1",
    databaseName: "Demandes",
    type: "merge_duplicates",
    status: "pending",
    summary: "Regrouper 1 groupe de doublons, 1 ligne à retirer, 1 conflit pré-tranché",
    rowCount: 1,
    conflictCount: 1,
    createdAt: "2026-11-21T10:00:00Z",
    expiresAt: "2026-11-22T10:00:00Z",
    canApply: true,
    columnNames: { email: "Email", tel: "Téléphone" },
    rowLabels: { keep00001: "a@b.fr", drop00001: "a@b.fr" },
    payload: {
      type: "merge_duplicates",
      keyColumnIds: ["email"],
      relationColumnIds: [],
      groups: [
        {
          groupId: "g1",
          keepRowId: "keep00001",
          removeRowIds: ["drop00001"],
          mergedCells: {},
          keepBefore: {},
          keepRow: row("keep00001", "0612"),
          removedRows: [row("drop00001", "0621")],
          conflicts: [
            {
              columnId: "tel",
              chosenFrom: "keep00001",
              candidates: [
                { rowId: "keep00001", value: "0612" },
                { rowId: "drop00001", value: "0621" },
              ],
            },
          ],
          repatriation: { relationCells: 2, attachments: 1, repointed: [] },
        },
      ],
    },
    ...over,
  };
}

type Call = { url: string; method: string; body?: string };
let calls: Call[];
let current: ReturnType<typeof mergeProposal>;
let postResponses: Record<string, { status: number; body: unknown }>;
let afterPost: Record<string, string>;

beforeEach(() => {
  calls = [];
  current = mergeProposal();
  postResponses = {};
  afterPost = {};
  toastMock.success.mockClear();
  toastMock.error.mockClear();
  vi.stubGlobal(
    "fetch",
    vi.fn(async (url: string, init?: RequestInit) => {
      const method = init?.method ?? "GET";
      calls.push({ url, method, body: init?.body as string | undefined });
      const json = (status: number, body: unknown) =>
        ({ ok: status >= 200 && status < 300, status, json: async () => body }) as Response;
      if (method === "GET") return json(200, { proposals: [current] });
      const action = url.split("/").pop()!;
      const r = postResponses[action] ?? { status: 200, body: { status: action } };
      if (afterPost[action]) current = { ...current, status: afterPost[action] } as typeof current;
      return json(r.status, r.body);
    }),
  );
  vi.stubGlobal("alert", vi.fn());
  vi.stubGlobal("confirm", vi.fn());
});

afterEach(() => {
  cleanup();
  vi.unstubAllGlobals();
});

async function ready() {
  render(<ProposalCard proposalId={ID} />);
  await screen.findByRole("heading", { level: 3 });
}

describe("ProposalCard : états", () => {
  it("chargement puis en attente avec volume, conflits et annonce de rapatriement", async () => {
    render(<ProposalCard proposalId={ID} />);
    expect(screen.getByRole("status", { name: "Chargement de la proposition" })).toBeTruthy();
    await screen.findByText("En attente");
    expect(screen.getByRole("heading", { level: 3 }).textContent).toBe("Fusionner 1 groupe de doublons");
    expect(screen.getByText(/Relations et pièces jointes rapatriées : 2 relation/)).toBeTruthy();
    expect(screen.getByRole("button", { name: "Appliquer" }).hasAttribute("disabled")).toBe(false);
    expect(screen.getByRole("button", { name: "Ignorer" })).toBeTruthy();
  });

  it("erreur de chargement avec Réessayer", async () => {
    vi.stubGlobal("fetch", vi.fn(async () => ({ ok: false, status: 500, json: async () => ({}) }) as Response));
    render(<ProposalCard proposalId={ID} />);
    expect((await screen.findByRole("alert")).textContent).toMatch(/illisible ou introuvable/);
    expect(screen.getByRole("button", { name: "Réessayer" })).toBeTruthy();
  });

  it("application en cours : badge, boutons désactivés", async () => {
    current = mergeProposal({ status: "applying" });
    render(<ProposalCard proposalId={ID} />);
    expect((await screen.findAllByText("Application en cours")).length).toBeGreaterThan(0);
    expect(screen.getByRole("button", { name: "Application..." }).getAttribute("aria-disabled")).toBe("true");
    expect(screen.getByRole("button", { name: "Ignorer" }).getAttribute("aria-disabled")).toBe("true");
  });

  it("appliquée : résumé et bouton d'annulation", async () => {
    current = mergeProposal({ status: "applied" });
    render(<ProposalCard proposalId={ID} />);
    expect((await screen.findByText(/Proposition appliquée sur la base Demandes/)).closest("[role=status]")).toBeTruthy();
    expect(screen.getByRole("button", { name: "Annuler la fusion" })).toBeTruthy();
  });

  it("annulée : message de restauration, aucune action d'écriture", async () => {
    current = mergeProposal({ status: "undone" });
    render(<ProposalCard proposalId={ID} />);
    expect(await screen.findByText(/les lignes d'origine sont restaurées/)).toBeTruthy();
    expect(screen.queryByRole("button", { name: "Appliquer" })).toBeNull();
    expect(screen.queryByRole("button", { name: /Annuler/ })).toBeNull();
  });

  it("ignorée : grisée et sans action", async () => {
    current = mergeProposal({ status: "dismissed" });
    render(<ProposalCard proposalId={ID} />);
    expect(await screen.findByText(/Proposition ignorée, aucune ligne modifiée/)).toBeTruthy();
    expect(screen.queryByRole("button", { name: "Appliquer" })).toBeNull();
    expect(screen.queryByRole("button", { name: "Recalculer" })).toBeNull();
    expect(document.querySelector("section")!.className).toContain("opacity-60");
  });

  it("périmée : message et Recalculer", async () => {
    current = mergeProposal({ status: "stale" });
    render(<ProposalCard proposalId={ID} />);
    expect((await screen.findByRole("alert")).textContent).toMatch(/Base modifiée depuis la proposition/);
    expect(screen.getByRole("button", { name: "Recalculer" })).toBeTruthy();
  });

  it("expirée : message, sans action", async () => {
    current = mergeProposal({ status: "expired" });
    render(<ProposalCard proposalId={ID} />);
    expect(await screen.findByText(/Proposition expirée, rien n'a été modifié/)).toBeTruthy();
    expect(screen.queryByRole("button", { name: "Appliquer" })).toBeNull();
  });

  it("échec : alerte avec le message du serveur", async () => {
    current = mergeProposal();
    postResponses.apply = { status: 422, body: { code: "failed", error: "Ligne verrouillée" } };
    afterPost.apply = "failed";
    await ready();
    fireEvent.click(screen.getByRole("button", { name: "Appliquer" }));
    expect((await screen.findByRole("alert")).textContent).toMatch(/L'application a échoué : Ligne verrouillée/);
    expect(toastMock.error).toHaveBeenCalledWith("Ligne verrouillée");
  });
});

describe("ProposalCard : actions", () => {
  it("droits insuffisants : Appliquer désactivé avec l'info-bulle explicative", async () => {
    current = mergeProposal({ canApply: false });
    render(<ProposalCard proposalId={ID} />);
    const btn = await screen.findByRole("button", { name: /Appliquer, indisponible/ });
    expect(btn.getAttribute("aria-disabled")).toBe("true");
    const tips = screen.getAllByRole("tooltip", { hidden: true }).map((t) => t.textContent);
    expect(tips).toContain("Droit d'édition requis sur cette base");
  });

  it("une fusion avec conflits garde Appliquer actif et applique sans override", async () => {
    afterPost.apply = "applied";
    await ready();
    const apply = screen.getByRole("button", { name: "Appliquer" });
    expect(apply.hasAttribute("disabled")).toBe(false);
    fireEvent.click(apply);
    await waitFor(() => expect(calls.some((c) => c.method === "POST" && c.url.endsWith("/apply"))).toBe(true));
    const post = calls.find((c) => c.url.endsWith("/apply"))!;
    expect(post.body).toBeUndefined();
  });

  it("modifier un sélecteur de conflit envoie overrides pour le seul champ modifié", async () => {
    afterPost.apply = "applied";
    await ready();
    fireEvent.click(screen.getByRole("button", { name: "Voir le détail de la proposition" }));
    const sel = screen.getByRole("combobox", { name: "Valeur retenue pour Téléphone, groupe 1" }) as HTMLSelectElement;
    expect(sel.value).toBe("keep00001");
    fireEvent.change(sel, { target: { value: "drop00001" } });
    expect(toastMock.success).toHaveBeenCalledWith("Valeur retenue : 0621");
    fireEvent.click(screen.getByRole("button", { name: "Appliquer" }));
    await waitFor(() => expect(calls.some((c) => c.url.endsWith("/apply"))).toBe(true));
    expect(JSON.parse(calls.find((c) => c.url.endsWith("/apply"))!.body!)).toEqual({
      overrides: { g1: { tel: "drop00001" } },
    });
  });

  it("le détail affiche les noms de colonnes et les libellés de lignes", async () => {
    await ready();
    fireEvent.click(screen.getByRole("button", { name: "Voir le détail de la proposition" }));
    expect(screen.getByText("Téléphone")).toBeTruthy();
    expect(screen.getByText(/Clé \(Email\)/)).toBeTruthy();
    expect(screen.getAllByText("a@b.fr").length).toBeGreaterThanOrEqual(2);
    expect(screen.queryByText("keep0000")).toBeNull();
  });

  it("remettre la valeur pré-tranchée n'envoie aucun override", async () => {
    afterPost.apply = "applied";
    await ready();
    fireEvent.click(screen.getByRole("button", { name: "Voir le détail de la proposition" }));
    const sel = screen.getByRole("combobox", { name: /Valeur retenue pour Téléphone/ });
    fireEvent.change(sel, { target: { value: "drop00001" } });
    fireEvent.change(sel, { target: { value: "keep00001" } });
    fireEvent.click(screen.getByRole("button", { name: "Appliquer" }));
    await waitFor(() => expect(calls.some((c) => c.url.endsWith("/apply"))).toBe(true));
    expect(calls.find((c) => c.url.endsWith("/apply"))!.body).toBeUndefined();
  });

  it("Appliquer déclenche un toast avec action Annuler qui appelle undo", async () => {
    afterPost.apply = "applied";
    await ready();
    fireEvent.click(screen.getByRole("button", { name: "Appliquer" }));
    await waitFor(() => expect(toastMock.success).toHaveBeenCalledWith("Proposition appliquée", expect.anything()));
    const opts = toastMock.success.mock.calls.find((c) => c[0] === "Proposition appliquée")![1];
    expect(opts.action.label).toBe("Annuler");
    afterPost.undo = "undone";
    opts.action.onClick();
    await waitFor(() => expect(calls.some((c) => c.url.endsWith("/undo") && c.method === "POST")).toBe(true));
    await screen.findByText(/les lignes d'origine sont restaurées/);
  });

  it("en échec : Recalculer et Ignorer proposés, avec noms accessibles", async () => {
    current = mergeProposal({ status: "failed" });
    postResponses.dismiss = { status: 200, body: { status: "dismissed" } };
    afterPost.dismiss = "dismissed";
    render(<ProposalCard proposalId={ID} />);
    expect(await screen.findByRole("button", { name: "Recalculer la proposition échouée" })).toBeTruthy();
    fireEvent.click(screen.getByRole("button", { name: "Ignorer la proposition échouée" }));
    await waitFor(() => expect(calls.some((c) => c.url.endsWith("/dismiss") && c.method === "POST")).toBe(true));
  });

  it("en périmé, Recalculer appelle recompute et affiche la nouvelle proposition", async () => {
    current = mergeProposal({ status: "stale" });
    const NEW_ID = "22222222-2222-4222-8222-222222222222";
    const fresh = mergeProposal({ id: NEW_ID, summary: "Regrouper 2 groupes de doublons" });
    postResponses.recompute = { status: 200, body: { proposal: fresh } };
    render(<ProposalCard proposalId={ID} />);
    await screen.findByRole("button", { name: "Recalculer" });
    // Le serveur ne sert plus que la nouvelle proposition : relire l'ancien id échouerait.
    current = fresh;
    fireEvent.click(screen.getByRole("button", { name: "Recalculer" }));
    await waitFor(() => expect(calls.some((c) => c.url.endsWith("/recompute"))).toBe(true));
    await screen.findByText("En attente");
    expect(screen.getByRole("heading", { level: 3 }).textContent).toBe("Fusionner 1 groupe de doublons");
    const afterRecompute = calls.filter((c) => c.method === "GET").map((c) => c.url);
    expect(afterRecompute.at(-1)).toContain(NEW_ID);
    fireEvent.click(screen.getByRole("button", { name: "Appliquer" }));
    await waitFor(() => expect(calls.some((c) => c.url.includes(`${NEW_ID}/apply`))).toBe(true));
    expect(toastMock.success).toHaveBeenCalledWith("Proposition recalculée sur la base actuelle");
  });

  it("Ignorer appelle dismiss et affiche l'état ignoré", async () => {
    afterPost.dismiss = "dismissed";
    await ready();
    fireEvent.click(screen.getByRole("button", { name: "Ignorer" }));
    await screen.findByText(/Proposition ignorée, aucune ligne modifiée/);
    expect(calls.some((c) => c.url.endsWith("/dismiss"))).toBe(true);
  });

  it("un refus 409 de l'apply relit l'état serveur (périmé) et notifie l'erreur", async () => {
    postResponses.apply = { status: 409, body: { code: "stale", error: "La base a changé" } };
    afterPost.apply = "stale";
    await ready();
    fireEvent.click(screen.getByRole("button", { name: "Appliquer" }));
    await screen.findByRole("button", { name: "Recalculer" });
    expect(toastMock.error).toHaveBeenCalledWith("La base a changé");
  });

  it("chaque bouton a un aria-label non vide et une info-bulle, sans alert ni confirm natifs", async () => {
    await ready();
    fireEvent.click(screen.getByRole("button", { name: "Voir le détail de la proposition" }));
    const buttons = screen.getAllByRole("button");
    expect(buttons.length).toBeGreaterThanOrEqual(3);
    for (const b of buttons) {
      expect((b.getAttribute("aria-label") ?? "").length).toBeGreaterThan(0);
      expect(b.getAttribute("aria-describedby")).toBeTruthy();
    }
    fireEvent.click(screen.getByRole("button", { name: "Appliquer" }));
    await waitFor(() => expect(calls.some((c) => c.url.endsWith("/apply"))).toBe(true));
    expect(window.alert).not.toHaveBeenCalled();
    expect(window.confirm).not.toHaveBeenCalled();
  });
});
