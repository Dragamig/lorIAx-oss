// @vitest-environment jsdom
import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { cleanup, fireEvent, screen } from "@testing-library/react";
import { KanbanBoard } from "@/components/bases/kanban-board";
import type { DbColumn, DbRow } from "@/components/editor/extensions/database-block/types";
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
  CellEditor: ({ column, value }: { column: { id: string }; value: unknown }) => (
    <input data-testid={`cell-${column.id}`} value={String(value ?? "")} readOnly />
  ),
}));

vi.mock("@/components/bases/use-view-display-config", () => ({
  useViewDisplayConfig: () => ({ display: {}, changeDisplay: vi.fn() }),
}));

const U1 = "11111111-1111-4111-8111-111111111111";
const U2 = "22222222-2222-4222-8222-222222222222";
const U3 = "33333333-3333-4333-8333-333333333333";

const columns = [
  { id: "t", name: "Nom", type: "text", config: {} },
  { id: "s", name: "Statut", type: "select", config: { options: ["A", "B"] } },
] as unknown as DbColumn[];
const mkRow = (id: string, name: string, status: string, position: number) =>
  ({ id, databaseId: "d", cells: { t: name, s: status }, position, createdAt: "", updatedAt: "" }) as unknown as DbRow;
// Database order: r1 (A), r2 (B), r3 (A). Lane order: r1, r3, r2.
const rows = [mkRow(U1, "un", "A", 0), mkRow(U2, "deux", "B", 1), mkRow(U3, "trois", "A", 2)];

function renderBoard() {
  return renderWithIntl(
    <KanbanBoard
      databaseId="d"
      spaceId="sp"
      viewId="v"
      viewConfig={{ groupByColumnId: "s", version: "v1" }}
      columns={columns}
      rows={rows}
      onRefresh={vi.fn()}
    />,
  );
}

beforeEach(() => {
  searchString = "";
  window.history.replaceState(null, "", "/bases/d");
});
afterEach(() => cleanup());

describe("KanbanBoard record sheet", () => {
  it("opens the sheet on card click and shows the position in lane order", () => {
    renderBoard();
    fireEvent.click(screen.getByRole("button", { name: "Ouvrir la fiche un" }));
    expect(screen.getByRole("dialog")).toBeTruthy();
    expect(screen.getByText("Fiche 1 sur 3")).toBeTruthy();
  });

  it("navigates in lane order, not in database order", () => {
    renderBoard();
    fireEvent.click(screen.getByRole("button", { name: "Ouvrir la fiche un" }));
    fireEvent.keyDown(screen.getByRole("dialog"), { key: "ArrowRight", altKey: true });
    expect(screen.getByText("Fiche 2 sur 3")).toBeTruthy();
    fireEvent.keyDown(screen.getByRole("dialog"), { key: "ArrowRight", altKey: true });
    expect(screen.getByText("Fiche 3 sur 3")).toBeTruthy();
    expect(screen.getByTestId("cell-t")).toBeTruthy();
    expect((screen.getByTestId("cell-t") as HTMLInputElement).value).toBe("deux");
  });

  it("opens from the row param", () => {
    searchString = `row=${U2}`;
    renderBoard();
    expect(screen.getByRole("dialog")).toBeTruthy();
    expect(screen.getByText("Fiche 3 sur 3")).toBeTruthy();
  });

  it("shows not found for an unknown row param", () => {
    searchString = "row=99999999-9999-4999-8999-999999999999";
    renderBoard();
    expect(screen.getByText("Fiche introuvable")).toBeTruthy();
  });

  it("closes on Escape and keeps the board", () => {
    renderBoard();
    fireEvent.click(screen.getByRole("button", { name: "Ouvrir la fiche un" }));
    fireEvent.keyDown(screen.getByRole("dialog"), { key: "Escape" });
    expect(screen.queryByRole("dialog")).toBeNull();
    expect(screen.getByTestId("kanban-board")).toBeTruthy();
  });

  it("dedupes rows shown in several lanes (multi-select group column)", () => {
    const multiCols = [
      columns[0],
      { id: "s", name: "Statut", type: "select", config: { options: ["A", "B"], multiple: true } },
    ] as unknown as DbColumn[];
    const mk = (id: string, name: string, v: string[], position: number) =>
      ({ id, databaseId: "d", cells: { t: name, s: v }, position, createdAt: "", updatedAt: "" }) as unknown as DbRow;
    // r1 in A and B, r2 in B only, r3 in A only: 3 distinct rows, 4 cards.
    const multiRows = [mk(U1, "un", ["A", "B"], 0), mk(U2, "deux", ["B"], 1), mk(U3, "trois", ["A"], 2)];
    renderWithIntl(
      <KanbanBoard
        databaseId="d"
        spaceId="sp"
        viewId="v"
        viewConfig={{ groupByColumnId: "s", version: "v1" }}
        columns={multiCols}
        rows={multiRows}
        onRefresh={vi.fn()}
      />,
    );
    fireEvent.click(screen.getAllByRole("button", { name: "Ouvrir la fiche un" })[0]);
    expect(screen.getByText("Fiche 1 sur 3")).toBeTruthy();
    const dlg = () => screen.getByRole("dialog");
    fireEvent.keyDown(dlg(), { key: "ArrowRight", altKey: true });
    expect(screen.getByText("Fiche 2 sur 3")).toBeTruthy();
    fireEvent.keyDown(dlg(), { key: "ArrowRight", altKey: true });
    expect(screen.getByText("Fiche 3 sur 3")).toBeTruthy();
    expect((screen.getByTestId("cell-t") as HTMLInputElement).value).toBe("deux");
  });

  it("shows not found when the open row disappears from rows", () => {
    const props = {
      databaseId: "d",
      spaceId: "sp",
      viewId: "v",
      viewConfig: { groupByColumnId: "s", version: "v1" },
      columns,
      onRefresh: vi.fn(),
    };
    const { rerender } = renderWithIntl(<KanbanBoard {...props} rows={rows} />);
    fireEvent.click(screen.getByRole("button", { name: "Ouvrir la fiche un" }));
    expect(screen.getByRole("dialog")).toBeTruthy();
    rerender(<KanbanBoard {...props} rows={rows.filter((r) => r.id !== U1)} />);
    expect(screen.getByText("Fiche introuvable")).toBeTruthy();
  });
});
