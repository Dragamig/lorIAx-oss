// @vitest-environment jsdom
import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { act, cleanup, fireEvent, render, renderHook, screen, waitFor } from "@testing-library/react";
import { NextIntlClientProvider } from "next-intl";
import fr from "../../../messages/fr.json";
import { KanbanTotalsMenu, KANBAN_TOTALS_ACTIONS } from "@/components/bases/kanban-totals-menu";
import { useKanbanTotalsConfig } from "@/components/bases/use-kanban-totals-config";
import type { DbColumn } from "@/components/editor/extensions/database-block/types";
import type { KanbanTotalsConfig } from "@/lib/bases/view-config";

const apiPatch = vi.fn();
vi.mock("@/components/editor/extensions/database-block/api", () => ({
  apiPatch: (...a: unknown[]) => apiPatch(...a),
}));
const toastSuccess = vi.fn();
const toastError = vi.fn();
vi.mock("sonner", () => ({
  toast: Object.assign(vi.fn(), {
    success: (...a: unknown[]) => toastSuccess(...a),
    error: (...a: unknown[]) => toastError(...a),
  }),
}));

const columns = [
  { id: "t", name: "Nom", type: "text", config: {} },
  { id: "s", name: "Statut", type: "select", config: { options: ["A", "B"] } },
  { id: "m", name: "Montant", type: "number", config: {} },
  { id: "f", name: "Calcul", type: "formula", config: { formula: "1" } },
] as unknown as DbColumn[];
const lanes = [{ key: "A", rows: [] }, { key: "B", rows: [] }, { key: "", rows: [] }];
const group = columns[1];
const cfg: KanbanTotalsConfig = { amountColumnId: "m", closedLanes: ["B"], weights: { A: 10 }, currency: "USD", showWeighted: true };

const wrapper = ({ children }: { children: React.ReactNode }) => (
  <NextIntlClientProvider locale="fr" messages={fr}>{children}</NextIntlClientProvider>
);

function menu(over: Partial<React.ComponentProps<typeof KanbanTotalsMenu>> = {}) {
  const onChange = vi.fn();
  const props = {
    columns, lanes, groupColumn: group, config: cfg, reason: null, readOnly: false, onChange, ...over,
  } as React.ComponentProps<typeof KanbanTotalsMenu>;
  render(<KanbanTotalsMenu {...props} />, { wrapper });
  fireEvent.click(screen.getByRole("button", { name: "Totaux" }));
  return onChange;
}

beforeEach(() => {
  // jsdom n'a pas PointerEvent (interrupteur base-ui).
  if (!window.PointerEvent) (window as unknown as { PointerEvent: typeof MouseEvent }).PointerEvent = MouseEvent;
  apiPatch.mockReset();
  apiPatch.mockResolvedValue({});
  toastSuccess.mockReset();
  toastError.mockReset();
});
afterEach(cleanup);

