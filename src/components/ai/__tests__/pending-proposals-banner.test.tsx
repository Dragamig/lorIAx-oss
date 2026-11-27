// @vitest-environment jsdom
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react";

vi.mock("sonner", () => ({ toast: { success: vi.fn(), error: vi.fn() } }));

import { PendingProposalsBanner } from "../pending-proposals-banner";

const A = "11111111-1111-4111-8111-111111111111";
const B = "22222222-2222-4222-8222-222222222222";

function view(id: string, summary: string, status = "pending") {
  return {
    id, databaseId: "db", databaseName: "Demandes", type: "merge_duplicates", status, summary,
    rowCount: 1, conflictCount: 0, createdAt: "2026-11-21T10:00:00Z", expiresAt: "2026-11-22T10:00:00Z",
    canApply: true, columnNames: {}, rowLabels: {}, payload: { type: "merge_duplicates", keyColumnIds: [], relationColumnIds: [], groups: [] },
  };
}

let statusOverride: Record<string, string> = {};
let pending: ReturnType<typeof view>[];
let dismissed: Set<string>;

beforeEach(() => {
  dismissed = new Set();
  statusOverride = {};
  pending = [view(A, "Regrouper 2 doublons"), view(B, "Supprimer 3 lignes")];
  vi.stubGlobal("fetch", vi.fn(async (url: string, init?: { method?: string }) => {
    if (init?.method === "POST") {
      if (url.includes("/dismiss")) dismissed.add(url.includes(A) ? A : B);
      return { ok: true, json: async () => ({}) };
    }
    if (url.includes("status=open")) return { ok: true, json: async () => ({ proposals: pending }) };
    const id = decodeURIComponent(url.split("ids=")[1]);
    const found = pending.find((p) => p.id === id)!;
    return { ok: true, json: async () => ({ proposals: [{ ...found, status: dismissed.has(id) ? "dismissed" : (statusOverride[id] ?? found.status) }] }) };
  }));
});
afterEach(() => {
  cleanup();
  vi.unstubAllGlobals();
});

describe("PendingProposalsBanner", () => {
  it("liste les deux propositions en attente avec Appliquer et Ignorer", async () => {
    render(<PendingProposalsBanner />);
    expect(await screen.findByText("Regrouper 2 doublons")).toBeTruthy();
    expect(screen.getByText("Supprimer 3 lignes")).toBeTruthy();
    expect(screen.getAllByRole("button", { name: /^Appliquer/ })).toHaveLength(2);
    expect(screen.getAllByRole("button", { name: /^Ignorer/ })).toHaveLength(2);
  });

  it("n'affiche rien quand la liste est vide", async () => {
    pending = [];
    const { container } = render(<PendingProposalsBanner />);
    await waitFor(() => expect(screen.queryByText(/Chargement/)).toBeNull());
    expect(container.textContent).toBe("");
  });

  it("retire une carte après Ignorer", async () => {
    render(<PendingProposalsBanner />);
    await screen.findByText("Regrouper 2 doublons");
    fireEvent.click(screen.getByRole("button", { name: "Ignorer : Regrouper 2 doublons" }));
    await waitFor(() => expect(screen.queryByText("Regrouper 2 doublons")).toBeNull());
    expect(screen.getByText("Supprimer 3 lignes")).toBeTruthy();
  });

  it("masque les propositions déjà rendues en carte dans le fil (pas de doublon d'Appliquer)", async () => {
    render(<PendingProposalsBanner hiddenIds={[A]} />);
    await screen.findByText("Supprimer 3 lignes");
    expect(screen.queryByText("Regrouper 2 doublons")).toBeNull();
    expect(screen.getAllByRole("button", { name: /^Appliquer/ })).toHaveLength(1);
  });

  it("affiche une erreur discrète avec Réessayer", async () => {
    (fetch as ReturnType<typeof vi.fn>).mockResolvedValueOnce({ ok: false, json: async () => ({}) });
    render(<PendingProposalsBanner />);
    const retry = await screen.findByRole("button", { name: "Réessayer" });
    fireEvent.click(retry);
    expect(await screen.findByText("Regrouper 2 doublons")).toBeTruthy();
  });

  it("réduit et déplie la liste", async () => {
    render(<PendingProposalsBanner />);
    await screen.findByText("Regrouper 2 doublons");
    fireEvent.click(screen.getByRole("button", { name: "Réduire la liste" }));
    expect(screen.queryByText("Regrouper 2 doublons")).toBeNull();
    fireEvent.click(screen.getByRole("button", { name: "Afficher la liste" }));
    expect(screen.getByText("Regrouper 2 doublons")).toBeTruthy();
  });

  it("applique directement une proposition sans conflit", async () => {
    render(<PendingProposalsBanner />);
    await screen.findByText("Regrouper 2 doublons");
    fireEvent.click(screen.getByRole("button", { name: "Appliquer : Regrouper 2 doublons" }));
    await waitFor(() =>
      expect((fetch as ReturnType<typeof vi.fn>).mock.calls.some((c) => String(c[0]).endsWith("/apply"))).toBe(true),
    );
  });

  it("remplace Appliquer par Voir et appliquer quand il y a des conflits, et déplie la carte", async () => {
    pending = [{ ...view(A, "Regrouper 2 doublons"), conflictCount: 2 }];
    render(<PendingProposalsBanner />);
    await screen.findByText("Regrouper 2 doublons");
    expect(screen.queryByRole("button", { name: /^Appliquer :/ })).toBeNull();
    fireEvent.click(screen.getByRole("button", { name: "Voir et appliquer : Regrouper 2 doublons" }));
    expect(await screen.findByRole("button", { name: "Replier le détail" })).toBeTruthy();
    expect(screen.getAllByRole("button", { name: /Appliquer/ }).length).toBeGreaterThan(0);
  });

  it("sans droit d'édition et avec conflits : bouton secondaire Voir, pas Voir et appliquer", async () => {
    pending = [{ ...view(A, "Regrouper 2 doublons"), conflictCount: 2, canApply: false }];
    render(<PendingProposalsBanner />);
    await screen.findByText("Regrouper 2 doublons");
    expect(screen.queryByRole("button", { name: /Voir et appliquer/ })).toBeNull();
    const btn = screen.getByRole("button", { name: "Voir : Regrouper 2 doublons" });
    expect(btn.className).not.toContain("bg-primary");
    expect(btn.textContent).toBe("Voir");
  });

  it("garde une proposition périmée visible avec Recalculer", async () => {
    statusOverride = { [A]: "stale" };
    render(<PendingProposalsBanner />);
    expect(await screen.findByRole("button", { name: /Recalculer/ })).toBeTruthy();
  });
});
