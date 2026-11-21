// @vitest-environment jsdom
import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { act, cleanup, fireEvent, render, renderHook, screen, waitFor, within } from "@testing-library/react";
import { NextIntlClientProvider } from "next-intl";
import fr from "../../../messages/fr.json";
import { KanbanBoard } from "@/components/bases/kanban-board";
import { KanbanFilterBar } from "@/components/bases/kanban-filter-bar";
import { useKanbanFilterSort } from "@/components/bases/use-kanban-filter-sort";
import type { SortConfig } from "@/components/editor/extensions/database-block/types";
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

const toastError = vi.fn();
vi.mock("sonner", () => {
  const fn = Object.assign(vi.fn(), { info: vi.fn(), success: vi.fn(), error: (...a: unknown[]) => toastError(...a) });
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

const ME = "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa";
const OTHER = "bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb";

const columns = [
  { id: "t", name: "Nom", type: "text", config: {} },
  { id: "s", name: "Statut", type: "select", config: { options: ["A", "B", "C"] } },
  { id: "p", name: "Responsable", type: "person", config: {} },
] as unknown as DbColumn[];
const mk = (id: string, name: string, s: string, p: string[], pos: number) =>
  ({ id, databaseId: "d", cells: { t: name, s, p }, position: pos, createdAt: "", updatedAt: "" }) as unknown as DbRow;
const rows = [
  mk("r1", "zeta", "A", [ME], 0),
  mk("r2", "alpha", "A", [OTHER], 1),
  mk("r3", "beta", "B", [OTHER], 2),
];

const cond = (columnId: string, operator: string, value: string) => ({
  id: "g",
  type: "group",
  conjunction: "and",
  children: [{ id: "c1", columnId, operator, value }],
});

function board(viewConfig: Record<string, unknown> = {}, extra: Record<string, unknown> = {}) {
  return renderWithIntl(
    <KanbanBoard
      databaseId="d"
      spaceId="sp"
      viewId="v"
      viewConfig={{ groupByColumnId: "s", version: "v1", ...viewConfig }}
      columns={columns}
      rows={rows}
      onRefresh={vi.fn()}
      {...extra}
    />,
  );
}
const lane = (name: string) => screen.getByRole("region", { name });

beforeEach(() => {
  apiPatch.mockReset();
  apiPatch.mockResolvedValue({});
  toastError.mockReset();
});
afterEach(() => {
  cleanup();
  vi.useRealTimers();
});

describe("kanban : filtres et tri de la vue", () => {
  it("les lignes ne passant pas le filtre sont absentes des voies", () => {
    board({ filters: cond("t", "contains", "alpha") });
    expect(within(lane("A")).queryByText("zeta")).toBeNull();
    expect(within(lane("A")).getByText("alpha")).toBeTruthy();
    expect(screen.queryByText("beta")).toBeNull();
  });

  it("le compteur de chaque voie est celui des cartes filtrées", () => {
    board({ filters: cond("t", "contains", "al") });
    expect(within(lane("A")).getByText("1")).toBeTruthy();
    expect(within(lane("B")).getByText("0")).toBeTruthy();
  });

  it("une voie vide après filtre reste affichée avec son libellé vide", () => {
    board({ filters: cond("t", "contains", "alpha") });
    expect(within(lane("B")).getByText("Aucune carte")).toBeTruthy();
    expect(within(lane("C")).getByText("Aucune carte")).toBeTruthy();
  });

  it("le tri s'applique à l'intérieur de chaque voie", () => {
    board({ sorts: [{ columnId: "t", direction: "asc" }] });
    const titles = within(lane("A")).getAllByRole("article").map((a) => a.textContent);
    expect(titles[0]).toContain("alpha");
    expect(titles[1]).toContain("zeta");
  });

  it("un filtre is_me avec viewerId ne garde que les cartes de l'utilisateur", () => {
    board({ filters: cond("p", "is_me", "") }, { viewerId: ME });
    expect(screen.getByText("zeta")).toBeTruthy();
    expect(screen.queryByText("alpha")).toBeNull();
    expect(screen.queryByText("beta")).toBeNull();
  });

  it("une vue kanban portant des filtres enregistrés les applique au premier rendu", () => {
    board({ filters: cond("s", "is", "B") });
    expect(screen.queryByText("zeta")).toBeNull();
    expect(screen.getByText("beta")).toBeTruthy();
    expect(screen.getByTestId("kanban-filter-count").textContent).toBe("1");
  });
});

const wrapper = ({ children }: { children: React.ReactNode }) => (
  <NextIntlClientProvider locale="fr" messages={fr}>
    {children}
  </NextIntlClientProvider>
);
const hook = (viewConfig: Record<string, unknown> = {}) =>
  renderHook(() => useKanbanFilterSort({ databaseId: "d", viewId: "v", viewConfig, viewerId: ME }), { wrapper });

describe("useKanbanFilterSort : persistance", () => {
  it("modifier un filtre déclenche un seul PATCH {config: {sorts, filters}} après le debounce", async () => {
    vi.useFakeTimers();
    const h = hook();
    expect(apiPatch).not.toHaveBeenCalled();
    act(() => h.result.current.setSorts([{ columnId: "t", direction: "asc" }]));
    act(() => h.result.current.setSorts([{ columnId: "t", direction: "desc" }]));
    await act(async () => { await vi.advanceTimersByTimeAsync(499); });
    expect(apiPatch).not.toHaveBeenCalled();
    await act(async () => { await vi.advanceTimersByTimeAsync(2); });
    expect(apiPatch).toHaveBeenCalledTimes(1);
    const [url, body] = apiPatch.mock.calls[0] as [string, { config: Record<string, unknown> }];
    expect(url).toBe("/api/databases/d/views/v");
    expect(Object.keys(body.config).sort()).toEqual(["filters", "sorts"]);
    expect(body.config.sorts).toEqual([{ columnId: "t", direction: "desc" }]);
  });

  it("échec du PATCH : retour à l'état confirmé, toast d'erreur avec Réessayer", async () => {
    vi.useFakeTimers();
    apiPatch.mockRejectedValueOnce(new Error("boom"));
    const h = hook({ sorts: [{ columnId: "s", direction: "asc" }] });
    act(() => h.result.current.setSorts([{ columnId: "t", direction: "asc" }]));
    await act(async () => { await vi.advanceTimersByTimeAsync(600); });
    expect(h.result.current.sorts).toEqual([{ columnId: "s", direction: "asc" }]);
    expect(h.result.current.saveError).toBe(true);
    expect(toastError).toHaveBeenCalledTimes(1);
    const opts = toastError.mock.calls[0][1] as { action: { label: string; onClick: () => void } };
    expect(opts.action.label).toBe("Réessayer");
    act(() => opts.action.onClick());
    expect(h.result.current.sorts).toEqual([{ columnId: "t", direction: "asc" }]);
    await act(async () => { await vi.advanceTimersByTimeAsync(600); });
    expect(apiPatch).toHaveBeenCalledTimes(2);
    expect(h.result.current.saveError).toBe(false);
  });

  it("course : A acquitté puis B en échec revient à A, pas à l'état d'avant A", async () => {
    vi.useFakeTimers();
    let resolveA: () => void = () => {};
    let rejectB: (e: Error) => void = () => {};
    apiPatch
      .mockImplementationOnce(() => new Promise<void>((r) => { resolveA = r; }))
      .mockImplementationOnce(() => new Promise<void>((_, rej) => { rejectB = rej; }));
    const h = hook({ sorts: [{ columnId: "s", direction: "asc" }] });
    const A = [{ columnId: "t", direction: "asc" }] as SortConfig[];
    const B = [{ columnId: "t", direction: "desc" }] as SortConfig[];
    act(() => h.result.current.setSorts(A));
    await act(async () => { await vi.advanceTimersByTimeAsync(600); });
    act(() => h.result.current.setSorts(B));
    await act(async () => { await vi.advanceTimersByTimeAsync(600); });
    await act(async () => { resolveA(); await Promise.resolve(); });
    await act(async () => { rejectB(new Error("boom")); await Promise.resolve(); });
    expect(h.result.current.sorts).toEqual(A);
  });

  it("A en vol, B et C : un seul PATCH en vol, puis un seul envoi portant C", async () => {
    vi.useFakeTimers();
    let resolveA: () => void = () => {};
    let resolveC: () => void = () => {};
    apiPatch
      .mockImplementationOnce(() => new Promise<void>((r) => { resolveA = r; }))
      .mockImplementationOnce(() => new Promise<void>((r) => { resolveC = r; }));
    const h = hook();
    const mkS = (d: "asc" | "desc", c = "t") => [{ columnId: c, direction: d }] as SortConfig[];
    const A = mkS("asc");
    const C = mkS("desc", "s");
    act(() => h.result.current.setSorts(A));
    await act(async () => { await vi.advanceTimersByTimeAsync(600); });
    act(() => h.result.current.setSorts(mkS("desc")));
    await act(async () => { await vi.advanceTimersByTimeAsync(600); });
    act(() => h.result.current.setSorts(C));
    await act(async () => { await vi.advanceTimersByTimeAsync(600); });
    expect(apiPatch).toHaveBeenCalledTimes(1);
    await act(async () => { resolveA(); await Promise.resolve(); await Promise.resolve(); });
    expect(apiPatch).toHaveBeenCalledTimes(2);
    expect((apiPatch.mock.calls[1][1] as { config: { sorts: unknown } }).config.sorts).toEqual(C);
    await act(async () => { resolveC(); await Promise.resolve(); await Promise.resolve(); });
    expect(apiPatch).toHaveBeenCalledTimes(2);
    expect(h.result.current.sorts).toEqual(C);
    expect(h.result.current.saveError).toBe(false);
  });

  it("l'échec de la requête fusionnée revient à A (acquitté)", async () => {
    vi.useFakeTimers();
    let resolveA: () => void = () => {};
    let rejectC: (e: Error) => void = () => {};
    apiPatch
      .mockImplementationOnce(() => new Promise<void>((r) => { resolveA = r; }))
      .mockImplementationOnce(() => new Promise<void>((_, rej) => { rejectC = rej; }));
    const h = hook({ sorts: [{ columnId: "s", direction: "asc" }] });
    const A = [{ columnId: "t", direction: "asc" }] as SortConfig[];
    act(() => h.result.current.setSorts(A));
    await act(async () => { await vi.advanceTimersByTimeAsync(600); });
    act(() => h.result.current.setSorts([{ columnId: "t", direction: "desc" }]));
    await act(async () => { await vi.advanceTimersByTimeAsync(600); });
    act(() => h.result.current.setSorts([{ columnId: "s", direction: "desc" }]));
    await act(async () => { await vi.advanceTimersByTimeAsync(600); });
    await act(async () => { resolveA(); await Promise.resolve(); await Promise.resolve(); });
    await act(async () => { rejectC(new Error("boom")); await Promise.resolve(); await Promise.resolve(); });
    expect(h.result.current.sorts).toEqual(A);
    expect(h.result.current.saveError).toBe(true);
  });

  it("le contexte porte l'utilisateur, le fuseau et l'instant", () => {
    const h = hook();
    expect(h.result.current.ctx.userId).toBe(ME);
    expect(h.result.current.ctx.tz).toBe(Intl.DateTimeFormat().resolvedOptions().timeZone);
    expect(h.result.current.ctx.now).toBeInstanceOf(Date);
  });
});

function Bar({ readOnly }: { readOnly: boolean }) {
  const filter = useKanbanFilterSort({ databaseId: "d", viewId: "v", viewConfig: {}, viewerId: ME });
  return <KanbanFilterBar columns={columns} filter={filter} readOnly={readOnly} />;
}
const bar = (readOnly: boolean) =>
  render(
    <NextIntlClientProvider locale="fr" messages={fr}>
      <Bar readOnly={readOnly} />
    </NextIntlClientProvider>,
  );

describe("KanbanFilterBar", () => {
  it("les boutons Filtrer et Trier ont aria-label et info-bulle au focus clavier", async () => {
    bar(false);
    const filterBtn = screen.getByRole("button", { name: "Filtrer" });
    expect(screen.getByRole("button", { name: "Trier" })).toBeTruthy();
    act(() => filterBtn.focus());
    const tip = await screen.findAllByText("Filtrer");
    expect(tip.some((n) => n.closest("[data-base-ui-focusable]"))).toBe(true);
  });

  it("viewer : boutons désactivés avec info-bulle explicative", async () => {
    bar(true);
    const btn = screen.getByRole("button", { name: "Filtrer" });
    expect(btn.getAttribute("aria-disabled") ?? btn.getAttribute("disabled")).not.toBeNull();
    act(() => btn.focus());
    expect(await screen.findByText(/Lecture seule/)).toBeTruthy();
    fireEvent.click(btn);
    expect(screen.queryByText("Aucun filtre appliqué")).toBeNull();
  });

  it("le bouton Trier ouvre le panneau de tri partagé", async () => {
    bar(false);
    fireEvent.click(screen.getByRole("button", { name: "Trier" }));
    expect(await screen.findByText("Aucun classement actif.")).toBeTruthy();
    await waitFor(() => expect(screen.getByText("Ajouter un classement")).toBeTruthy());
  });
});
