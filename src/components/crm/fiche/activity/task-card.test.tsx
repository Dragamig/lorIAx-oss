// @vitest-environment jsdom
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react";
import { NextIntlClientProvider } from "next-intl";
import fr from "../../../../../messages/fr.json";
import { toTaskActivity } from "@/lib/crm/activity-model";
import { TaskCard } from "./task-card";

const toastApi = vi.hoisted(() => Object.assign(vi.fn(), { success: vi.fn(), error: vi.fn(), info: vi.fn() }));
vi.mock("sonner", () => ({ toast: toastApi }));
const actions = vi.hoisted(() => ({ toggleTaskDone: vi.fn() }));
vi.mock("@/lib/crm/activity-actions", () => actions);

const KEY = "/api/crm/activity?databaseId=d&rowId=r";
const item = toTaskActivity({ id: "t1", title: "Relancer Claire", dueAt: "2026-11-27" });

function setup(done = false, it = item) {
  render(
    <NextIntlClientProvider locale="fr" messages={fr}>
      <ul>
        <TaskCard item={it} activityKey={KEY} done={done} />
      </ul>
    </NextIntlClientProvider>,
  );
}

beforeEach(() => {
  actions.toggleTaskDone.mockReset().mockResolvedValue({ ok: true });
  for (const f of [toastApi.success, toastApi.error]) f.mockClear();
});
afterEach(cleanup);

describe("TaskCard", () => {
  it("affiche titre et échéance", () => {
    setup();
    expect(screen.getByText("Relancer Claire")).toBeTruthy();
    expect(screen.getByText(/Échéance/)).toBeTruthy();
  });

  it("Terminer : action done=true, toast de succès", async () => {
    setup();
    fireEvent.click(screen.getByRole("button", { name: "Terminer" }));
    await waitFor(() => expect(toastApi.success).toHaveBeenCalledWith(fr.crm.fiche.activity.task.completed));
    expect(actions.toggleTaskDone).toHaveBeenCalledWith("t1", true, KEY);
  });

  it("tâche terminée : Rouvrir, action done=false", async () => {
    setup(true);
    fireEvent.click(screen.getByRole("button", { name: "Rouvrir" }));
    await waitFor(() => expect(toastApi.success).toHaveBeenCalledWith(fr.crm.fiche.activity.task.reopened));
    expect(actions.toggleTaskDone).toHaveBeenCalledWith("t1", false, KEY);
  });

  it("échec : toast d'erreur", async () => {
    actions.toggleTaskDone.mockResolvedValue({ ok: false, code: "network" });
    setup();
    fireEvent.click(screen.getByRole("button", { name: "Terminer" }));
    await waitFor(() => expect(toastApi.error).toHaveBeenCalledWith(fr.crm.fiche.activity.task.error));
  });

  it("canToggle false : bouton désactivé avec la raison, aucune action", () => {
    setup(false, toTaskActivity({ id: "t2", title: "Autre", dueAt: null, canToggle: false }));
    const btn = screen.getByRole("button", { name: "Terminer" });
    expect(btn.getAttribute("aria-disabled")).toBe("true");
    fireEvent.click(btn);
    expect(actions.toggleTaskDone).not.toHaveBeenCalled();
  });
});
