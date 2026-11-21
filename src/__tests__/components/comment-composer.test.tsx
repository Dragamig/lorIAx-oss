// @vitest-environment jsdom
import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { act, cleanup, fireEvent, screen, waitFor } from "@testing-library/react";
import { toast } from "sonner";
import { CommentComposer } from "@/components/bases/comment-composer";
import { RowActivity } from "@/components/bases/row-activity";
import { renderWithIntl } from "./support/render-intl";

vi.mock("sonner", () => {
  const fn = Object.assign(vi.fn(), { info: vi.fn(), success: vi.fn(), error: vi.fn() });
  return { toast: fn };
});

const UID = "11111111-1111-4111-8111-111111111111";
const fetchMock = vi.fn();
const json = (b: unknown, status = 200) =>
  Promise.resolve(new Response(JSON.stringify(b), { status, headers: { "Content-Type": "application/json" } }));

function mount(over: Partial<React.ComponentProps<typeof CommentComposer>> = {}) {
  const onPublished = vi.fn();
  const onUndo = vi.fn().mockResolvedValue(undefined);
  renderWithIntl(
    <CommentComposer databaseId="d1" rowId="r1" permission="editor" onPublished={onPublished} onUndo={onUndo} {...over} />,
  );
  return { onPublished, onUndo };
}
const area = () => screen.getByRole("combobox") as HTMLTextAreaElement;
const btn = () => screen.getByRole("button", { name: "Commenter" }) as HTMLButtonElement;
const type = (v: string) => fireEvent.change(area(), { target: { value: v, selectionStart: v.length } });
const posts = () => fetchMock.mock.calls.filter((c) => c[1]?.method === "POST");

beforeEach(() => {
  vi.clearAllMocks();
  fetchMock.mockReset();
  vi.stubGlobal("fetch", fetchMock);
});
afterEach(() => {
  cleanup();
  vi.useRealTimers();
  vi.unstubAllGlobals();
});