describe("KanbanTotalsMenu", () => {
  it("changer la colonne de montant envoie kanbanTotals entier", async () => {
    const onChange = menu();
    const sel = await screen.findByLabelText("Colonne montant");
    expect(Array.from((sel as HTMLSelectElement).options).map((o) => o.textContent)).toEqual(["Aucune", "Montant", "Calcul"]);
    fireEvent.change(sel, { target: { value: "f" } });
    expect(onChange).toHaveBeenCalledWith({ ...cfg, amountColumnId: "f" });
  });

  it("cocher Voie close conserve poids et devise", async () => {
    const onChange = menu();
    fireEvent.click(await screen.findByRole("checkbox", { name: "Voie A close" }));
    expect(onChange).toHaveBeenCalledWith({ ...cfg, closedLanes: ["B", "A"] });
  });

  it("la voie sans valeur n'a pas de case Close", async () => {
    menu();
    await screen.findByLabelText("Colonne montant");
    expect(screen.queryByRole("checkbox", { name: /Sans valeur/ })).toBeNull();
    expect(screen.getByLabelText("Poids de la voie Sans valeur")).toBeTruthy();
  });

  it("poids valide enregistré, 101 et abc en erreur sans requête", async () => {
    const onChange = menu();
    const w = (await screen.findByLabelText("Poids de la voie A")) as HTMLInputElement;
    fireEvent.change(w, { target: { value: "101" } });
    fireEvent.blur(w);
    expect(w.getAttribute("aria-invalid")).toBe("true");
    expect(screen.getByText("Le poids doit être un entier de 0 à 100")).toBeTruthy();
    fireEvent.change(w, { target: { value: "abc" } });
    fireEvent.blur(w);
    expect(onChange).not.toHaveBeenCalled();
    fireEvent.change(w, { target: { value: "55" } });
    fireEvent.blur(w);
    expect(onChange).toHaveBeenCalledWith({ ...cfg, weights: { A: 55 } });
  });

  it("champ Poids désactivé avec info-bulle quand showWeighted est faux", async () => {
    const onChange = menu({ config: { ...cfg, showWeighted: false } });
    const w = (await screen.findByLabelText("Poids de la voie A")) as HTMLInputElement;
    expect(w.getAttribute("aria-disabled")).toBe("true");
    fireEvent.change(w, { target: { value: "5" } });
    fireEvent.blur(w);
    expect(onChange).not.toHaveBeenCalled();
    act(() => w.focus());
    expect(await screen.findByText("Activez le total pondéré pour saisir un poids")).toBeTruthy();
  });

  it("voie close : champ Poids désactivé avec info-bulle explicative", async () => {
    const onChange = menu();
    const w = (await screen.findByLabelText("Poids de la voie B")) as HTMLInputElement;
    expect(w.getAttribute("aria-disabled")).toBe("true");
    fireEvent.change(w, { target: { value: "5" } });
    fireEvent.blur(w);
    expect(onChange).not.toHaveBeenCalled();
    act(() => w.focus());
    expect(await screen.findByText(fr.basesTotals.weightClosedReason)).toBeTruthy();
    expect(((await screen.findByLabelText("Poids de la voie A")) as HTMLInputElement).getAttribute("aria-disabled")).toBeNull();
  });

  it("l'interrupteur bascule le total pondéré", async () => {
    const onChange = menu();
    fireEvent.click(await screen.findByRole("switch", { name: "Total pondéré" }));
    expect(onChange).toHaveBeenCalledWith({ ...cfg, showWeighted: false });
  });

  it("devise modifiée", async () => {
    const onChange = menu();
    fireEvent.change(await screen.findByLabelText("Devise"), { target: { value: "CHF" } });
    expect(onChange).toHaveBeenCalledWith({ ...cfg, currency: "CHF" });
  });

  it("Aucune et Désactiver les totaux envoient null", async () => {
    const onChange = menu();
    fireEvent.change(await screen.findByLabelText("Colonne montant"), { target: { value: "" } });
    expect(onChange).toHaveBeenLastCalledWith(null);
    fireEvent.click(screen.getByRole("button", { name: "Désactiver les totaux" }));
    expect(onChange).toHaveBeenCalledTimes(2);
    expect(onChange).toHaveBeenLastCalledWith(null);
  });

  it("colonne supprimée et colonne de type texte : messages", async () => {
    cleanup();
    menu({ config: { ...cfg, amountColumnId: "zz" }, reason: "missing_column" });
    expect(await screen.findByText(fr.basesTotals.inactiveMissingColumn)).toBeTruthy();
    cleanup();
    menu({ config: { ...cfg, amountColumnId: "t" }, reason: "bad_type" });
    expect(await screen.findByText(fr.basesTotals.inactiveBadType)).toBeTruthy();
  });

  it("rien de configuré : invite, aucun contrôle de voie actif", async () => {
    menu({ config: null, reason: "none" });
    expect(await screen.findByText(fr.basesTotals.emptyPrompt)).toBeTruthy();
    expect(screen.queryByRole("button", { name: "Désactiver les totaux" })).toBeNull();
  });

  it("aucune colonne nombre : message explicatif", async () => {
    menu({ config: null, reason: "none", columns: columns.slice(0, 2) });
    expect(await screen.findByText(fr.basesTotals.noNumberColumn)).toBeTruthy();
  });

  it("regroupement multi-valeur : mention", async () => {
    menu({ groupColumn: { ...group, config: { options: ["A", "B"], multiple: true } } as DbColumn });
    expect(await screen.findByText(fr.basesTotals.multiValueNotice)).toBeTruthy();
  });

  it("viewer : bouton désactivé avec info-bulle", async () => {
    render(
      <KanbanTotalsMenu columns={columns} lanes={lanes} groupColumn={group} config={cfg} reason={null} readOnly onChange={vi.fn()} />,
      { wrapper },
    );
    const btn = screen.getByRole("button", { name: "Totaux" });
    expect(btn.getAttribute("aria-disabled") ?? btn.getAttribute("disabled")).not.toBeNull();
    act(() => btn.focus());
    expect(await screen.findByText(/Lecture seule/)).toBeTruthy();
    fireEvent.click(btn);
    expect(screen.queryByLabelText("Colonne montant")).toBeNull();
  });

  it("chaque action du registre correspond à un contrôle rendu", async () => {
    menu();
    await screen.findByLabelText("Colonne montant");
    for (const a of KANBAN_TOTALS_ACTIONS) {
      expect(document.querySelector(`[data-action="${a.id}"]`), a.id).not.toBeNull();
    }
  });

  it("chaque bouton rendu a un aria-label et une info-bulle au focus", async () => {
    menu();
    await screen.findByLabelText("Colonne montant");
    const buttons = screen.getAllByRole("button").filter((b) => b.closest("[data-slot=popover-content]"));
    expect(buttons.length).toBeGreaterThanOrEqual(3);
    for (const b of buttons) {
      expect(b.getAttribute("aria-label"), b.outerHTML).toBeTruthy();
    }
    const dis = screen.getByRole("button", { name: "Désactiver les totaux" });
    act(() => dis.focus());
    expect((await screen.findAllByText("Désactiver les totaux")).some((n) => n.closest("[data-base-ui-focusable]"))).toBe(true);
  });

  it("clavier : Tab atteint les contrôles, Espace coche, Échap ferme", async () => {
    const onChange = menu();
    const cb = await screen.findByRole("checkbox", { name: "Voie A close" });
    act(() => cb.focus());
    expect(document.activeElement).toBe(cb);
    fireEvent.click(cb);
    expect(onChange).toHaveBeenCalled();
    fireEvent.keyDown(document.activeElement ?? document.body, { key: "Escape" });
    await waitFor(() => expect(screen.queryByLabelText("Colonne montant")).toBeNull());
  });
});

