// @vitest-environment jsdom
import { describe, it, expect, vi, afterEach } from "vitest";
import { cleanup, fireEvent, render, screen } from "@testing-library/react";
import { CellEditor } from "@/components/editor/extensions/database-block/database-cell-editor";
import { DatabaseTable } from "@/components/editor/extensions/database-block/database-table-view";
import type { DbColumn, DbData, DbRow } from "@/components/editor/extensions/database-block/types";
import { renderWithIntl } from "./support/render-intl";

vi.mock("next/navigation", () => ({
  useSearchParams: () => new URLSearchParams(""),
  useRouter: () => ({ push: vi.fn(), replace: vi.fn(), refresh: vi.fn() }),
  usePathname: () => "/bases/d",
}));
vi.mock("sonner", () => ({ toast: Object.assign(vi.fn(), { info: vi.fn(), success: vi.fn(), error: vi.fn() }) }));
vi.mock("@/components/editor/extensions/database-block/use-relation-data", () => ({ useRelationData: () => ({}) }));

afterEach(() => cleanup());

const col = (type: string) => ({ id: "c", name: "Col", type, config: {}, position: 0 }) as unknown as DbColumn;

describe.each([
  ["url", "https://..."],
  ["email", "nom@domaine.fr"],
])("%s cell editing", (type, placeholder) => {
  it("Escape reverts the draft and does not write", () => {
    const onChange = vi.fn();
    render(<CellEditor column={col(type)} value="a@b.fr" onChange={onChange} editable />);
    fireEvent.click(screen.getByTitle(type === "url" ? /Modifier/ : "Modifier l'e-mail"));
    const input = screen.getByPlaceholderText(placeholder) as HTMLInputElement;
    fireEvent.change(input, { target: { value: "changed" } });
    const ev = fireEvent.keyDown(input, { key: "Escape" });
    expect(ev).toBe(false); // preventDefault called
    expect(onChange).not.toHaveBeenCalled();
    expect(screen.queryByPlaceholderText(placeholder)).toBeNull();
  });

  it("empty cell starts editing from the keyboard", () => {
    render(<CellEditor column={col(type)} value="" onChange={vi.fn()} editable />);
    fireEvent.keyDown(screen.getByRole("button", { name: "Modifier" }), { key: "Enter" });
    expect(screen.getByPlaceholderText(placeholder)).toBeTruthy();
  });
});

describe("row click from click-to-edit cells", () => {
  const U1 = "11111111-1111-4111-8111-111111111111";
  const columns = [{ id: "u", name: "Site", type: "url", config: {}, position: 0 }] as unknown as DbColumn[];
  const rows = [{ id: U1, databaseId: "d", cells: {}, position: 0, createdAt: "", updatedAt: "" }] as unknown as DbRow[];
  const data: DbData = { id: "d", spaceId: "sp", name: "Base", description: null, columns, rows };

  it("a click on an empty URL cell starts editing and does not open the record", () => {
    const onOpenRecord = vi.fn();
    renderWithIntl(
      <DatabaseTable
        data={data}
        spaceId="sp"
        onRefresh={vi.fn()}
        viewMode="table"
        onViewModeChange={vi.fn()}
        onOpenRecord={onOpenRecord}
        openRecordLabel="Ouvrir la fiche"
      />,
    );
    const empty = document.querySelector('tbody td [role="button"][aria-label="Modifier"]') as HTMLElement;
    expect(empty).toBeTruthy();
    fireEvent.click(empty);
    expect(onOpenRecord).not.toHaveBeenCalled();
    expect(screen.getByPlaceholderText("https://...")).toBeTruthy();
  });
});
