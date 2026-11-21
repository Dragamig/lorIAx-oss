// @vitest-environment jsdom
import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { cleanup, fireEvent, screen, waitFor } from "@testing-library/react";
import { RowAside } from "@/components/bases/row-aside";
import { renderWithIntl } from "./support/render-intl";

const h = vi.hoisted(() => ({
  revisions: [] as string[],
  onChange: null as null | (() => void),
}));

vi.mock("@/components/bases/row-activity", () => ({
  RowActivity: ({ revision, onOpenTask }: { revision: string; onOpenTask?: (id: string) => void }) => {
    h.revisions.push(revision);
    return (
      <div>
        <span data-testid="activity">{revision}</span>
        <button type="button" onClick={() => onOpenTask?.("task-9")}>
          open-task
        </button>
      </div>
    );
  },
}));

vi.mock("@/components/bases/row-tasks", () => ({
  RowTasks: ({ onChange, focusTaskId }: { onChange: () => void; focusTaskId?: string | null }) => {
    h.onChange = onChange;
    return <div data-testid="tasks">{focusTaskId ?? ""}</div>;
  },
}));

let openCount = 0;

function stubFetch() {
  vi.stubGlobal(
    "fetch",
    vi.fn(() =>
      Promise.resolve(
        new Response(JSON.stringify({
          tasks: Array.from({ length: openCount }, (_, i) => ({
            id: `t${i}`, title: `T${i}`, status: "open", dueAt: null, assignee: null, createdBy: "u1", createdAt: "2026-11-14T10:00:00.000Z",
          })),
          openCount,
          permission: "editor",
        }), {
          status: 200,
          headers: { "Content-Type": "application/json" },
        }),
      ),
    ),
  );
}

const renderAside = () =>
  renderWithIntl(<RowAside databaseId="d1" rowId="r1" revision="{}" columns={[]} />);

beforeEach(() => {
  h.revisions = [];
  h.onChange = null;
  openCount = 0;
  stubFetch();
});
afterEach(() => {
  cleanup();
  vi.unstubAllGlobals();
});

describe("RowAside", () => {
  it("deux onglets, Activité sélectionné par défaut", () => {
    renderAside();
    const tabs = screen.getAllByRole("tab");
    expect(tabs).toHaveLength(2);
    expect(tabs[0].getAttribute("aria-selected")).toBe("true");
    expect(screen.getByTestId("activity")).toBeTruthy();
  });

  it("le badge affiche le nombre de tâches ouvertes, aria-label au pluriel", async () => {
    openCount = 3;
    renderAside();
    // Onglet Tâches fermé : le compteur est quand même chargé.
    const badge = await screen.findByTestId("open-tasks-badge");
    expect(badge.textContent).toBe("3");
    expect(screen.getByRole("tab", { name: "Tâches, 3 ouvertes" })).toBeTruthy();
  });

  it("badge absent à zéro", async () => {
    renderAside();
    await waitFor(() => expect(fetch).toHaveBeenCalled());
    expect(screen.queryByTestId("open-tasks-badge")).toBeNull();
    expect(screen.getByRole("tab", { name: "Tâches" })).toBeTruthy();
  });

  it("un changement de tâche incrémente la révision passée à RowActivity", async () => {
    renderAside();
    fireEvent.click(screen.getAllByRole("tab")[1]);
    await waitFor(() => expect(h.onChange).not.toBeNull());
    h.onChange!();
    fireEvent.click(screen.getAllByRole("tab")[0]);
    await waitFor(() => expect(screen.getByTestId("activity").textContent).toBe("{}:1"));
  });

  it("le badge se met à jour après un changement signalé", async () => {
    renderAside();
    fireEvent.click(screen.getAllByRole("tab")[1]);
    await waitFor(() => expect(h.onChange).not.toBeNull());
    openCount = 2;
    h.onChange!();
    expect((await screen.findByTestId("open-tasks-badge")).textContent).toBe("2");
  });

  it("ouvrir une tâche depuis l'activité bascule sur l'onglet Tâches et la met en focus", async () => {
    renderAside();
    fireEvent.click(screen.getByRole("button", { name: "open-task" }));
    await waitFor(() => expect(screen.getAllByRole("tab")[1].getAttribute("aria-selected")).toBe("true"));
    expect(screen.getByTestId("tasks").textContent).toBe("task-9");
  });

  it("le panneau Activité reste monté quand on change d'onglet", () => {
    renderAside();
    fireEvent.click(screen.getAllByRole("tab")[1]);
    expect(document.querySelector('[data-testid="activity"]')).not.toBeNull();
  });
});
