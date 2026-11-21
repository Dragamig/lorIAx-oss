// @vitest-environment jsdom
import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { cleanup, fireEvent, screen, waitFor } from "@testing-library/react";
import { toast } from "sonner";
import { RecordDialog, type RecordDialogProps } from "@/components/bases/record-dialog";
import type { DbColumn, DbRow } from "@/components/editor/extensions/database-block/types";
import { renderWithIntl } from "./support/render-intl";

vi.mock("sonner", () => {
  const fn = Object.assign(vi.fn(), { info: vi.fn(), success: vi.fn(), error: vi.fn() });
  return { toast: fn };
});

vi.mock("@/components/editor/extensions/database-block/database-cell-editor", () => ({
  CellEditor: ({ column, value, onChange }: { column: { id: string }; value: unknown; onChange: (v: unknown) => void }) => (
    <input
      data-testid={`cell-${column.id}`}
      defaultValue={String(value ?? "")}
      onChange={(e) => onChange(e.target.value)}
    />
  ),
}));

const col = (id: string, name: string) => ({ id, name, type: "text" }) as unknown as DbColumn;
const columns = [col("c1", "Nom"), col("c2", "Ville"), col("c3", "Note")];
const mkRow = (id: string, cells: Record<string, unknown>) =>
  ({ id, databaseId: "d", cells, position: 0, createdAt: "", updatedAt: "" }) as unknown as DbRow;
const row1 = mkRow("r1", { c1: "a", c2: "Lyon", c3: "x" });

function build(over: Partial<RecordDialogProps> = {}) {
  const onWriteCell = vi.fn().mockResolvedValue(undefined);
  const props: RecordDialogProps = {
    row: row1,
    columns,
    spaceId: "s",
    relationData: {} as RecordDialogProps["relationData"],
    onWriteCell,
    onClose: vi.fn(),
    ...over,
  };
  return { props, onWriteCell };
}

function lastToastOptions() {
  const calls = (toast.success as unknown as ReturnType<typeof vi.fn>).mock.calls;
  return calls[calls.length - 1];
}

beforeEach(() => {
  vi.clearAllMocks();
  vi.stubGlobal(
    "fetch",
    vi.fn((url: string) => {
      const body = String(url).endsWith("/tasks")
        ? { tasks: [], openCount: 0, permission: "editor" }
        : { items: [], nextCursor: null, canClear: false };
      return Promise.resolve(
        new Response(JSON.stringify(body), { status: 200, headers: { "Content-Type": "application/json" } }),
      );
    }),
  );
});
afterEach(() => {
  cleanup();
  vi.unstubAllGlobals();
});

describe("RecordDialog activity tab", () => {
  it("sans databaseId : pas d'onglets", () => {
    const { props } = build();
    renderWithIntl(<RecordDialog {...props} />);
    expect(screen.queryByRole("tab")).toBeNull();
    expect(screen.queryByRole("region", { name: "Activité" })).toBeNull();
  });

  it("avec databaseId : RowAside rendu dans le slot aside", async () => {
    const { props } = build({ databaseId: "d1" });
    renderWithIntl(<RecordDialog {...props} />);
    expect(screen.getAllByRole("tab")).toHaveLength(2);
    expect(await screen.findByRole("region", { name: "Activité" })).toBeTruthy();
    expect(await screen.findByText(/Aucune modification/)).toBeTruthy();
  });
});

