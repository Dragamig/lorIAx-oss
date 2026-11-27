// @vitest-environment jsdom
/**
 * Écrans des tableaux de bord : lecteur sans bouton d'édition, renommage,
 * suppression confirmée, réordonnancement des widgets, toast explicite sur
 * refus de l'API.
 */
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { cleanup, fireEvent, screen, waitFor } from "@testing-library/react";
import { toast } from "sonner";
import { renderWithIntl } from "./support/render-intl";
import { DashboardClient } from "@/app/[locale]/(app)/dashboards/[id]/dashboard-client";
import { DashboardsListClient } from "@/app/[locale]/(app)/dashboards/dashboards-list-client";
import type { DashboardDef, DashboardWidgetDef } from "@/lib/dashboards/types";

const push = vi.fn();
const refresh = vi.fn();
vi.mock("@/i18n/routing", () => ({
  useRouter: () => ({ push, refresh }),
  Link: ({ href, children, className }: { href: string; children: React.ReactNode; className?: string }) => (
    <a href={href} className={className}>
      {children}
    </a>
  ),
}));
vi.mock("sonner", () => {
  const fn = Object.assign(vi.fn(), { info: vi.fn(), success: vi.fn(), error: vi.fn() });
  return { toast: fn };
});
// Recharts n'a pas sa place dans jsdom : les widgets sont des KPI.
vi.mock("recharts", () => ({}));

const SPACE = "11111111-1111-4111-8111-111111111111";
const DASH = { id: "d1", spaceId: SPACE, name: "Suivi", description: null } as unknown as DashboardDef;
const widget = (id: string, title: string, position: number): DashboardWidgetDef => ({
  id,
  dashboardId: "d1",
  databaseId: "db1",
  type: "kpi",
  title,
  position,
  size: "half",
  config: { filter: null, aggregate: { fn: "count" } },
});
const WIDGETS = [widget("w1", "Ouverts", 0), widget("w2", "Fermés", 1)];

const json = (body: unknown, status = 200) =>
  new Response(JSON.stringify(body), { status, headers: { "Content-Type": "application/json" } });
const calls: { url: string; method: string; body?: unknown }[] = [];
let override: ((url: string, method: string) => Response | undefined) | undefined;

beforeEach(() => {
  vi.clearAllMocks();
  calls.length = 0;
  override = undefined;
  vi.stubGlobal(
    "fetch",
    vi.fn(async (input: RequestInfo | URL, init?: RequestInit) => {
      const url = String(input);
      const method = init?.method ?? "GET";
      calls.push({ url, method, body: init?.body ? JSON.parse(String(init.body)) : undefined });
      const custom = override?.(url, method);
      if (custom) return custom;
      if (url.endsWith("/data")) return json({ w1: { kind: "kpi", value: 3 }, w2: { kind: "kpi", value: 5 } });
      if (method === "GET" && url === "/api/dashboards/d1") return json({ ...DASH, widgets: [WIDGETS[1]] });
      return json({ ok: true });
    })
  );
});
afterEach(() => {
  cleanup();
  vi.unstubAllGlobals();
});

