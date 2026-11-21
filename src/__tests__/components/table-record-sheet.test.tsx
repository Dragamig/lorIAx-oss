// @vitest-environment jsdom
import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { cleanup, fireEvent, screen, waitFor, within } from "@testing-library/react";
import { DatabaseTable } from "@/components/editor/extensions/database-block/database-table-view";
import { BaseViewer } from "@/components/bases/base-viewer";
import type { DbColumn, DbData, DbRow } from "@/components/editor/extensions/database-block/types";
import { toast } from "sonner";
import { renderWithIntl } from "./support/render-intl";

let searchString = "";
vi.mock("next/navigation", () => ({
  useSearchParams: () => new URLSearchParams(searchString),
  useRouter: () => ({ push: vi.fn(), replace: vi.fn(), refresh: vi.fn() }),
  usePathname: () => "/bases/d",
}));

vi.mock("sonner", () => {
  const fn = Object.assign(vi.fn(), { info: vi.fn(), success: vi.fn(), error: vi.fn() });
  return { toast: fn };
});

vi.mock("@/components/editor/extensions/database-block/use-relation-data", () => ({
  useRelationData: () => ({}),
}));

vi.mock("@/components/editor/extensions/database-block/database-cell-editor", () => ({
  CellEditor: ({
    column,
    value,
    onChange,
  }: {
    column: { id: string };
    value: unknown;
    onChange: (v: string) => void;
  }) => (
    <input
      data-testid={`cell-${column.id}`}
      value={String(value ?? "")}
      onChange={(e) => onChange(e.target.value)}
    />
  ),
}));

const U1 = "11111111-1111-4111-8111-111111111111";
const U2 = "22222222-2222-4222-8222-222222222222";
const U3 = "33333333-3333-4333-8333-333333333333";
const U4 = "44444444-4444-4444-8444-444444444444";

const columns = [{ id: "t", name: "Nom", type: "text", config: {}, position: 0 }] as unknown as DbColumn[];
const mkRow = (id: string, name: string, position: number) =>
  ({ id, databaseId: "d", cells: { t: name }, position, createdAt: "", updatedAt: "" }) as unknown as DbRow;
const rows = [mkRow(U1, "alpha", 0), mkRow(U2, "bravo", 1), mkRow(U3, "charlie", 2), mkRow(U4, "delta", 3)];
const data: DbData = { id: "d", spaceId: "sp", name: "Base", description: null, columns, rows };

const fetchMock = vi.fn();

beforeEach(() => {
  searchString = "";
  window.history.replaceState(null, "", "/bases/d");
  fetchMock.mockReset();
  fetchMock.mockImplementation(async (url: string) => ({
    ok: true,
    status: 200,
    json: async () =>
      String(url).includes("/activity")
        ? { items: [], nextCursor: null, canClear: false, permission: "editor", viewerId: "u1" }
        : [],
  }));
  vi.stubGlobal("fetch", fetchMock);
});
afterEach(() => {
  cleanup();
  vi.unstubAllGlobals();
});

function renderTable(extra: Partial<React.ComponentProps<typeof DatabaseTable>> = {}) {
  return renderWithIntl(
    <DatabaseTable
      data={data}
      spaceId="sp"
      onRefresh={vi.fn()}
      viewMode="table"
      onViewModeChange={vi.fn()}
      {...extra}
    />,
  );
}
const rowEl = (id: string) => document.querySelector(`tr[data-row-id="${id}"]`) as HTMLElement;