describe("CommentComposer", () => {
  it("Ctrl+Entrée publie et vide la zone", async () => {
    fetchMock.mockReturnValue(json({ comment: { id: "c1" } }, 201));
    const { onPublished } = mount();
    type("Bonjour");
    fireEvent.keyDown(area(), { key: "Enter", ctrlKey: true });
    await waitFor(() => expect(onPublished).toHaveBeenCalledWith("c1"));
    expect(area().value).toBe("");
    expect(JSON.parse(posts()[0][1].body)).toEqual({ body: "Bonjour" });
  });

  it("bouton désactivé quand la zone est vide", () => {
    mount();
    expect(btn().disabled).toBe(true);
    type("x");
    expect(btn().disabled).toBe(false);
  });

  it("viewer : bouton désactivé, zone en lecture seule", () => {
    mount({ permission: "viewer" });
    expect(area().readOnly).toBe(true);
    expect(btn().disabled).toBe(true);
  });

  it("Ctrl+Entrée répété pendant l'envoi : une seule requête POST", async () => {
    let resolve!: (r: Response) => void;
    fetchMock.mockReturnValue(new Promise<Response>((r) => (resolve = r)));
    mount();
    type("Bonjour");
    fireEvent.keyDown(area(), { key: "Enter", ctrlKey: true });
    fireEvent.keyDown(area(), { key: "Enter", ctrlKey: true });
    fireEvent.click(btn());
    expect(posts()).toHaveLength(1);
    await act(async () => resolve(new Response(JSON.stringify({ comment: { id: "c1" } }), { status: 201 })));
  });

  it("échec : toast d'erreur et le texte reste", async () => {
    fetchMock.mockReturnValue(json({ error: "x" }, 500));
    mount();
    type("Bonjour");
    fireEvent.click(btn());
    await waitFor(() => expect(toast.error).toHaveBeenCalledWith("Impossible de publier le commentaire"));
    expect(area().value).toBe("Bonjour");
  });

  it("succès : toast avec Annuler qui appelle la suppression", async () => {
    fetchMock.mockReturnValue(json({ comment: { id: "c9" } }, 201));
    const { onUndo } = mount();
    type("Bonjour");
    fireEvent.click(btn());
    await waitFor(() => expect(toast.success).toHaveBeenCalled());
    const [label, opts] = (toast.success as ReturnType<typeof vi.fn>).mock.calls[0];
    expect(label).toBe("Commentaire publié");
    opts.action.onClick();
    expect(onUndo).toHaveBeenCalledWith("c9");
  });

  it("@ ouvre la liste, flèches et Entrée insèrent le balisage", async () => {
    vi.useFakeTimers();
    fetchMock.mockImplementation((url: string) =>
      String(url).includes("/mentionable")
        ? json([
            { id: "22222222-2222-4222-8222-222222222222", name: "Ana", avatarUrl: null },
            { id: UID, name: "Bob", avatarUrl: null },
          ])
        : json({ comment: { id: "c1" } }, 201),
    );
    mount();
    type("Salut @");
    await act(async () => {
      await vi.advanceTimersByTimeAsync(300);
    });
    expect(screen.getByRole("listbox")).toBeTruthy();
    expect(area().getAttribute("aria-expanded")).toBe("true");
    fireEvent.keyDown(area(), { key: "ArrowDown" });
    expect(area().getAttribute("aria-activedescendant")).toBe(screen.getAllByRole("option")[1].id);
    fireEvent.keyDown(area(), { key: "Enter" });
    expect(area().value).toBe("Salut @Bob ");
    expect(screen.queryByRole("listbox")).toBeNull();
    fireEvent.keyDown(area(), { key: "Enter", ctrlKey: true });
    await act(async () => {
      await vi.advanceTimersByTimeAsync(0);
    });
    expect(JSON.parse(posts()[0][1].body).body).toBe(`Salut @[Bob](user:${UID})`);
  });

  it("anti-rebond : une seule requête pour une frappe rapide", async () => {
    vi.useFakeTimers();
    fetchMock.mockReturnValue(json([]));
    mount();
    type("@a");
    type("@an");
    type("@ana");
    await act(async () => {
      await vi.advanceTimersByTimeAsync(300);
    });
    expect(fetchMock).toHaveBeenCalledTimes(1);
    expect(String(fetchMock.mock.calls[0][0])).toContain("q=ana");
  });

  it("Échap ferme la liste sans fermer le panneau", async () => {
    vi.useFakeTimers();
    fetchMock.mockReturnValue(json([{ id: UID, name: "Bob", avatarUrl: null }]));
    mount();
    const outer = vi.fn();
    document.addEventListener("keydown", outer);
    type("@");
    await act(async () => {
      await vi.advanceTimersByTimeAsync(300);
    });
    fireEvent.keyDown(area(), { key: "Escape" });
    expect(screen.queryByRole("listbox")).toBeNull();
    expect(outer).not.toHaveBeenCalled();
    fireEvent.keyDown(area(), { key: "Escape" });
    expect(outer).toHaveBeenCalledTimes(1);
    document.removeEventListener("keydown", outer);
  });

  it("compteur visible à 4500 caractères, bouton bloqué au-delà de 5000", () => {
    mount();
    type("a".repeat(4499));
    expect(screen.queryByText(/\/ 5000/)).toBeNull();
    type("a".repeat(4500));
    expect(screen.getByText("4500 / 5000")).toBeTruthy();
    type("a".repeat(5001));
    expect(btn().disabled).toBe(true);
  });
});

