// @vitest-environment jsdom
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { cleanup, fireEvent, render, screen } from "@testing-library/react";
import { NextIntlClientProvider } from "next-intl";
import fr from "../../../../../../messages/fr.json";
import { AutomationsList } from "../automations-list";

vi.mock("sonner", () => ({ toast: Object.assign(vi.fn(), { success: vi.fn(), error: vi.fn() }) }));
vi.mock("next/navigation", () => ({
  useRouter: () => ({ refresh: vi.fn(), push: vi.fn(), replace: vi.fn() }),
  useSearchParams: () => new URLSearchParams(""),
  usePathname: () => "/automations",
}));

const fetchMock = vi.fn();

const item = {
  id: "a1",
  kind: "autonomous" as const,
  databaseId: null,
  databaseName: null,
  name: "Relance client",
  triggerType: "manual" as const,
  triggerConfig: {},
  actionType: "create_document" as const,
  actionConfig: { title: "Nouveau document" },
  graph: {
    nodes: [{ id: "n1", kind: "action" as const, actionType: "create_document", actionConfig: { title: "Doc" } }],
    edges: [],
  },
  triggerLabel: "Manuel (bouton)",
  actionLabel: "Créer un document",
  enabled: true,
  lastRunAt: null,
  lastRunStatus: null,
};

function renderList(canManage: boolean) {
  render(
    <NextIntlClientProvider locale="fr" messages={fr}>
      <AutomationsList items={[item]} bases={[]} currentSpaceId="s1" canManage={canManage} />
    </NextIntlClientProvider>
  );
  fireEvent.click(screen.getByText("Relance client", { selector: "span" }));
}

beforeEach(() => {
  fetchMock.mockReset();
  fetchMock.mockResolvedValue({ ok: true, json: async () => [] });
  vi.stubGlobal("fetch", fetchMock);
});
afterEach(() => {
  cleanup();
  vi.unstubAllGlobals();
});

describe("AutomationsList : actions de gestion selon le rôle", () => {
  it("sans le rôle : création, réglages et activation indisponibles avec la raison, consultation conservée", () => {
    renderList(false);

    const create = screen.getByRole("button", { name: /Nouvelle/ });
    expect(create.getAttribute("aria-disabled")).toBe("true");
    fireEvent.click(create);
    expect(screen.queryByText("Workflow autonome", { selector: "[role=menuitem] *, [role=menuitem]" })).toBeNull();

    expect(screen.queryByRole("button", { name: "Options de l'automatisation" })).toBeNull();
    const settings = screen.getByRole("button", { name: "Réglages…" });
    expect(settings.getAttribute("aria-disabled")).toBe("true");
    fireEvent.click(settings);
    expect(screen.queryByText("Modifier l'automatisation")).toBeNull();

    expect(screen.getByRole("switch", { name: "Désactiver l'automatisme" }).hasAttribute("data-disabled")).toBe(true);

    // Consultation : onglets Éditeur et Historique toujours proposés.
    expect(screen.getByRole("tab", { name: /Historique/ })).toBeTruthy();

    // Canevas en lecture seule : ni ajout, ni suppression, ni test, ni enregistrement.
    expect(screen.getByRole("note").textContent).toContain("gestionnaires d'automatisations");
    expect(screen.queryByRole("button", { name: "Ajouter une étape" })).toBeNull();
    expect(screen.queryByRole("button", { name: "Supprimer l'étape" })).toBeNull();
    expect(screen.queryByRole("button", { name: /Tester jusqu'ici/ })).toBeNull();
    expect(screen.queryByRole("button", { name: "Enregistrer le flux" })).toBeNull();

    // Réglages de l'étape consultables mais désactivés.
    fireEvent.click(screen.getByRole("group", { name: "Créer un document" }));
    const typeSelect = screen.getByDisplayValue("Créer un document") as HTMLSelectElement;
    expect(typeSelect.matches(":disabled")).toBe(true);

    expect(fetchMock.mock.calls.some(([, init]) => init && (init as RequestInit).method && (init as RequestInit).method !== "GET")).toBe(false);
  });

  it("avec le rôle : création, réglages, ajout d'étape et enregistrement proposés", () => {
    renderList(true);

    expect(screen.getByRole("button", { name: /Nouvelle/ }).getAttribute("aria-disabled")).toBeNull();
    expect(screen.getByRole("button", { name: "Options de l'automatisation" })).toBeTruthy();
    expect(screen.getByRole("button", { name: "Réglages…" }).getAttribute("aria-disabled")).toBeNull();
    expect(screen.queryByRole("note")).toBeNull();
    expect(screen.getAllByRole("button", { name: "Ajouter une étape" }).length).toBeGreaterThan(0);
    expect(screen.getByRole("button", { name: "Enregistrer le flux" })).toBeTruthy();

    fireEvent.click(screen.getByRole("group", { name: "Créer un document" }));
    expect((screen.getByDisplayValue("Créer un document") as HTMLSelectElement).matches(":disabled")).toBe(false);
  });
});