describe("DatabaseTable record sheet", () => {
  it("renders the open record icon only when onOpenRecord is given", () => {
    const { unmount } = renderTable({ onOpenRecord: vi.fn(), openRecordLabel: "Ouvrir la fiche" });
    expect(screen.getAllByRole("button", { name: "Ouvrir la fiche" })).toHaveLength(4);
    unmount();
    renderTable();
    expect(screen.queryAllByRole("button", { name: "Ouvrir la fiche" })).toHaveLength(0);
  });

  it("opens the record on icon click", () => {
    const onOpenRecord = vi.fn();
    renderTable({ onOpenRecord, openRecordLabel: "Ouvrir la fiche" });
    fireEvent.click(screen.getAllByRole("button", { name: "Ouvrir la fiche" })[1]);
    expect(onOpenRecord).toHaveBeenCalledTimes(1);
    expect(onOpenRecord).toHaveBeenCalledWith(U2);
  });

  it("opens the record on a plain row click", () => {
    const onOpenRecord = vi.fn();
    renderTable({ onOpenRecord, openRecordLabel: "Ouvrir la fiche" });
    fireEvent.click(rowEl(U3));
    expect(onOpenRecord).toHaveBeenCalledTimes(1);
    expect(onOpenRecord).toHaveBeenCalledWith(U3);
  });

  it("does not open while editing a cell", async () => {
    const onOpenRecord = vi.fn();
    renderTable({ onOpenRecord, openRecordLabel: "Ouvrir la fiche" });
    const input = screen.getAllByTestId("cell-t")[0] as HTMLInputElement;
    fireEvent.mouseDown(input);
    input.focus();
    fireEvent.click(input);
    fireEvent.change(input, { target: { value: "alphax" } });
    // A click on the row that ends the edit must not open the sheet either.
    fireEvent.mouseDown(rowEl(U2));
    input.blur();
    fireEvent.click(rowEl(U2));
    expect(onOpenRecord).not.toHaveBeenCalled();
    expect((screen.getAllByTestId("cell-t")[0] as HTMLInputElement).value).toBe("alphax");
  });

  it("does not open on selection gestures", () => {
    const onOpenRecord = vi.fn();
    renderTable({ onOpenRecord, openRecordLabel: "Ouvrir la fiche" });
    fireEvent.click(screen.getByRole("checkbox", { name: "Sélectionner la ligne 1" }));
    fireEvent.click(rowEl(U3), { shiftKey: true });
    expect(onOpenRecord).not.toHaveBeenCalled();
    expect(rowEl(U1).getAttribute("aria-selected")).toBe("true");
    expect(rowEl(U2).getAttribute("aria-selected")).toBe("true");
    expect(rowEl(U3).getAttribute("aria-selected")).toBe("true");
    expect(rowEl(U4).getAttribute("aria-selected")).toBe("false");
  });

  it("opens the focused row with Alt+Enter", () => {
    const onOpenRecord = vi.fn();
    renderTable({ onOpenRecord, openRecordLabel: "Ouvrir la fiche" });
    rowEl(U3).focus();
    fireEvent.keyDown(rowEl(U3), { key: "Enter" });
    expect(onOpenRecord).not.toHaveBeenCalled();
    fireEvent.keyDown(rowEl(U3), { key: "Enter", altKey: true });
    expect(onOpenRecord).toHaveBeenCalledTimes(1);
    expect(onOpenRecord).toHaveBeenCalledWith(U3);
  });

  it("reports displayed ids in grid order, only when they change", () => {
    const onDisplayedIdsChange = vi.fn();
    const props = {
      data,
      spaceId: "sp",
      onRefresh: vi.fn(),
      viewMode: "table" as const,
      onViewModeChange: vi.fn(),
      viewPersistence: { viewId: "v", initialSorts: [{ columnId: "t", direction: "desc" as const }] },
      onDisplayedIdsChange,
    };
    const { rerender } = renderWithIntl(<DatabaseTable {...props} />);
    expect(onDisplayedIdsChange).toHaveBeenLastCalledWith([U4, U3, U2, U1]);
    const calls = onDisplayedIdsChange.mock.calls.length;
    rerender(<DatabaseTable {...props} data={{ ...data, rows: [...rows] }} />);
    expect(onDisplayedIdsChange.mock.calls.length).toBe(calls);
  });

  it("keeps the document block unchanged", () => {
    renderTable();
    expect(screen.queryAllByRole("button", { name: "Ouvrir la fiche" })).toHaveLength(0);
    expect(rowEl(U1).getAttribute("tabindex")).toBeNull();
    fireEvent.keyDown(rowEl(U1), { key: "Enter", altKey: true });
    fireEvent.click(rowEl(U1));
    expect(screen.queryByRole("dialog")).toBeNull();
  });
});