describe("CommentComposer, corrections", () => {
  const A = "22222222-2222-4222-8222-222222222222";
  async function pickFrom(list: { id: string; name: string }[], index: number, before: string) {
    fetchMock.mockReturnValue(json(list.map((c) => ({ ...c, avatarUrl: null }))));
    type(area().value + before + "@");
    await act(async () => {
      await vi.advanceTimersByTimeAsync(300);
    });
    for (let i = 0; i < index; i++) fireEvent.keyDown(area(), { key: "ArrowDown" });
    fireEvent.keyDown(area(), { key: "Enter" });
  }
  async function send() {
    fetchMock.mockReturnValue(json({ comment: { id: "c1" } }, 201));
    fireEvent.keyDown(area(), { key: "Enter", ctrlKey: true });
    await act(async () => {
      await vi.advanceTimersByTimeAsync(0);
    });
    return JSON.parse(posts()[0][1].body).body as string;
  }

  it("IME : Entrée pendant une composition ne choisit ni ne publie", async () => {
    vi.useFakeTimers();
    mount();
    fetchMock.mockReturnValue(json([{ id: UID, name: "Bob", avatarUrl: null }]));
    type("@");
    await act(async () => {
      await vi.advanceTimersByTimeAsync(300);
    });
    fireEvent.keyDown(area(), { key: "Enter", keyCode: 229 });
    expect(area().value).toBe("@");
    fireEvent.keyDown(area(), { key: "Enter", ctrlKey: true, keyCode: 229 });
    expect(posts()).toHaveLength(0);
  });

  it("mentions placées dans l'ordre inverse du choix : toutes deux balisées", async () => {
    vi.useFakeTimers();
    mount();
    await pickFrom([{ id: A, name: "Ana" }, { id: UID, name: "Bob" }], 0, "");
    await pickFrom([{ id: A, name: "Ana" }, { id: UID, name: "Bob" }], 1, "x ");
    // Inverse le texte : « x @Bob ... » devient « @Bob x @Ana ».
    type("@Bob x @Ana ");
    expect(await send()).toBe(`@[Bob](user:${UID}) x @[Ana](user:${A})`);
  });

  it("« @Nom » tapé à la main sans choix reste du texte", async () => {
    vi.useFakeTimers();
    mount();
    type("Salut @Bob");
    expect(await send()).toBe("Salut @Bob");
  });

  it("« @Ana » ne coupe pas « @Anabelle »", async () => {
    vi.useFakeTimers();
    mount();
    await pickFrom([{ id: A, name: "Ana" }], 0, "");
    type("@Anabelle et @Ana ");
    expect(await send()).toBe(`@Anabelle et @[Ana](user:${A})`);
  });

  it("mention choisie supprimée puis retapée à la main reste du texte", async () => {
    vi.useFakeTimers();
    mount();
    await pickFrom([{ id: UID, name: "Bob" }], 0, "");
    type("");
    type("@Bob");
    expect(await send()).toBe("@Bob");
  });

  it("zone modifiée pendant l'envoi : non vidée", async () => {
    let resolve!: (r: Response) => void;
    fetchMock.mockReturnValue(new Promise<Response>((r) => (resolve = r)));
    mount();
    type("Bonjour");
    fireEvent.click(btn());
    type("Bonjour encore");
    await act(async () => resolve(new Response(JSON.stringify({ comment: { id: "c1" } }), { status: 201 })));
    expect(area().value).toBe("Bonjour encore");
  });

  it("astuce visible selon le droit", () => {
    mount();
    expect(screen.getByText(/pour publier/)).toBeTruthy();
    cleanup();
    mount({ permission: "viewer" });
    expect(screen.getByText("Accès en lecture seule sur cet espace")).toBeTruthy();
  });
});

describe("zone dans l'onglet", () => {
  const page = (items: unknown[]) => ({ items, nextCursor: null, canClear: false, permission: "editor", viewerId: "u1" });
  it("présente dans les états vide et erreur", async () => {
    fetchMock.mockReturnValueOnce(json(page([])));
    renderWithIntl(<RowActivity databaseId="d1" rowId="r1" revision="{}" columns={[]} />);
    expect(await screen.findByText(/Aucune modification/)).toBeTruthy();
    expect(screen.getByRole("combobox")).toBeTruthy();
    cleanup();
    fetchMock.mockReturnValueOnce(json({ error: "x" }, 500));
    renderWithIntl(<RowActivity databaseId="d1" rowId="r1" revision="{}" columns={[]} />);
    expect(await screen.findByRole("alert")).toBeTruthy();
    expect(screen.getByRole("combobox")).toBeTruthy();
  });
});
