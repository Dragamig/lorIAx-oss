// @vitest-environment jsdom
import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { cleanup, fireEvent, render, screen, waitFor, within } from "@testing-library/react";
import { NextIntlClientProvider } from "next-intl";
import fr from "../../../messages/fr.json";
import en from "../../../messages/en.json";
import { KanbanBoard } from "@/components/bases/kanban-board";
import { formatAmount } from "@/components/bases/kanban-lane-header";
import type { DbColumn, DbRow } from "@/components/editor/extensions/database-block/types";
import { renderWithIntl } from "./support/render-intl";

const apiPatch = vi.fn();
vi.mock("@/components/editor/extensions/database-block/api", () => ({
  apiPatch: (...a: unknown[]) => apiPatch(...a),
  apiPost: vi.fn(),
  apiDelete: vi.fn(),
  fetchJson: vi.fn(),
  ApiError: class extends Error {},
}));
vi.mock("sonner", () => {
  const fn = Object.assign(vi.fn(), { info: vi.fn(), success: vi.fn(), error: vi.fn() });
  return { toast: fn };
});
vi.mock("next/navigation", () => ({
  useSearchParams: () => new URLSearchParams(""),
  useRouter: () => ({ push: vi.fn(), replace: vi.fn(), refresh: vi.fn() }),
  usePathname: () => "/bases/d",
}));
vi.mock("@/components/editor/extensions/database-block/use-relation-data", () => ({ useRelationData: () => ({}) }));
vi.mock("@/components/bases/use-view-display-config", () => ({
  useViewDisplayConfig: () => ({ display: {}, changeDisplay: vi.fn() }),
}));

const columns = [
  { id: "t", name: "Nom", type: "text", config: {} },
  { id: "s", name: "Statut", type: "select", config: { options: ["A", "B", "C"] } },
  { id: "m", name: "Montant", type: "number", config: {} },
] as unknown as DbColumn[];
const mk = (id: string, name: string, s: string, m: unknown, pos: number) =>
  ({ id, databaseId: "d", cells: { t: name, s, m }, position: pos, createdAt: "", updatedAt: "" }) as unknown as DbRow;
const rows = [
  mk("r1", "un", "A", 1000, 0),
  mk("r2", "deux", "A", 500, 1),
  mk("r3", "trois", "B", null, 2),
  mk("r4", "quatre", "C", 2000, 3),
];
const totals = (o: Record<string, unknown> = {}) => ({
  amountColumnId: "m",
  closedLanes: [],
  weights: { A: 40, B: 10, C: 0 },
  showWeighted: false,
  ...o,
});

function board(kanbanTotals: unknown, extra: Record<string, unknown> = {}, r = rows) {
  const cfg = { groupByColumnId: "s", version: "v1", ...(kanbanTotals ? { kanbanTotals } : {}) };
  const el = (rs: DbRow[]) => (
    <KanbanBoard databaseId="d" spaceId="sp" viewId="v" viewConfig={cfg} columns={columns} rows={rs} onRefresh={vi.fn()} {...extra} />
  );
  return renderWithIntl(el(r));
}
const lane = (n: string) => screen.getByRole("region", { name: n });
const nbsp = (s: string) => s.replace(/[  ]/g, " ");

beforeEach(() => { apiPatch.mockReset(); apiPatch.mockResolvedValue({}); });
afterEach(cleanup);

