// @vitest-environment jsdom
import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { act, cleanup, fireEvent, screen, waitFor } from "@testing-library/react";
import { toast } from "sonner";
import { RowTasks } from "@/components/bases/row-tasks";
import type { UseRowTasksResult } from "@/components/bases/use-row-tasks";
import type { RowTaskDto } from "@/lib/databases/row-tasks";
import type { PermissionLevel } from "@/types";
import { renderWithIntl } from "./support/render-intl";

vi.mock("sonner", () => {
  const fn = Object.assign(vi.fn(), { info: vi.fn(), success: vi.fn(), error: vi.fn() });
  return { toast: fn };
});

const fetchMock = vi.fn();
const json = (b: unknown, status = 200) =>
  Promise.resolve(new Response(JSON.stringify(b), { status, headers: { "Content-Type": "application/json" } }));

const todayKey = () => {
  const d = new Date();
  const p = (n: number) => String(n).padStart(2, "0");
  return `${d.getFullYear()}-${p(d.getMonth() + 1)}-${p(d.getDate())}`;
};
const dayOffset = (n: number) => {
  const d = new Date();
  d.setDate(d.getDate() + n);
  const p = (x: number) => String(x).padStart(2, "0");
  return `${d.getFullYear()}-${p(d.getMonth() + 1)}-${p(d.getDate())}T00:00:00.000Z`;
};

function task(over: Partial<RowTaskDto> = {}): RowTaskDto {
  return {
    id: "t1",
    title: "Rappeler",
    status: "open",
    dueAt: null,
    assignee: null,
    createdBy: "u1",
    createdAt: "2026-11-14T10:00:00.000Z",
    ...over,
  };
}

function mount(
  tasks: RowTaskDto[],
  opts: { status?: UseRowTasksResult["status"]; permission?: PermissionLevel; focusTaskId?: string | null } = {},
) {
  const state = { tasks };
  const reload = vi.fn().mockResolvedValue(undefined);
  const setTasks = vi.fn((u: (p: RowTaskDto[]) => RowTaskDto[]) => {
    state.tasks = u(state.tasks);
  });
  const onChange = vi.fn();
  const build = (): UseRowTasksResult => ({
    status: opts.status ?? "ready",
    tasks: state.tasks,
    openCount: 0,
    permission: opts.permission ?? "editor",
    reload,
    setTasks,
  });
  const view = renderWithIntl(
    <RowTasks databaseId="d1" rowId="r1" rowTasks={build()} onChange={onChange} focusTaskId={opts.focusTaskId} />,
  );
  return { reload, setTasks, onChange, view, state };
}

beforeEach(() => {
  vi.clearAllMocks();
  fetchMock.mockReset();
  fetchMock.mockImplementation((url: string) =>
    String(url).includes("/mentionable")
      ? json([{ id: "u2", name: "Ana", avatarUrl: null }])
      : json({}),
  );
  vi.stubGlobal("fetch", fetchMock);
});
afterEach(() => {
  cleanup();
  vi.unstubAllGlobals();
});

const calls = (method: string) => fetchMock.mock.calls.filter((c) => (c[1]?.method ?? "GET") === method);

