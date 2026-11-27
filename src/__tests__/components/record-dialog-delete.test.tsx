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
  CellEditor: () => <input />,
}));

const columns = [{ id: "c1", name: "Nom", type: "text" }] as unknown as DbColumn[];
const row = { id: "r1", databaseId: "d1", cells: { c1: "Acme" }, position: 0 } as unknown as DbRow;
const deletedRows = [{ id: "r1", cells: { c1: "Acme" }, position: 0 }];

let fetchMock: ReturnType<typeof vi.fn>;
const json = (body: unknown) =>
  Promise.resolve(new Response(JSON.stringify(body), { status: 200, headers: { "Content-Type": "application/json" } }));

beforeEach(() => {
  vi.clearAllMocks();
  fetchMock = vi.fn((url: string, init?: RequestInit) => {
    if (init?.method === "DELETE") return json({ ok: true, deleted: deletedRows });
    if (init?.method === "POST") return json({ ok: true });
    return json({ items: [], nextCursor: null, canClear: false, tasks: [], openCount: 0, permission: "editor" });
  });
  vi.stubGlobal("fetch", fetchMock);
});
afterEach(() => {
  cleanup();
  vi.unstubAllGlobals();
});

function setup(over: Partial<RecordDialogProps> = {}) {
  const onClose = vi.fn();
  const onChanged = vi.fn();
  const props: RecordDialogProps = {
    row,
    columns,
    spaceId: "s",
    databaseId: "d1",
    relationData: {} as RecordDialogProps["relationData"],
    onWriteCell: vi.fn(),
    onClose,
    deletion: { onChanged },
    ...over,
  };
  renderWithIntl(<RecordDialog {...props} />);
  return { onClose, onChanged };
}

const deleteCalls = () => fetchMock.mock.calls.filter(([, init]) => (init as RequestInit | undefined)?.method === "DELETE");

describe("RecordDialog suppression", () => {
  it("ouvre la modale de confirmation sans appeler l'API", () => {
    setup();
    fireEvent.click(screen.getByRole("button", { name: "Supprimer la fiche" }));
    expect(screen.getByText("Supprimer cette fiche ?")).toBeTruthy();
    expect(deleteCalls()).toHaveLength(0);
  });

  it("annuler ferme la modale sans appel DELETE", async () => {
    const { onClose } = setup();
    fireEvent.click(screen.getByRole("button", { name: "Supprimer la fiche" }));
    fireEvent.click(screen.getByRole("button", { name: "Annuler" }));
    await waitFor(() => expect(screen.queryByText("Supprimer cette fiche ?")).toBeNull());
    expect(deleteCalls()).toHaveLength(0);
    expect(onClose).not.toHaveBeenCalled();
  });

  it("confirmer appelle DELETE, ferme le panneau et rafraîchit", async () => {
    const { onClose, onChanged } = setup();
    fireEvent.click(screen.getByRole("button", { name: "Supprimer la fiche" }));
    fireEvent.click(screen.getByRole("button", { name: "Supprimer" }));
    await waitFor(() => expect(onClose).toHaveBeenCalled());
    const [url, init] = deleteCalls()[0];
    expect(url).toBe("/api/databases/d1/rows");
    expect(JSON.parse((init as RequestInit).body as string)).toEqual({ rowIds: ["r1"] });
    expect(onChanged).toHaveBeenCalledTimes(1);
    expect(toast.success).toHaveBeenCalledWith("Fiche supprimée", expect.anything());
  });

  it("l'action Annuler du toast appelle restore puis rafraîchit", async () => {
    const { onClose, onChanged } = setup();
    fireEvent.click(screen.getByRole("button", { name: "Supprimer la fiche" }));
    fireEvent.click(screen.getByRole("button", { name: "Supprimer" }));
    await waitFor(() => expect(onClose).toHaveBeenCalled());
    const opts = (toast.success as unknown as ReturnType<typeof vi.fn>).mock.calls[0][1] as {
      action: { onClick: () => Promise<void> };
    };
    await opts.action.onClick();
    const restore = fetchMock.mock.calls.find(([u]) => String(u).endsWith("/rows/restore"));
    expect(restore).toBeTruthy();
    expect(JSON.parse((restore![1] as RequestInit).body as string)).toEqual({ rows: deletedRows });
    expect(onChanged).toHaveBeenCalledTimes(2);
  });

  it("échec du DELETE : toast d'erreur, panneau ouvert", async () => {
    fetchMock.mockImplementation((_u: string, init?: RequestInit) =>
      init?.method === "DELETE"
        ? Promise.resolve(new Response("{}", { status: 500 }))
        : json({ items: [], nextCursor: null, canClear: false }),
    );
    const { onClose, onChanged } = setup();
    fireEvent.click(screen.getByRole("button", { name: "Supprimer la fiche" }));
    fireEvent.click(screen.getByRole("button", { name: "Supprimer" }));
    await waitFor(() => expect(toast.error).toHaveBeenCalledWith("Impossible de supprimer la fiche"));
    expect(onClose).not.toHaveBeenCalled();
    expect(onChanged).not.toHaveBeenCalled();
  });

  it("lecture seule : bouton désactivé, pas de modale", () => {
    setup({ deletion: { onChanged: vi.fn(), readOnly: true } });
    const btn = screen.getByRole("button", { name: "Supprimer la fiche" });
    expect(btn.getAttribute("aria-disabled")).toBe("true");
    fireEvent.click(btn);
    expect(screen.queryByText("Supprimer cette fiche ?")).toBeNull();
  });

  it("sans prop deletion : pas de bouton", () => {
    setup({ deletion: undefined });
    expect(screen.queryByRole("button", { name: "Supprimer la fiche" })).toBeNull();
  });
});