const hook = (viewConfig: Record<string, unknown> = { kanbanTotals: cfg }) =>
  renderHook(() => useKanbanTotalsConfig({ databaseId: "d", viewId: "v", viewConfig }), { wrapper });

describe("useKanbanTotalsConfig", () => {
  it("lit la config, PATCH kanbanTotals entier, toast Annuler qui renvoie l'état précédent", async () => {
    const h = hook();
    expect(h.result.current.config).toEqual(cfg);
    const next = { ...cfg, showWeighted: false };
    await act(async () => { await h.result.current.update(next); });
    expect(h.result.current.config).toEqual(next);
    expect(apiPatch).toHaveBeenCalledWith("/api/databases/d/views/v", { config: { kanbanTotals: next } });
    const opts = toastSuccess.mock.calls[0][1] as { action: { label: string; onClick: () => void } };
    expect(opts.action.label).toBe("Annuler");
    await act(async () => { opts.action.onClick(); });
    expect(apiPatch).toHaveBeenLastCalledWith("/api/databases/d/views/v", { config: { kanbanTotals: cfg } });
    expect(h.result.current.config).toEqual(cfg);
  });

  it("null désactive les totaux", async () => {
    const h = hook();
    await act(async () => { await h.result.current.update(null); });
    expect(h.result.current.config).toBeNull();
    expect(apiPatch).toHaveBeenCalledWith("/api/databases/d/views/v", { config: { kanbanTotals: null } });
  });

  it("échec : retour à l'état confirmé et toast Réessayer", async () => {
    apiPatch.mockRejectedValueOnce(new Error("boom"));
    const h = hook();
    const next = { ...cfg, currency: "CHF" };
    await act(async () => { await h.result.current.update(next); });
    expect(h.result.current.config).toEqual(cfg);
    const opts = toastError.mock.calls[0][1] as { action: { label: string; onClick: () => void } };
    expect(opts.action.label).toBe("Réessayer");
    await act(async () => { opts.action.onClick(); });
    expect(apiPatch).toHaveBeenCalledTimes(2);
    expect(h.result.current.config).toEqual(next);
  });
});