const dbRows = rows as unknown as React.ComponentProps<typeof BaseViewer>["rows"];
const dbColumns = columns as unknown as React.ComponentProps<typeof BaseViewer>["columns"];
function renderViewer(config: Record<string, unknown> = {}) {
  return renderWithIntl(
    <BaseViewer
      viewerId="u1"
      database={{ id: "d", name: "Base", description: null, spaceId: "sp" }}
      columns={dbColumns}
      rows={dbRows}
      views={[{ id: "v", name: "Grille", type: "grid", isDefault: true, position: 0, scope: "shared", createdBy: null, config }]}
      activeViewId="v"
      spaceIdParam="sp"
      siblingTables={[]}
    />,
  );
}

describe("BaseViewer grid record sheet", () => {
  it("navigates in displayed order through the sheet", async () => {
    renderViewer({
      sorts: [{ columnId: "t", direction: "desc" }],
      filters: [{ columnId: "t", operator: "is_not", value: "charlie" }],
    });
    // Displayed order: delta, bravo, alpha (charlie filtered out).
    await waitFor(() => expect(screen.getAllByTestId("cell-t")).toHaveLength(3));
    fireEvent.click(screen.getAllByRole("button", { name: "Ouvrir la fiche" })[0]);
    expect(screen.getByRole("dialog")).toBeTruthy();
    expect(screen.getByText("Fiche 1 sur 3")).toBeTruthy();
    fireEvent.keyDown(screen.getByRole("dialog"), { key: "ArrowRight", altKey: true });
    expect(screen.getByText("Fiche 2 sur 3")).toBeTruthy();
    fireEvent.keyDown(screen.getByRole("dialog"), { key: "ArrowRight", altKey: true });
    expect(screen.getByText("Fiche 3 sur 3")).toBeTruthy();
    expect(window.location.search).toContain(`row=${U1}`);
  });

  it("opens from the row param on the table view", () => {
    searchString = `row=${U2}`;
    renderViewer();
    expect(screen.getByRole("dialog")).toBeTruthy();
  });

  it("shows not found for an unknown row param", () => {
    searchString = "row=99999999-9999-4999-8999-999999999999";
    renderViewer();
    expect(screen.getByText("Fiche introuvable")).toBeTruthy();
  });

  it("shares cell writes between the grid and the sheet", async () => {
    const cols2 = [
      { id: "t", name: "Nom", type: "text", config: {}, position: 0 },
      { id: "n", name: "Note", type: "text", config: {}, position: 1 },
    ] as unknown as React.ComponentProps<typeof BaseViewer>["columns"];
    const rows2 = rows.map((r) => ({ ...r, cells: { t: String(r.cells.t), n: "" } })) as unknown as React.ComponentProps<
      typeof BaseViewer
    >["rows"];
    renderWithIntl(
      <BaseViewer
      viewerId="u1"
        database={{ id: "d", name: "Base", description: null, spaceId: "sp" }}
        columns={cols2}
        rows={rows2}
        views={[{ id: "v", name: "Grille", type: "grid", isDefault: true, position: 0, scope: "shared", createdBy: null, config: {} }]}
        activeViewId="v"
        spaceIdParam="sp"
        siblingTables={[]}
      />,
    );
    const gridCell = (col: string) => (document.querySelector(`tbody tr[data-row-id="${U1}"] [data-testid="cell-${col}"]`) as HTMLInputElement);
    fireEvent.change(gridCell("t"), { target: { value: "alphaX" } });
    fireEvent.click(screen.getAllByRole("button", { name: "Ouvrir la fiche" })[0]);
    const dlg = screen.getByRole("dialog");
    expect((within(dlg).getByTestId("cell-t") as HTMLInputElement).value).toBe("alphaX");
    fireEvent.change(within(dlg).getByTestId("cell-n"), { target: { value: "note" } });
    await waitFor(() => expect(gridCell("n").value).toBe("note"));
    expect(gridCell("t").value).toBe("alphaX");
  });

  it("keeps the grid in sync when the sheet rewrites the same cell, and on undo", async () => {
    renderViewer();
    const gridCell = () =>
      document.querySelector(`tbody tr[data-row-id="${U1}"] [data-testid="cell-t"]`) as HTMLInputElement;
    fireEvent.change(gridCell(), { target: { value: "A" } });
    fireEvent.click(screen.getAllByRole("button", { name: "Ouvrir la fiche" })[0]);
    const dlg = screen.getByRole("dialog");
    expect((within(dlg).getByTestId("cell-t") as HTMLInputElement).value).toBe("A");
    fireEvent.change(within(dlg).getByTestId("cell-t"), { target: { value: "B" } });
    await waitFor(() => expect(gridCell().value).toBe("B"));
    const opts = (vi.mocked(toast.success).mock.calls.at(-1)?.[1] ?? {}) as unknown as {
      action: { onClick: () => Promise<void> };
    };
    await opts.action.onClick();
    await waitFor(() => expect(gridCell().value).toBe("A"));
    expect((within(screen.getByRole("dialog")).getByTestId("cell-t") as HTMLInputElement).value).toBe("A");
  });
  it("keeps grid and sheet edits visible after a row move", async () => {
    renderViewer();
    const gridCell = (id: string) =>
      document.querySelector(`tbody tr[data-row-id="${id}"] [data-testid="cell-t"]`) as HTMLInputElement;
    const order = () => Array.from(document.querySelectorAll("tbody tr[data-row-id]")).map((r) => r.getAttribute("data-row-id"));
    fireEvent.keyDown(screen.getByRole("button", { name: "Déplacer la ligne 1" }), { key: "ArrowDown", altKey: true });
    await waitFor(() => expect(order().slice(0, 2)).toEqual([U2, U1]));
    // Grid edit after the move.
    fireEvent.change(gridCell(U1), { target: { value: "moved-grid" } });
    await waitFor(() => expect(gridCell(U1).value).toBe("moved-grid"));
    // Sheet edit after the move.
    fireEvent.click(screen.getAllByRole("button", { name: "Ouvrir la fiche" })[1]);
    const dlg = screen.getByRole("dialog");
    fireEvent.change(within(dlg).getByTestId("cell-t"), { target: { value: "moved-sheet" } });
    await waitFor(() => expect(gridCell(U1).value).toBe("moved-sheet"));
    expect(order().slice(0, 2)).toEqual([U2, U1]);
  });

  it("shows a single error toast when a sheet write fails", async () => {
    renderViewer();
    fireEvent.click(screen.getAllByRole("button", { name: "Ouvrir la fiche" })[0]);
    fetchMock.mockResolvedValue({ ok: false, status: 500, json: async () => ({}) });
    vi.mocked(toast.error).mockClear();
    fireEvent.change(within(screen.getByRole("dialog")).getByTestId("cell-t"), { target: { value: "x" } });
    await waitFor(() => expect(toast.error).toHaveBeenCalled());
    await new Promise((r) => setTimeout(r, 30));
    expect(toast.error).toHaveBeenCalledTimes(1);
    expect(toast.error).toHaveBeenCalledWith("Nom non enregistré");
  });

  it("shows a single error toast when a grid edit fails", async () => {
    renderViewer();
    fetchMock.mockResolvedValue({ ok: false, status: 500, json: async () => ({}) });
    vi.mocked(toast.error).mockClear();
    const cell = document.querySelector(`tbody tr[data-row-id="${U1}"] [data-testid="cell-t"]`) as HTMLInputElement;
    fireEvent.change(cell, { target: { value: "x" } });
    await waitFor(() => expect(toast.error).toHaveBeenCalled());
    await new Promise((r) => setTimeout(r, 30));
    expect(toast.error).toHaveBeenCalledTimes(1);
    expect(toast.error).toHaveBeenCalledWith("Échec de l'enregistrement de la cellule");
  });
});