describe("RowTasks", () => {
  it("états chargement, vide avec bouton Ajouter, erreur puis Réessayer", async () => {
    mount([], { status: "loading" });
    expect(screen.getByText("Chargement des tâches")).toBeTruthy();
    cleanup();
    mount([]);
    expect(screen.getByText("Aucune tâche liée à cette fiche")).toBeTruthy();
    expect(screen.getAllByRole("button", { name: "Ajouter une tâche" }).length).toBeGreaterThan(0);
    cleanup();
    const { reload } = mount([], { status: "error" });
    fireEvent.click(screen.getByRole("button", { name: "Réessayer" }));
    expect(reload).toHaveBeenCalled();
  });

  it("ordre ouvertes, en cours, terminées, annulées repliées", () => {
    mount([
      task({ id: "a", title: "Annulee", status: "cancelled" }),
      task({ id: "b", title: "Finie", status: "done" }),
      task({ id: "c", title: "EnCours", status: "in_progress" }),
      task({ id: "d", title: "Ouverte", status: "open" }),
    ]);
    const titles = screen.getAllByTestId("row-task-title").map((e) => e.textContent);
    expect(titles).toEqual(["Ouverte", "EnCours", "Finie"]);
    const group = screen.getByText("1 tâche annulée");
    expect(screen.queryByText("Annulee")).toBeNull();
    fireEvent.click(group);
    expect(screen.getByText("Annulee")).toBeTruthy();
  });

  it("cocher appelle PATCH done, toast avec Annuler, Annuler rappelle PATCH open", async () => {
    const { onChange } = mount([task()]);
    fetchMock.mockImplementation(() => json({ task: task({ status: "done" }) }));
    fireEvent.click(screen.getByRole("checkbox", { name: "Marquer « Rappeler » comme terminée" }));
    await waitFor(() => expect(calls("PATCH")).toHaveLength(1));
    expect(JSON.parse(calls("PATCH")[0][1].body)).toEqual({ status: "done" });
    expect(calls("PATCH")[0][0]).toBe("/api/databases/d1/rows/r1/tasks/t1");
    await waitFor(() => expect(toast.success).toHaveBeenCalled());
    expect(onChange).toHaveBeenCalled();
    const opts = (toast.success as ReturnType<typeof vi.fn>).mock.calls[0][1];
    expect(opts.action.label).toBe("Annuler");
    fetchMock.mockImplementation(() => json({ task: task() }));
    await act(async () => opts.action.onClick());
    await waitFor(() => expect(calls("PATCH")).toHaveLength(2));
    expect(JSON.parse(calls("PATCH")[1][1].body)).toEqual({ status: "open" });
  });

  it("ajouter : Entrée crée la tâche, toast avec Annuler qui appelle DELETE", async () => {
    const { onChange } = mount([]);
    fireEvent.click(screen.getAllByRole("button", { name: "Ajouter une tâche" })[0]);
    const input = screen.getByLabelText("Titre");
    fireEvent.change(input, { target: { value: "Nouvelle" } });
    fetchMock.mockImplementation((url: string) =>
      String(url).includes("/mentionable") ? json([]) : json({ task: task({ id: "t9", title: "Nouvelle" }) }),
    );
    fireEvent.keyDown(input, { key: "Enter" });
    await waitFor(() => expect(calls("POST")).toHaveLength(1));
    expect(JSON.parse(calls("POST")[0][1].body)).toEqual({ title: "Nouvelle", dueAt: null, assigneeId: null });
    await waitFor(() => expect(toast.success).toHaveBeenCalled());
    expect(onChange).toHaveBeenCalled();
    const opts = (toast.success as ReturnType<typeof vi.fn>).mock.calls[0][1];
    await act(async () => opts.action.onClick());
    await waitFor(() => expect(calls("DELETE")).toHaveLength(1));
    expect(calls("DELETE")[0][0]).toBe("/api/databases/d1/rows/r1/tasks/t9");
  });

  it("titre vide : validation, aucune requête", async () => {
    mount([]);
    fireEvent.click(screen.getAllByRole("button", { name: "Ajouter une tâche" })[0]);
    fireEvent.keyDown(screen.getByLabelText("Titre"), { key: "Enter" });
    expect(calls("POST")).toHaveLength(0);
    expect(screen.getByRole("alert").textContent).toContain("titre");
  });

  it("viewer : bouton Ajouter désactivé avec info-bulle explicative et cases désactivées", () => {
    mount([task()], { permission: "viewer" });
    const add = screen.getAllByRole("button", { name: "Ajouter une tâche" })[0];
    expect(add.getAttribute("aria-disabled")).toBe("true");
    fireEvent.click(add);
    expect(screen.queryByLabelText("Titre")).toBeNull();
    expect(screen.getByRole("checkbox").getAttribute("aria-disabled")).toBe("true");
    fireEvent.click(screen.getByRole("checkbox"));
    expect(calls("PATCH")).toHaveLength(0);
  });

  it("échéance du jour non marquée en retard, échéance passée marquée par le mot", () => {
    mount([
      task({ id: "a", title: "Auj", dueAt: `${todayKey()}T00:00:00.000Z` }),
      task({ id: "b", title: "Hier", dueAt: dayOffset(-3) }),
    ]);
    const rows = screen.getAllByTestId("row-task");
    expect(rows[0].textContent).not.toContain("En retard");
    expect(rows[1].textContent).toContain("En retard");
  });

  it("assigné non éligible (422) : message ineligible, formulaire conservé", async () => {
    mount([]);
    fireEvent.click(screen.getAllByRole("button", { name: "Ajouter une tâche" })[0]);
    const input = screen.getByLabelText("Titre");
    fireEvent.change(input, { target: { value: "X" } });
    fetchMock.mockImplementation((url: string) =>
      String(url).includes("/mentionable") ? json([]) : json({ error: "no" }, 422),
    );
    fireEvent.keyDown(input, { key: "Enter" });
    await waitFor(() => expect(toast.error).toHaveBeenCalledWith("Cette personne n'a pas accès à la fiche"));
    expect((screen.getByLabelText("Titre") as HTMLInputElement).value).toBe("X");
  });

  it("Échap ferme le formulaire sans remonter", () => {
    mount([]);
    const outer = vi.fn();
    document.addEventListener("keydown", outer);
    fireEvent.click(screen.getAllByRole("button", { name: "Ajouter une tâche" })[0]);
    fireEvent.keyDown(screen.getByLabelText("Titre"), { key: "Escape" });
    expect(screen.queryByLabelText("Titre")).toBeNull();
    document.removeEventListener("keydown", outer);
  });

  it("toutes les lignes ont le même gabarit", () => {
    mount([task({ id: "a", title: "A" }), task({ id: "b", title: "B".repeat(300), dueAt: dayOffset(2), assignee: { id: "u2", name: "Ana" } })]);
    const rows = screen.getAllByTestId("row-task");
    expect(rows[0].className).toBe(rows[1].className);
    expect(rows[0].className).toContain("h-");
  });

  it("assigné sans nom : repli affiché", () => {
    mount([task({ assignee: { id: "u2", name: "" } })]);
    expect(screen.getByTestId("row-task").textContent).toContain("Non assignée");
  });

  it("focusTaskId place le focus", async () => {
    mount([task({ id: "a" }), task({ id: "b", title: "Cible" })], { focusTaskId: "b" });
    await waitFor(() => expect(document.activeElement?.getAttribute("data-task-id")).toBe("b"));
  });

  it("assigné : la saisie filtre par q (debounce) et choisir renseigne assigneeId", async () => {
    mount([]);
    fireEvent.click(screen.getAllByRole("button", { name: "Ajouter une tâche" })[0]);
    const combo = screen.getByRole("combobox", { name: "Assigné à" });
    fireEvent.focus(combo);
    await waitFor(() => expect(screen.getByRole("option", { name: "Ana" })).toBeTruthy());
    fireEvent.change(combo, { target: { value: "An" } });
    fireEvent.change(combo, { target: { value: "Ana" } });
    await waitFor(() =>
      expect(fetchMock.mock.calls.some((c) => String(c[0]).includes("mentionable?limit=10&q=Ana"))).toBe(true),
    );
    expect(fetchMock.mock.calls.some((c) => String(c[0]).includes("q=An&"))).toBe(false);
    fireEvent.keyDown(combo, { key: "ArrowDown" });
    fireEvent.keyDown(combo, { key: "Enter" });
    expect(calls("POST")).toHaveLength(0);
    fireEvent.change(screen.getByLabelText("Titre"), { target: { value: "Z" } });
    fetchMock.mockImplementation(() => json({ task: task({ id: "t8", title: "Z" }) }));
    fireEvent.keyDown(screen.getByLabelText("Titre"), { key: "Enter" });
    await waitFor(() => expect(calls("POST")).toHaveLength(1));
    expect(JSON.parse(calls("POST")[0][1].body).assigneeId).toBe("u2");
  });

  it("assigné : Échap ferme la liste seulement", async () => {
    mount([]);
    fireEvent.click(screen.getAllByRole("button", { name: "Ajouter une tâche" })[0]);
    const combo = screen.getByRole("combobox", { name: "Assigné à" });
    fireEvent.focus(combo);
    await waitFor(() => expect(screen.getByRole("listbox")).toBeTruthy());
    fireEvent.keyDown(combo, { key: "Escape" });
    expect(screen.queryByRole("listbox")).toBeNull();
    expect(screen.getByLabelText("Titre")).toBeTruthy();
  });

  it("focusTaskId : cocher une autre tâche ensuite ne déplace pas le focus", async () => {
    const view = mount([task({ id: "a", title: "A" }), task({ id: "b", title: "Cible" })], { focusTaskId: "b" });
    await waitFor(() => expect(document.activeElement?.getAttribute("data-task-id")).toBe("b"));
    fetchMock.mockImplementation(() => json({ task: task({ id: "a", title: "A", status: "done" }) }));
    const box = screen.getByRole("checkbox", { name: "Marquer « A » comme terminée" });
    box.focus();
    fireEvent.click(box);
    await waitFor(() => expect(calls("PATCH")).toHaveLength(1));
    view.view.rerender(
      <RowTasks databaseId="d1" rowId="r1" rowTasks={{ status: "ready", tasks: [task({ id: "a", status: "done" }), task({ id: "b" })], openCount: 1, permission: "editor", reload: vi.fn(), setTasks: vi.fn() }} onChange={vi.fn()} focusTaskId="b" />,
    );
    expect(document.activeElement?.getAttribute("data-task-id")).not.toBe("b");
  });

  it("double clic sur la case : un seul PATCH", async () => {
    mount([task()]);
    let resolve: (r: Response) => void = () => {};
    fetchMock.mockImplementation(() => new Promise<Response>((r) => { resolve = r; }));
    const box = screen.getByRole("checkbox");
    fireEvent.click(box);
    fireEvent.click(box);
    expect(calls("PATCH")).toHaveLength(1);
    resolve(new Response(JSON.stringify({ task: task({ status: "done" }) }), { status: 200 }));
    await waitFor(() => expect(toast.success).toHaveBeenCalled());
  });
});