describe("useKanbanTotalsConfig : course A succès, B échec", () => {
  it("l'échec de B revient à A (acquitté), pas à l'état d'avant A", async () => {
    let resolveA: () => void = () => {};
    let rejectB: (e: Error) => void = () => {};
    apiPatch
      .mockImplementationOnce(() => new Promise<void>((r) => { resolveA = r; }))
      .mockImplementationOnce(() => new Promise<void>((_, rej) => { rejectB = rej; }));
    const h = hook();
    const A = { ...cfg, currency: "CHF" };
    const B = { ...cfg, currency: "JPY" };
    let pa: Promise<void> = Promise.resolve();
    let pb: Promise<void> = Promise.resolve();
    act(() => { pa = h.result.current.update(A); });
    act(() => { pb = h.result.current.update(B); });
    await act(async () => { resolveA(); await pa; });
    await act(async () => { rejectB(new Error("boom")); await pb; });
    expect(h.result.current.config).toEqual(A);
  });
});

describe("useKanbanTotalsConfig : une seule écriture en vol", () => {
  it("A en vol, B et C : un seul PATCH en vol, puis un seul envoi portant C", async () => {
    let resolveA: () => void = () => {};
    let resolveC: () => void = () => {};
    apiPatch
      .mockImplementationOnce(() => new Promise<void>((r) => { resolveA = r; }))
      .mockImplementationOnce(() => new Promise<void>((r) => { resolveC = r; }));
    const h = hook();
    const A = { ...cfg, currency: "CHF" };
    const B = { ...cfg, currency: "JPY" };
    const C = { ...cfg, currency: "USD" };
    let pa: Promise<void> = Promise.resolve();
    let pc: Promise<void> = Promise.resolve();
    act(() => { pa = h.result.current.update(A); });
    act(() => { void h.result.current.update(B); });
    act(() => { pc = h.result.current.update(C); });
    expect(apiPatch).toHaveBeenCalledTimes(1);
    expect(h.result.current.config).toEqual(C);
    await act(async () => { resolveA(); await pa; });
    expect(apiPatch).toHaveBeenCalledTimes(2);
    expect(apiPatch).toHaveBeenLastCalledWith("/api/databases/d/views/v", { config: { kanbanTotals: C } });
    await act(async () => { resolveC(); await pc; });
    expect(apiPatch).toHaveBeenCalledTimes(2);
    expect(h.result.current.config).toEqual(C);
  });

  it("l'échec de la requête fusionnée revient à A (acquitté)", async () => {
    let resolveA: () => void = () => {};
    let rejectC: (e: Error) => void = () => {};
    apiPatch
      .mockImplementationOnce(() => new Promise<void>((r) => { resolveA = r; }))
      .mockImplementationOnce(() => new Promise<void>((_, rej) => { rejectC = rej; }));
    const h = hook();
    const A = { ...cfg, currency: "CHF" };
    let pa: Promise<void> = Promise.resolve();
    let pc: Promise<void> = Promise.resolve();
    act(() => { pa = h.result.current.update(A); });
    act(() => { void h.result.current.update({ ...cfg, currency: "JPY" }); });
    act(() => { pc = h.result.current.update({ ...cfg, currency: "USD" }); });
    await act(async () => { resolveA(); await pa; });
    await act(async () => { rejectC(new Error("boom")); await pc; });
    expect(h.result.current.config).toEqual(A);
  });
});
