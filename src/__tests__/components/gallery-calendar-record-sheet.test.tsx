// @vitest-environment jsdom
import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { cleanup, fireEvent, screen } from "@testing-library/react";
import { toast } from "sonner";
import { GalleryView } from "@/components/bases/gallery-view";
import { CalendarView } from "@/components/bases/calendar-view";
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
const U4 = "44444444-4444-4444-8444-444444444444";

const columns = [
  { id: "t", name: "Nom", type: "text", config: {} },
  { id: "d", name: "Date", type: "date", config: {} },
] as unknown as DbColumn[];

function mkRow(id: string, name: string, date: string | null, position: number) {
  return {
    id,
    databaseId: "db",
    cells: { t: name, ...(date ? { d: date } : {}) },
    position,
    createdAt: "",
    updatedAt: "",
  } as unknown as DbRow;
}

function dayIso(day: number, hour = 12) {
  const now = new Date();
  return new Date(now.getFullYear(), now.getMonth(), day, hour).toISOString();
}

beforeEach(() => {
  searchString = "";
  window.history.replaceState(null, "", "/bases/db");
  vi.clearAllMocks();
});
afterEach(() => cleanup());

describe("GalleryView record sheet", () => {
  const rows = [mkRow(U1, "un", null, 0), mkRow(U2, "deux", null, 1), mkRow(U3, "trois", null, 2)];
  const renderGallery = () =>
    renderWithIntl(
      <GalleryView
        databaseId="db"
        spaceId="sp"
        viewId="v"
        viewConfig={{}}
        columns={columns}
        rows={rows}
        onRefresh={vi.fn()}
      />,
    );

  it("gallery: opens the sheet and navigates in card order", () => {
    renderGallery();
    fireEvent.click(screen.getByRole("button", { name: "Ouvrir la fiche deux" }));
    expect(screen.getByText("Fiche 2 sur 3")).toBeTruthy();
    fireEvent.keyDown(screen.getByRole("dialog"), { key: "ArrowLeft", altKey: true });
    expect(screen.getByText("Fiche 1 sur 3")).toBeTruthy();
    fireEvent.keyDown(screen.getByRole("dialog"), { key: "ArrowLeft", altKey: true });
    expect(screen.getByText("Fiche 1 sur 3")).toBeTruthy();
    expect(toast.info).toHaveBeenCalledWith("Vous êtes sur la première fiche de la liste");
  });

  it("gallery: unknown row param shows the not found sheet", () => {
    searchString = "row=99999999-9999-4999-8999-999999999999";
    renderGallery();
    expect(screen.getByText("Fiche introuvable")).toBeTruthy();
  });
});

describe("CalendarView record sheet", () => {
  // Days 3, 1, 2 in database order, plus one undated row.
  const rows = [
    mkRow(U1, "trois", dayIso(3), 0),
    mkRow(U2, "un", dayIso(1), 1),
    mkRow(U3, "deux", dayIso(2), 2),
    mkRow(U4, "sans date", null, 3),
  ];
  const renderCalendar = () =>
    renderWithIntl(
      <CalendarView
        columns={columns}
        rows={rows}
        databaseId="db"
        spaceId="sp"
        dateColumnId="d"
        titleColumnId="t"
      />,
    );

  it("calendar: navigates in chronological order among dated rows", () => {
    renderCalendar();
    fireEvent.click(screen.getAllByRole("button", { name: "Ouvrir la fiche un" })[0]);
    expect(screen.getByText("Fiche 1 sur 3")).toBeTruthy();
    fireEvent.keyDown(screen.getByRole("dialog"), { key: "ArrowRight", altKey: true });
    expect((screen.getByTestId("cell-t") as HTMLInputElement).value).toBe("deux");
    fireEvent.keyDown(screen.getByRole("dialog"), { key: "ArrowRight", altKey: true });
    expect((screen.getByTestId("cell-t") as HTMLInputElement).value).toBe("trois");
    expect(screen.getByText("Fiche 3 sur 3")).toBeTruthy();
  });

  it("calendar: opens a row without a date from the row param and keeps navigation out of list", () => {
    searchString = `row=${U4}`;
    renderCalendar();
    expect(screen.getByText("Hors de la liste affichée")).toBeTruthy();
    fireEvent.keyDown(screen.getByRole("dialog"), { key: "ArrowRight", altKey: true });
    expect((screen.getByTestId("cell-t") as HTMLInputElement).value).toBe("un");
  });
  it("calendar: orders rows of the same day by position, not by time", () => {
    const same = [mkRow(U1, "apres-midi", dayIso(5, 15), 0), mkRow(U2, "matin", dayIso(5, 9), 1)];
    renderWithIntl(
      <CalendarView columns={columns} rows={same} databaseId="db" spaceId="sp" dateColumnId="d" titleColumnId="t" />,
    );
    fireEvent.click(screen.getAllByRole("button", { name: "Ouvrir la fiche apres-midi" })[0]);
    expect(screen.getByText("Fiche 1 sur 2")).toBeTruthy();
    fireEvent.keyDown(screen.getByRole("dialog"), { key: "ArrowRight", altKey: true });
    expect((screen.getByTestId("cell-t") as HTMLInputElement).value).toBe("matin");
  });

  it("calendar: out of list with nothing before explains it is not the first record", () => {
    searchString = `row=${U4}`;
    renderCalendar();
    expect(screen.getByText("Aucune fiche avant dans la liste affichée")).toBeTruthy();
    expect(screen.queryByText("Première fiche de la liste")).toBeNull();
    fireEvent.keyDown(screen.getByRole("dialog"), { key: "ArrowLeft", altKey: true });
    expect(toast.info).toHaveBeenCalledWith("Aucune fiche avant dans la liste affichée");
  });
});