describe("kanban : totaux par voie et bandeau", () => {
  it("sans kanbanTotals : aucun total ni bandeau, en-tête inchangé", () => {
    board(null);
    expect(screen.queryByTestId("kanban-totals-banner")).toBeNull();
    expect(screen.queryByTestId("kanban-lane-amount")).toBeNull();
    expect(screen.queryByTestId("kanban-card-unpriced")).toBeNull();
    expect(within(lane("A")).getByText("2")).toBeTruthy();
  });

  it("avec configuration : le montant de voie est formaté dans la devise de la config", () => {
    board(totals());
    expect(nbsp(within(lane("A")).getByTestId("kanban-lane-amount").textContent!)).toBe("1 500 €");
  });

  it("devise USD et locale en : format localisé", () => {
    expect(formatAmount(1500, "USD", "en")).toBe("$1,500");
    expect(formatAmount(Number.NaN, "EUR", "fr")).not.toContain("NaN");
    render(
      <NextIntlClientProvider locale="en" messages={en}>
        <KanbanBoard databaseId="d" spaceId="sp" viewId="v" viewConfig={{ groupByColumnId: "s", kanbanTotals: totals({ currency: "USD" }) }} columns={columns} rows={rows} onRefresh={vi.fn()} />
      </NextIntlClientProvider>,
    );
    expect(within(lane("A")).getByTestId("kanban-lane-amount").textContent).toBe("$1,500");
  });

  it("showWeighted faux : aucune ligne Pondéré", () => {
    board(totals());
    expect(screen.queryByText(/Pondéré/)).toBeNull();
  });

  it("showWeighted vrai : ligne Pondéré (40 %)", () => {
    board(totals({ showWeighted: true }));
    expect(nbsp(within(lane("A")).getByTestId("kanban-lane-weighted").textContent!)).toBe("Pondéré (40 %) : 600 €");
  });

  it("voie close : atténuée avec la mention Close, exclue du bandeau en cours", () => {
    board(totals({ closedLanes: ["C"] }));
    const head = within(lane("C")).getByTestId("kanban-lane-header");
    expect(head.getAttribute("data-closed")).toBe("true");
    expect(within(head).getByText("Close")).toBeTruthy();
    expect(within(lane("A")).queryByText("Close")).toBeNull();
    // ouvert : A (2) + B (1) = 3 cartes, 1 500 €
    expect(nbsp(screen.getByTestId("kanban-totals-banner").textContent!)).toContain("1 500 € en cours");
  });

  it("carte sans montant : Non chiffré", () => {
    board(totals());
    expect(within(lane("B")).getByText("Non chiffré")).toBeTruthy();
    expect(within(lane("A")).queryByText("Non chiffré")).toBeNull();
  });

  it("bandeau : N dossiers, M ouverts, X en cours, sans mention partiel", () => {
    board(totals({ showWeighted: true }));
    const text = nbsp(screen.getByRole("status").textContent!);
    expect(text).toContain("4 dossiers, 4 ouverts, 3 500 € en cours, 600 € pondérés");
    expect(text).not.toContain("partiel");
  });

  it("la colonne de montant n'est pas répétée en ligne de détail sur la carte", () => {
    board(totals());
    expect(screen.queryByText("Montant :")).toBeNull();
    expect(within(lane("A")).getAllByTestId("kanban-card-amount")).toHaveLength(2);
  });

  it("un filtre change le total du bandeau", () => {
    board(totals({ showWeighted: true }), {}, rows);
    expect(nbsp(screen.getByRole("status").textContent!)).toContain("3 500 € en cours");
    cleanup();
    const cfg = { groupByColumnId: "s", version: "v1", kanbanTotals: totals(), filters: { id: "g", type: "group", conjunction: "and", children: [{ id: "c1", columnId: "s", operator: "is", value: "A" }] } };
    renderWithIntl(<KanbanBoard databaseId="d" spaceId="sp" viewId="v" viewConfig={cfg} columns={columns} rows={rows} onRefresh={vi.fn()} />);
    const text = nbsp(screen.getByRole("status").textContent!);
    expect(text).toContain("2 dossiers, 2 ouverts, 1 500 € en cours");
  });

  it("le singulier est correct (1 dossier)", () => {
    board(totals(), {}, [rows[0]]);
    expect(screen.getByRole("status").textContent).toContain("1 dossier,");
    expect(screen.getByRole("status").textContent).not.toContain("dossiers");
  });

  it("colonne de montant supprimée : aucun total, aucune exception", () => {
    board(totals({ amountColumnId: "zzz" }));
    expect(screen.queryByTestId("kanban-totals-banner")).toBeNull();
    expect(screen.queryByTestId("kanban-lane-amount")).toBeNull();
  });

  it("déplacer une carte met à jour les deux voies et le bandeau sans rechargement", async () => {
    board(totals());
    const card = within(lane("A")).getAllByRole("article")[0];
    const store: Record<string, string> = {};
    const dt = { setData: (k: string, v: string) => { store[k] = v; }, getData: (k: string) => store[k], effectAllowed: "" };
    fireEvent.dragStart(card, { dataTransfer: dt });
    fireEvent.drop(lane("C"), { dataTransfer: dt });
    await waitFor(() => expect(nbsp(within(lane("C")).getByTestId("kanban-lane-amount").textContent!)).toBe("3 000 €"));
    expect(nbsp(within(lane("A")).getByTestId("kanban-lane-amount").textContent!)).toBe("500 €");
  });

  it("toutes les voies ont la même structure d'en-tête (hauteur fixe) quel que soit le texte", () => {
    board(totals({ showWeighted: true, closedLanes: ["B"] }));
    const foots = screen.getAllByTestId("kanban-lane-foot");
    expect(foots).toHaveLength(4);
    for (const f of foots) expect(f.className).toBe(foots[0].className);
    const weighted = screen.getAllByTestId("kanban-lane-weighted");
    expect(weighted).toHaveLength(4);
    for (const w of weighted) expect(w.className).toBe(weighted[0].className);
  });

  it("chiffres tabulaires (classe tabular-nums)", () => {
    board(totals({ showWeighted: true }));
    expect(screen.getAllByTestId("kanban-lane-amount")[0].className).toContain("tabular-nums");
    expect(screen.getByRole("status").className).toContain("tabular-nums");
  });

  it("montants limites : jamais de NaN affiché", () => {
    const bad = [mk("a", "a", "A", "abc", 0), mk("b", "b", "A", Number.POSITIVE_INFINITY, 1), mk("c", "c", "A", -50, 2), mk("d", "d", "A", 1e21, 3)];
    board(totals({ showWeighted: true }), {}, bad);
    const shown = [...screen.getAllByTestId("kanban-lane-amount"), ...screen.getAllByTestId("kanban-lane-weighted"), screen.getByRole("status")].map((e) => e.textContent).join(" ");
    expect(shown).not.toMatch(/NaN|Infinity/);
  });
});

