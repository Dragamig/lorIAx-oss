// @vitest-environment jsdom
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { cleanup, fireEvent, render, screen, within } from "@testing-library/react";
import { NextIntlClientProvider } from "next-intl";
import fr from "../../../../../messages/fr.json";
import type { ActivityItem } from "@/lib/crm/activity-model";
import type { CrmActivityDto } from "@/lib/crm/use-crm-data";
import { ActivityFeed } from "./activity-feed";

vi.mock("sonner", () => ({ toast: Object.assign(vi.fn(), { success: vi.fn(), error: vi.fn(), info: vi.fn() }) }));
const hook = vi.hoisted(() => ({ state: {} as Record<string, unknown>, mutate: vi.fn() }));
vi.mock("@/lib/crm/use-crm-data", () => ({
  useCrmActivity: () => ({ ...hook.state, mutate: hook.mutate, key: "/api/crm/activity?databaseId=d&rowId=r" }),
}));

const interaction: ActivityItem = {
  kind: "interaction",
  id: "i1",
  date: "2030-01-02",
  interaction: { id: "i1", date: "2030-01-02", type: "Mail", title: "Mail de suivi", note: null, dealId: "r" },
};
const mail = {
  kind: "mail",
  id: "m1",
  date: "2030-01-02T10:00:00.000Z",
  status: "sent",
  error: null,
  retryable: false,
  mail: { id: "m1", subject: "Objet du mail", to: ["a@b.fr"], cc: [], bcc: [], bodyText: "Bonjour", bodyHtml: "", date: "2030-01-02T10:00:00.000Z", status: "sent", error: null },
} as unknown as ActivityItem;
const task: ActivityItem = { kind: "task", id: "t1", date: "2030-01-05", task: { id: "t1", title: "Relancer Claire", dueAt: "2030-01-05", status: "done" } };

const dto = (items: ActivityItem[]): CrmActivityDto => ({ items, role: "r", canLogInteraction: true, partial: [] });

function setup(header?: React.ReactNode) {
  render(
    <NextIntlClientProvider locale="fr" messages={fr}>
      <ActivityFeed databaseId="d" rowId="r" header={header} />
    </NextIntlClientProvider>,
  );
}
const pressed = (name: string) => screen.getByRole("button", { name }).getAttribute("aria-pressed");

beforeEach(() => {
  hook.mutate.mockReset();
  hook.state = { data: dto([task, interaction, mail]), error: undefined, isLoading: false };
});
afterEach(cleanup);

describe("ActivityFeed", () => {
  it("partial non vide : bandeau status avec Réessayer qui revalide", () => {
    hook.state = { data: { ...dto([task]), partial: ["mails"] }, error: undefined, isLoading: false };
    setup();
    const banner = screen.getByRole("status");
    expect(banner.textContent).toContain("Une partie de l'activité n'a pas pu être chargée");
    fireEvent.click(within(banner).getByRole("button", { name: "Réessayer" }));
    expect(hook.mutate).toHaveBeenCalled();
  });

  it("partial vide : aucun bandeau", () => {
    setup();
    expect(screen.queryByTestId("fiche-activity-partial")).toBeNull();
  });

  it("affiche interaction et mail lié ensemble, dans l'ordre fourni", () => {
    setup();
    const list = screen.getByRole("list", { name: fr.crm.fiche.activity.listAria });
    expect(within(list).getAllByRole("listitem").length).toBeGreaterThanOrEqual(3);
    expect(screen.getByText("Mail de suivi")).toBeTruthy();
    expect(screen.getByText("Objet du mail")).toBeTruthy();
    expect(screen.getByText("Relancer Claire")).toBeTruthy();
  });

  it("filtres : chacun restreint le fil, aria-pressed suit", () => {
    setup();
    expect(pressed("Tout")).toBe("true");
    fireEvent.click(screen.getByRole("button", { name: "Interactions" }));
    expect(pressed("Interactions")).toBe("true");
    expect(screen.queryByText("Objet du mail")).toBeNull();
    expect(screen.getByText("Mail de suivi")).toBeTruthy();
    fireEvent.click(screen.getByRole("button", { name: "Mails" }));
    expect(screen.getByText("Objet du mail")).toBeTruthy();
    expect(screen.queryByText("Relancer Claire")).toBeNull();
    fireEvent.click(screen.getByRole("button", { name: "Tâches" }));
    expect(screen.getByText("Relancer Claire")).toBeTruthy();
    expect(screen.queryByText("Mail de suivi")).toBeNull();
  });

  it("filtres : une icône distincte par filtre", () => {
    setup();
    const group = screen.getByRole("group");
    const icons = Array.from(group.querySelectorAll("button svg")).map((el) => el.getAttribute("class") ?? "");
    expect(icons).toHaveLength(4);
    expect(new Set(icons.map((c) => c.split(" ").find((x) => x.startsWith("lucide-")))).size).toBe(4);
  });

  it("état vide", () => {
    hook.state = { data: dto([]), error: undefined, isLoading: false };
    setup();
    expect(screen.getByText("Aucune activité")).toBeTruthy();
  });

  it("état vide filtré", () => {
    hook.state = { data: dto([interaction]), error: undefined, isLoading: false };
    setup();
    fireEvent.click(screen.getByRole("button", { name: "Mails" }));
    expect(screen.getByText(fr.crm.fiche.activity.emptyFiltered)).toBeTruthy();
    expect(screen.queryByText("Aucune activité")).toBeNull();
  });

  it("chargement : squelette", () => {
    hook.state = { data: undefined, error: undefined, isLoading: true };
    setup();
    expect(screen.getByRole("status")).toBeTruthy();
    expect(screen.queryByRole("list")).toBeNull();
  });

  it("erreur : Réessayer relit la source", () => {
    hook.state = { data: undefined, error: new Error("x"), isLoading: false };
    setup();
    expect(screen.getByRole("alert").textContent).toContain(fr.crm.fiche.activity.loadError);
    fireEvent.click(screen.getByRole("button", { name: "Réessayer" }));
    expect(hook.mutate).toHaveBeenCalledTimes(1);
  });

  it("affiche l'en-tête fourni", () => {
    setup(<button>Ajouter ici</button>);
    expect(screen.getByRole("button", { name: "Ajouter ici" })).toBeTruthy();
  });
});
