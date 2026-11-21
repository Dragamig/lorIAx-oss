// @vitest-environment jsdom
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react";
import { ConnectionScreen } from "./connection-screen";

const h = vi.hoisted(() => ({
  success: vi.fn(),
  error: vi.fn(),
  info: vi.fn(),
}));

vi.mock("next-intl", async () => (await import("@/components/media/test-fixtures")).intlMock());
vi.mock("sonner", () => ({
  toast: Object.assign(h.info, { success: h.success, error: h.error }),
}));
vi.mock("@/i18n/routing", () => ({
  Link: ({ href, children, ...rest }: { href: string; children: React.ReactNode }) => (
    <a href={href} {...rest}>
      {children}
    </a>
  ),
}));

const DB_A = "11111111-1111-4111-8111-111111111111";
const DB_B = "22222222-2222-4222-8222-222222222222";
const C_NOM = "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaa1";
const C_MAIL = "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaa2";
const C_NUM = "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaa3";

const columnsA = [
  { id: C_NOM, name: "Nom", type: "text" },
  { id: C_MAIL, name: "Mail", type: "email" },
  { id: C_NUM, name: "Compteur", type: "number" },
];

function role(role: string, connected: boolean, extra: object = {}) {
  return { role, connected, fields: {}, columnIds: {}, ok: 0, total: role === "contacts" ? 4 : role === "dossiers" ? 7 : 6, bad: 0, complete: false, ...extra };
}

const connectedContacts = (nomState: object = { state: "ok" }, nomColumn: string = C_NOM) => ({
  canAdmin: true,
  roles: {
    contacts: role("contacts", true, {
      databaseId: DB_A,
      databaseName: "Clients",
      spaceName: "Direction",
      fields: { nom: nomState, email: { state: "none" }, telephone: { state: "none" }, structure: { state: "none" } },
      columnIds: { nom: nomColumn },
      ok: 1,
      bad: "state" in nomState && nomState.state === "bad" ? 1 : 0,
    }),
    dossiers: role("dossiers", false),
    interactions: role("interactions", false),
  },
});

const candidate = (id: string, name: string) => ({
  databaseId: id,
  name,
  spaceName: "Direction",
  columns: columnsA,
  proposal: { nom: C_NOM, email: C_MAIL },
});

interface Scenario {
  status?: object | "fail";
  connection?: object | "fail";
  putReply?: (body: unknown) => object;
}
let sc: Scenario;
const calls: { url: string; method: string; body?: unknown }[] = [];
const fetchMock = vi.fn();

beforeEach(() => {
  calls.length = 0;
  h.success.mockReset();
  h.error.mockReset();
  h.info.mockReset();
  sc = {};
  fetchMock.mockReset();
  fetchMock.mockImplementation(async (url: string, init?: RequestInit) => {
    const method = init?.method ?? "GET";
    calls.push({ url, method, body: init?.body ? JSON.parse(String(init.body)) : undefined });
    const ok = (json: unknown) => ({ ok: true, status: 200, json: async () => json });
    if (url === "/api/crm/status") {
      if (sc.status === "fail") return { ok: false, status: 500, json: async () => ({}) };
      return ok(sc.status ?? { enabled: true, complete: false, canAdmin: true });
    }
    if (url === "/api/crm/connection" && method === "PUT") {
      const reply = sc.putReply ? sc.putReply(calls[calls.length - 1].body) : connectedContacts();
      return ok(reply);
    }
    if (url === "/api/crm/connection") {
      if (sc.connection === "fail") return { ok: false, status: 500, json: async () => ({}) };
      return ok(sc.connection ?? connectedContacts());
    }
    if (url.startsWith("/api/crm/connection/candidates")) {
      return ok({ candidates: [candidate(DB_A, "Clients"), candidate(DB_B, "Autre")] });
    }
    return ok({ enabled: true });
  });
  vi.stubGlobal("fetch", fetchMock);
});

afterEach(() => {
  cleanup();
  vi.unstubAllGlobals();
  vi.restoreAllMocks();
});

async function ready() {
  render(<ConnectionScreen organisation="Acme" />);
  await screen.findByRole("heading", { name: "Raccordement" });
}