describe("kanban : menu Totaux branché", () => {
  it("choisir une colonne dans le menu affiche tout de suite le bandeau et envoie le PATCH entier", async () => {
    board(null);
    expect(screen.queryByTestId("kanban-lane-amount")).toBeNull();
    fireEvent.click(screen.getByRole("button", { name: "Totaux" }));
    fireEvent.change(await screen.findByLabelText("Colonne montant"), { target: { value: "m" } });
    await waitFor(() => expect(screen.getAllByTestId("kanban-lane-amount").length).toBe(4));
    expect(apiPatch).toHaveBeenCalledWith("/api/databases/d/views/v", {
      config: { kanbanTotals: { amountColumnId: "m", closedLanes: [], weights: {}, showWeighted: false } },
    });
  });

  it("Désactiver les totaux retire les montants des voies", async () => {
    board(totals());
    fireEvent.click(screen.getByRole("button", { name: "Totaux" }));
    fireEvent.click(await screen.findByRole("button", { name: "Désactiver les totaux" }));
    await waitFor(() => expect(screen.queryByTestId("kanban-lane-amount")).toBeNull());
    expect(apiPatch).toHaveBeenCalledWith("/api/databases/d/views/v", { config: { kanbanTotals: null } });
  });

  it("colonne supprimée : aucun total, message dans le menu", async () => {
    board(totals({ amountColumnId: "gone" }));
    expect(screen.queryByTestId("kanban-lane-amount")).toBeNull();
    fireEvent.click(screen.getByRole("button", { name: "Totaux" }));
    expect(await screen.findByText(fr.basesTotals.inactiveMissingColumn)).toBeTruthy();
  });
});