describe("DashboardClient", () => {
  it("lecteur : aucune action d'édition", async () => {
    renderWithIntl(<DashboardClient dashboard={DASH} initialWidgets={WIDGETS} bases={[]} canEdit={false} />);
    await screen.findByText("3");
    expect(screen.getByText("Lecture seule")).toBeTruthy();
    expect(screen.queryByRole("button", { name: "Ajouter un widget" })).toBeNull();
    expect(screen.queryByRole("button", { name: "Renommer le tableau de bord" })).toBeNull();
    expect(screen.queryByRole("button", { name: "Supprimer le tableau de bord" })).toBeNull();
    expect(screen.queryByRole("button", { name: "Modifier" })).toBeNull();
    expect(screen.queryByRole("button", { name: "Déplacer après" })).toBeNull();
  });

  it("réordonne les widgets par PATCH widgetOrder", async () => {
    renderWithIntl(<DashboardClient dashboard={DASH} initialWidgets={WIDGETS} bases={[]} canEdit />);
    await screen.findByText("3");
    const after = screen.getAllByRole("button", { name: "Déplacer après" });
    expect((after[1] as HTMLButtonElement).disabled).toBe(true);
    fireEvent.click(after[0]);
    await waitFor(() =>
      expect(calls).toContainEqual({ url: "/api/dashboards/d1", method: "PATCH", body: { widgetOrder: ["w2", "w1"] } })
    );
    const titles = screen.getAllByText(/Ouverts|Fermés/).map((n) => n.textContent);
    expect(titles).toEqual(["Fermés", "Ouverts"]);
  });

  it("rétablit l'ordre et affiche un toast explicite si l'API refuse", async () => {
    override = (url, method) => (method === "PATCH" ? json({ error: "Accès refusé" }, 403) : undefined);
    renderWithIntl(<DashboardClient dashboard={DASH} initialWidgets={WIDGETS} bases={[]} canEdit />);
    await screen.findByText("3");
    fireEvent.click(screen.getAllByRole("button", { name: "Déplacer après" })[0]);
    await waitFor(() =>
      expect(toast.error).toHaveBeenCalledWith("Déplacement du widget impossible", {
        description: "Votre droit sur cet espace ne permet pas cette action (droit d'éditeur requis).",
      })
    );
    const titles = screen.getAllByText(/Ouverts|Fermés/).map((n) => n.textContent);
    expect(titles).toEqual(["Ouverts", "Fermés"]);
  });

  it("supprime un widget après confirmation", async () => {
    renderWithIntl(<DashboardClient dashboard={DASH} initialWidgets={WIDGETS} bases={[]} canEdit />);
    await screen.findByText("3");
    fireEvent.click(screen.getAllByRole("button", { name: "Supprimer" })[0]);
    expect(calls.some((c) => c.method === "DELETE")).toBe(false);
    await screen.findByText("Supprimer le widget « Ouverts » ? Cette action est définitive.");
    const confirm = screen.getAllByRole("button", { name: "Supprimer" }).at(-1)!;
    fireEvent.click(confirm);
    await waitFor(() =>
      expect(calls).toContainEqual({ url: "/api/dashboards/d1/widgets/w1", method: "DELETE", body: undefined })
    );
  });

  it("renomme puis supprime le tableau de bord", async () => {
    renderWithIntl(<DashboardClient dashboard={DASH} initialWidgets={WIDGETS} bases={[]} canEdit />);
    fireEvent.click(screen.getByRole("button", { name: "Renommer le tableau de bord" }));
    const input = screen.getByRole("textbox", { name: "Nouveau nom du tableau de bord" });
    fireEvent.change(input, { target: { value: "Suivi 2027" } });
    fireEvent.keyDown(input, { key: "Enter" });
    await screen.findByRole("heading", { name: "Suivi 2027" });
    expect(calls).toContainEqual({ url: "/api/dashboards/d1", method: "PATCH", body: { name: "Suivi 2027" } });

    fireEvent.click(screen.getByRole("button", { name: "Supprimer le tableau de bord" }));
    await screen.findByText(/Supprimer « Suivi 2027 » et tous ses widgets/);
    const confirm = screen.getAllByRole("button", { name: "Supprimer le tableau de bord" }).at(-1)!;
    fireEvent.click(confirm);
    await waitFor(() => expect(push).toHaveBeenCalledWith(`/dashboards?spaceId=${SPACE}`));
    expect(calls).toContainEqual({ url: "/api/dashboards/d1", method: "DELETE", body: undefined });
  });
});

describe("DashboardsListClient", () => {
  const SPACES = [
    { id: SPACE, name: "Alpha" },
    { id: "22222222-2222-4222-8222-222222222222", name: "Beta" },
  ];

  it("lecteur : ni création ni menu d'actions, sélecteur d'espace présent", () => {
    renderWithIntl(<DashboardsListClient spaceId={SPACE} spaces={SPACES} canEdit={false} initial={[DASH]} />);
    expect(screen.getByRole("combobox", { name: "Espace affiché" })).toBeTruthy();
    expect(screen.queryByRole("textbox")).toBeNull();
    expect(screen.queryByRole("button", { name: "Actions du tableau de bord" })).toBeNull();
    expect(screen.getByText(/Lecture seule/)).toBeTruthy();
  });

  it("éditeur : toast explicite si la création échoue", async () => {
    override = (url, method) =>
      method === "POST" ? json({ error: "Accès refusé" }, 403) : undefined;
    renderWithIntl(<DashboardsListClient spaceId={SPACE} spaces={SPACES} canEdit initial={[]} />);
    fireEvent.change(screen.getByRole("textbox"), { target: { value: "Nouveau" } });
    fireEvent.click(screen.getByRole("button", { name: "Créer un tableau de bord dans cet espace" }));
    await waitFor(() =>
      expect(toast.error).toHaveBeenCalledWith("Création du tableau de bord impossible", {
        description: "Votre droit sur cet espace ne permet pas cette action (droit d'éditeur requis).",
      })
    );
    expect(push).not.toHaveBeenCalled();
  });
});