describe("ConnectionScreen", () => {
  it("rend les trois tuiles de même classe de dimension (h-44 et grille de trois)", async () => {
    await ready();
    const tiles = screen.getAllByTestId("role-tile");
    expect(tiles).toHaveLength(3);
    for (const tile of tiles) expect(tile.className).toContain("h-44");
    expect(tiles[0].parentElement?.className).toContain("grid-cols-3");
  });

  it("choisir une base appelle PUT avec roles et affiche le toast des champs reconnus", async () => {
    sc.connection = {
      canAdmin: true,
      roles: { contacts: role("contacts", false), dossiers: role("dossiers", false), interactions: role("interactions", false) },
    };
    sc.putReply = () => connectedContacts();
    await ready();
    fireEvent.change(screen.getByLabelText("Base pour le rôle Contacts"), { target: { value: DB_A } });
    await waitFor(() => expect(h.success).toHaveBeenCalled());
    const put = calls.find((c) => c.method === "PUT");
    expect((put?.body as { roles: object }).roles).toEqual({ contacts: DB_A });
    expect(h.success.mock.calls[0][0]).toContain("champs reconnus");
  });

  it("choisir une colonne incompatible affiche l'état Incompatible, le message en role=alert et aria-invalid", async () => {
    sc.putReply = () =>
      connectedContacts({ state: "bad", code: "type_incompatible", message: "crm.errors.typeIncompatible" }, C_NUM);
    await ready();
    const select = screen.getByLabelText("Colonne pour Nom");
    fireEvent.change(select, { target: { value: C_NUM } });
    await waitFor(() => expect(select.getAttribute("aria-invalid")).toBe("true"));
    expect(screen.getByText("Incompatible")).toBeTruthy();
    const alerts = screen.getAllByRole("alert").map((a) => a.textContent);
    expect(alerts.some((a) => a?.includes("Colonne « Compteur » de type Nombre"))).toBe(true);
  });

  it("Dissocier appelle PUT roles null et propose Annuler", async () => {
    sc.putReply = () => ({
      canAdmin: true,
      roles: { contacts: role("contacts", false), dossiers: role("dossiers", false), interactions: role("interactions", false) },
    });
    await ready();
    fireEvent.click(screen.getByRole("button", { name: "Dissocier la base du rôle Contacts" }));
    await waitFor(() => expect(h.success).toHaveBeenCalled());
    const put = calls.find((c) => c.method === "PUT");
    expect((put?.body as { roles: object }).roles).toEqual({ contacts: null });
    expect(h.success.mock.calls[0][1].action.label).toBe("Annuler");
  });

  it("l'interrupteur désactive puis Annuler réactive", async () => {
    await ready();
    fireEvent.click(screen.getByRole("button", { name: "Module activé" }));
    await waitFor(() => expect(h.success).toHaveBeenCalled());
    expect(calls.some((c) => c.url === "/api/crm/deactivate" && c.method === "POST")).toBe(true);
    expect(h.success.mock.calls[0][0]).toBe("Module CRM désactivé, les bases sont conservées");
    h.success.mock.calls[0][1].action.onClick();
    await waitFor(() => expect(calls.some((c) => c.url === "/api/crm/activate" && c.method === "POST")).toBe(true));
  });

  it("chaque bouton porte aria-label et une info-bulle (Tip) ; un bouton désactivé explique pourquoi", async () => {
    await ready();
    const buttons = screen.getAllByRole("button");
    expect(buttons.length).toBeGreaterThan(0);
    for (const b of buttons) expect(b.getAttribute("aria-label")).toBeTruthy();
    const disabled = screen.getByRole("button", { name: "Dissocier la base du rôle Dossiers" });
    expect(disabled.getAttribute("aria-disabled")).toBe("true");
    fireEvent.focus(disabled);
    expect(await screen.findByText("Aucune base à dissocier pour ce rôle")).toBeTruthy();
    const fields = screen.getByRole("button", { name: "Champs du rôle Contacts" });
    fireEvent.focus(fields);
    expect(await screen.findByText("Afficher la correspondance des champs")).toBeTruthy();
  });

  it("état erreur : Réessayer recharge", async () => {
    sc.status = "fail";
    render(<ConnectionScreen organisation="Acme" />);
    const retry = await screen.findByRole("button", { name: "Réessayer" });
    sc.status = undefined;
    fireEvent.click(retry);
    await screen.findByRole("heading", { name: "Raccordement" });
    expect(calls.filter((c) => c.url === "/api/crm/status").length).toBe(2);
  });

  it("état chargement : squelettes", () => {
    fetchMock.mockImplementation(() => new Promise(() => {}));
    render(<ConnectionScreen organisation="Acme" />);
    expect(screen.getByRole("status", { name: "Chargement du raccordement" })).toBeTruthy();
  });

  it("aucune base : bloc vide et aucun bouton « créer depuis le modèle »", async () => {
    sc.connection = {
      canAdmin: true,
      roles: { contacts: role("contacts", false), dossiers: role("dossiers", false), interactions: role("interactions", false) },
    };
    await ready();
    expect(screen.getByText("Aucune base raccordée")).toBeTruthy();
    expect(screen.queryByText(/depuis le modèle/i)).toBeNull();
  });

  it("jamais window.alert, confirm ni prompt", async () => {
    const a = vi.spyOn(window, "alert").mockImplementation(() => {});
    const c = vi.spyOn(window, "confirm").mockImplementation(() => true);
    const p = vi.spyOn(window, "prompt").mockImplementation(() => null);
    await ready();
    fireEvent.click(screen.getByRole("button", { name: "Dissocier la base du rôle Contacts" }));
    fireEvent.click(screen.getByRole("button", { name: "Module activé" }));
    await waitFor(() => expect(h.success).toHaveBeenCalled());
    expect(a).not.toHaveBeenCalled();
    expect(c).not.toHaveBeenCalled();
    expect(p).not.toHaveBeenCalled();
  });
});