describe("RecordDialog", () => {
  it("renders one editor per column in a labelled field", () => {
    const { props } = build();
    renderWithIntl(<RecordDialog {...props} />);
    expect(screen.getByTestId("cell-c1")).toBeTruthy();
    expect(screen.getByTestId("cell-c2")).toBeTruthy();
    expect(screen.getByTestId("cell-c3")).toBeTruthy();
    expect(screen.getByText("Nom")).toBeTruthy();
    expect(screen.getByText("Ville")).toBeTruthy();
    expect(screen.getByText("Note")).toBeTruthy();
  });

  it("falls back to the first column as title and to 'Fiche sans titre'", () => {
    const { props } = build();
    const { rerender } = renderWithIntl(<RecordDialog {...props} />);
    expect(screen.getByRole("dialog").getAttribute("aria-label")).toBe("Fiche : a");
    rerender(<RecordDialog {...props} row={mkRow("r1", { c1: "" })} />);
    expect(screen.getByRole("dialog").getAttribute("aria-label")).toBe("Fiche : Fiche sans titre");
  });

  it("shows a not-found sheet when row is null and status is notFound", () => {
    const { props } = build({ row: null, status: "notFound" });
    renderWithIntl(<RecordDialog {...props} />);
    expect(screen.getByText("Fiche introuvable")).toBeTruthy();
  });

  it("shows the empty-columns message", () => {
    const { props } = build({ columns: [] });
    renderWithIntl(<RecordDialog {...props} />);
    expect(screen.getByText("Cette base n'a aucune colonne.")).toBeTruthy();
  });

  it("writes a cell and shows an undoable toast", async () => {
    const { props, onWriteCell } = build();
    renderWithIntl(<RecordDialog {...props} />);
    fireEvent.change(screen.getByTestId("cell-c1"), { target: { value: "b" } });
    expect(onWriteCell).toHaveBeenCalledWith("r1", "c1", "b", { silent: true });
    await waitFor(() => expect(toast.success).toHaveBeenCalled());
    const [msg, opts] = lastToastOptions();
    expect(msg).toBe("Nom enregistré");
    expect(opts.id).toBe("record-r1-c1");
    expect(opts.action.label).toBe("Annuler");
    await opts.action.onClick();
    expect(onWriteCell).toHaveBeenLastCalledWith("r1", "c1", "a", { silent: true });
    expect(toast).toHaveBeenCalledWith("Nom rétabli");
  });

  it("does not toast when the write fails", async () => {
    const onWriteCell = vi.fn().mockResolvedValue(false);
    const { props } = build({ onWriteCell });
    renderWithIntl(<RecordDialog {...props} />);
    fireEvent.change(screen.getByTestId("cell-c1"), { target: { value: "b" } });
    await waitFor(() => expect(toast.error).toHaveBeenCalledWith("Nom non enregistré"));
    expect(toast.success).not.toHaveBeenCalled();
  });

  it("does not toast success and reports an error when the write rejects", async () => {
    const onWriteCell = vi.fn().mockRejectedValue(new Error("boom"));
    const { props } = build({ onWriteCell });
    renderWithIntl(<RecordDialog {...props} />);
    fireEvent.change(screen.getByTestId("cell-c1"), { target: { value: "b" } });
    await waitFor(() => expect(toast.error).toHaveBeenCalledWith("Nom non enregistré"));
    expect(toast.success).not.toHaveBeenCalled();
  });

  it("forgets the original once the toast is gone", async () => {
    const { props, onWriteCell } = build();
    const { rerender } = renderWithIntl(<RecordDialog {...props} />);
    fireEvent.change(screen.getByTestId("cell-c1"), { target: { value: "b" } });
    await waitFor(() => expect(toast.success).toHaveBeenCalledTimes(1));
    lastToastOptions()[1].onAutoClose();
    rerender(<RecordDialog {...props} row={mkRow("r1", { c1: "b" })} />);
    fireEvent.change(screen.getByTestId("cell-c1"), { target: { value: "c" } });
    await waitFor(() => expect(toast.success).toHaveBeenCalledTimes(2));
    await lastToastOptions()[1].action.onClick();
    expect(onWriteCell).toHaveBeenLastCalledWith("r1", "c1", "b", { silent: true });
  });

  it("keeps the entry and reports an error when the undo write fails", async () => {
    const { props, onWriteCell } = build();
    renderWithIntl(<RecordDialog {...props} />);
    fireEvent.change(screen.getByTestId("cell-c1"), { target: { value: "b" } });
    await waitFor(() => expect(toast.success).toHaveBeenCalledTimes(1));
    onWriteCell.mockResolvedValueOnce(false);
    await lastToastOptions()[1].action.onClick();
    expect(toast).not.toHaveBeenCalledWith("Nom rétabli");
    expect(toast.error).toHaveBeenCalledWith("Nom non enregistré");
    // entry kept: a retry of undo still restores "a"
    await lastToastOptions()[1].action.onClick();
    expect(onWriteCell).toHaveBeenLastCalledWith("r1", "c1", "a", { silent: true });
    expect(toast).toHaveBeenCalledWith("Nom rétabli");
  });

  it("keeps the original value for undo across successive edits of the same cell", async () => {
    const { props, onWriteCell } = build();
    renderWithIntl(<RecordDialog {...props} />);
    fireEvent.change(screen.getByTestId("cell-c1"), { target: { value: "b" } });
    await waitFor(() => expect(toast.success).toHaveBeenCalledTimes(1));
    fireEvent.change(screen.getByTestId("cell-c1"), { target: { value: "c" } });
    await waitFor(() => expect(toast.success).toHaveBeenCalledTimes(2));
    const [, opts] = lastToastOptions();
    await opts.action.onClick();
    expect(onWriteCell).toHaveBeenLastCalledWith("r1", "c1", "a", { silent: true });
  });

  it("undo targets the row that was edited, not the row now displayed", async () => {
    const { props, onWriteCell } = build();
    const { rerender } = renderWithIntl(<RecordDialog {...props} />);
    fireEvent.change(screen.getByTestId("cell-c1"), { target: { value: "b" } });
    await waitFor(() => expect(toast.success).toHaveBeenCalled());
    const [, opts] = lastToastOptions();
    rerender(<RecordDialog {...props} row={mkRow("r2", { c1: "z" })} />);
    await opts.action.onClick();
    expect(onWriteCell).toHaveBeenLastCalledWith("r1", "c1", "a", { silent: true });
  });

  it("remounts the fields when the row changes", () => {
    const { props } = build();
    const { rerender } = renderWithIntl(<RecordDialog {...props} />);
    expect((screen.getByTestId("cell-c1") as HTMLInputElement).value).toBe("a");
    rerender(<RecordDialog {...props} row={mkRow("r2", { c1: "z" })} />);
    expect((screen.getByTestId("cell-c1") as HTMLInputElement).value).toBe("z");
  });

  it("renders the sections and aside slots with the slot context", () => {
    const { props } = build({
      sections: (ctx) => <p>S {ctx.row.id}</p>,
      aside: () => <p>A</p>,
    });
    renderWithIntl(<RecordDialog {...props} />);
    expect(screen.getByText("S r1")).toBeTruthy();
    expect(screen.getByText("A")).toBeTruthy();
  });

  it("passes nav, navigate and open in bases through", () => {
    const { props } = build({
      nav: { index: 1, total: 5, prevId: "p", nextId: "n", outOfList: false },
      entityLabel: "Dossier",
      openInBasesHref: "/bases/x",
      onNavigate: vi.fn(),
    });
    renderWithIntl(<RecordDialog {...props} />);
    expect(screen.getByText("Dossier 2 sur 5")).toBeTruthy();
    const link = screen.getByLabelText("Ouvrir dans Bases");
    expect(link.getAttribute("href")).toBe("/bases/x");
  });
});

describe("RecordDialog tabs keyboard", () => {
  it("Échap ferme le panneau quand le focus est sur un onglet", () => {
    const { props } = build({ databaseId: "d1" });
    renderWithIntl(<RecordDialog {...props} />);
    const tab = screen.getAllByRole("tab")[0];
    tab.focus();
    fireEvent.keyDown(tab, { key: "Escape" });
    expect(props.onClose).toHaveBeenCalled();
  });
});
