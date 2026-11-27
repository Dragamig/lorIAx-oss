// @vitest-environment jsdom
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { cleanup, fireEvent, render, screen, waitFor, within } from "@testing-library/react";
import { NextIntlClientProvider } from "next-intl";
import { SWRConfig } from "swr";
import fr from "../../../../messages/fr.json";
import type { DossiersDto } from "@/lib/crm/dossiers";
import { makeDealSheetDto } from "../fiche/deal-sheet-fixture";
import { DossiersScreen } from "./dossiers-screen";

const toastApi = vi.hoisted(() => Object.assign(vi.fn(), { success: vi.fn(), error: vi.fn(), info: vi.fn() }));
const search = vi.hoisted(() => ({ value: "" }));
vi.mock("@/components/bases/row-aside", () => ({ RowAside: () => null }));
vi.mock("sonner", () => ({ toast: toastApi }));
vi.mock("next/navigation", () => ({
  useSearchParams: () => new URLSearchParams(search.value),
  useRouter: () => ({ push: vi.fn(), replace: vi.fn() }),
  usePathname: () => "/crm/dossiers",
}));
vi.mock("@/i18n/routing", () => ({
  Link: ({ href, children, ...rest }: { href: string; children: React.ReactNode }) => (
    <a href={href} {...rest}>
      {children}
    </a>
  ),
}));

const C = { titre: "c-titre", statut: "c-statut", resp: "c-resp", rel: "c-rel", contact: "c-contact", montant: "c-montant" };
const K1 = "11111111-1111-4111-8111-111111111111";
const baseDeal = { amount: null, relance: null, closeDate: null, ownerIds: [] as string[], contactId: null, contactName: null };

function makeDto(over: Partial<DossiersDto> = {}): DossiersDto {
  const deals = [
    { ...baseDeal, id: "1", title: "Devis alpha", status: "Nouveau", amount: 1000, ownerIds: ["u1"], relance: "2020-01-05", contactId: K1, contactName: "Camille Roche" },
    { ...baseDeal, id: "2", title: "Contrat beta", status: "Gagné", amount: 500, ownerIds: ["u2"] },
    { ...baseDeal, id: "3", title: "Autre", status: "Nouveau", ownerIds: ["u1"] },
  ];
  return {
    databaseId: "db-d",
    spaceId: "s",
    columns: [
      { id: C.titre, name: "Titre", type: "text", config: {} },
      { id: C.statut, name: "Statut", type: "select", config: { options: ["Nouveau", "Gagné"] } },
      { id: C.resp, name: "Responsable", type: "person", config: {} },
      { id: C.rel, name: "Relance", type: "date", config: {} },
      { id: C.contact, name: "Contact", type: "relation", config: {} },
    ],
    rows: deals.map((d) => ({
      id: d.id,
      cells: { [C.titre]: d.title, [C.statut]: d.status, [C.resp]: d.ownerIds, [C.rel]: d.relance, [C.contact]: d.contactId ? [d.contactId] : [] },
    })),
    views: [
      { id: "v-all", name: "Tous", type: "grid", scope: "shared", config: {} },
      {
        id: "v-new",
        name: "Nouveaux",
        type: "grid",
        scope: "personal",
        config: { filters: { type: "group", conjunction: "and", children: [{ id: "a", columnId: C.statut, operator: "is", value: "Nouveau" }] } },
      },
    ],
    canEdit: true,
    closedLanes: ["Gagné"],
    userId: "u1",
    deals,
    fieldColumns: { titre: C.titre, statut: C.statut, montant: C.montant, relance: C.rel, responsable: C.resp, contact: C.contact, cloture: null },
    statuses: ["Nouveau", "Gagné"],
    owners: [
      { id: "u1", name: "Anne Martin" },
      { id: "u2", name: "Paul Durand" },
    ],
    mineAvailable: true,
    missing: [],
    currency: "EUR",
    ...over,
  };
}

interface Server {
  dto: DossiersDto;
  status: number;
  calls: { url: string; method: string; body?: unknown }[];
  writeOk: boolean;
}
let server: Server;

function install() {
  vi.stubGlobal(
    "fetch",
    vi.fn(async (url: string, init?: RequestInit) => {
      const method = init?.method ?? "GET";
      if (url.startsWith("/api/crm/connection")) {
        return { ok: true, status: 200, json: async () => ({ roles: { dossiers: { connected: true, databaseId: "db-d", databaseName: "Affaires", spaceName: "Direction" } } }) };
      }
      if (url.startsWith("/api/crm/dossiers")) {
        if (server.status !== 200) return { ok: false, status: server.status, json: async () => ({}) };
        return { ok: true, status: 200, json: async () => server.dto };
      }
      if (url.startsWith("/api/databases/db-d/views")) {
        server.calls.push({ url, method, body: init?.body ? JSON.parse(String(init.body)) : undefined });
        if (!server.writeOk) return { ok: false, status: 500, json: async () => ({}) };
        return { ok: true, status: 200, json: async () => ({ id: "v-created" }) };
      }
      if (url.startsWith("/api/crm/activity")) return { ok: true, status: 200, json: async () => ({ items: [], role: "r", canLogInteraction: true, partial: [] }) };
      if (method === "GET" && /^\/api\/crm\/deals\/[^/?]+$/.test(url)) {
        return { ok: true, status: 200, json: async () => makeDealSheetDto() };
      }
      return { ok: true, status: 200, json: async () => ({}) };
    }),
  );
}

function wrap() {
  return (
    <NextIntlClientProvider locale="fr" messages={fr}>
      <SWRConfig value={{ provider: () => new Map(), dedupingInterval: 0 }}>
        <DossiersScreen />
      </SWRConfig>
    </NextIntlClientProvider>
  );
}

const rowTitles = () => screen.queryAllByTestId("dossier-row").map((r) => r.getAttribute("aria-label"));
const saveBtn = () => screen.getByRole("button", { name: "Enregistrer la vue" });
const reset = () => fireEvent.click(screen.getAllByRole("button", { name: "Réinitialiser" })[0]);

beforeEach(() => {
  server = { dto: makeDto(), status: 200, calls: [], writeOk: true };
  search.value = "";
  toastApi.success.mockReset();
  toastApi.error.mockReset();
  vi.stubGlobal("matchMedia", (q: string) => ({ matches: false, media: q, addEventListener: () => {}, removeEventListener: () => {}, addListener: () => {}, removeListener: () => {} }));
  install();
});
afterEach(() => {
  cleanup();
  vi.unstubAllGlobals();
});

describe("DossiersScreen", () => {
  it("filtre par défaut Mes dossiers, tablist des vues et puce Vue personnalisée", async () => {
    render(wrap());
    await screen.findByRole("tablist", { name: "Vues enregistrées" });
    expect(rowTitles()).toEqual(["Ouvrir le dossier Devis alpha", "Ouvrir le dossier Autre"]);
    expect(screen.getByText("Vue personnalisée")).toBeTruthy();
    expect(screen.getAllByRole("tab")).toHaveLength(2);
    expect(screen.getByText(/2 dossiers, montant cumulé/)).toBeTruthy();
  });

  it("une vue enregistrée s'applique et devient l'onglet actif ; modifier un filtre la désélectionne", async () => {
    render(wrap());
    await screen.findByRole("tablist");
    fireEvent.click(screen.getByRole("tab", { name: "Vue Tous" }));
    expect(rowTitles()).toHaveLength(3);
    expect(screen.getByRole("tab", { name: "Vue Tous" }).getAttribute("aria-selected")).toBe("true");
    expect(screen.queryByText("Vue personnalisée")).toBeNull();
    fireEvent.change(screen.getByRole("combobox", { name: "Filtrer par statut" }), { target: { value: "Gagné" } });
    expect(rowTitles()).toEqual(["Ouvrir le dossier Contrat beta"]);
    expect(screen.getByText("Vue personnalisée")).toBeTruthy();
  });

  it("Enregistrer la vue crée une vue personnelle par défaut avec toutes les clés d'affichage", async () => {
    render(wrap());
    await screen.findByRole("tablist");
    fireEvent.click(saveBtn());
    fireEvent.change(screen.getByLabelText("Nom de la vue"), { target: { value: "Mes devis" } });
    expect((screen.getByLabelText("Visible par") as HTMLSelectElement).value).toBe("personal");
    fireEvent.click(screen.getByRole("button", { name: "Enregistrer" }));
    await waitFor(() => expect(server.calls).toHaveLength(1));
    const call = server.calls[0];
    expect(call.method).toBe("POST");
    expect(call.body).toMatchObject({
      name: "Mes devis",
      type: "grid",
      scope: "personal",
      config: { visibleColumns: "*", columnOrder: null, rowHeight: "normal" },
    });
    expect(JSON.stringify(call.body)).toContain("is_me");
    await waitFor(() => expect(toastApi.success).toHaveBeenCalled());
    const opts = toastApi.success.mock.calls[0][1];
    expect(opts.action.label).toBe("Annuler");
  });

  it("recherche active : notice dans le formulaire, seule la part titre est enregistrée", async () => {
    render(wrap());
    await screen.findByRole("tablist");
    reset();
    fireEvent.click(saveBtn());
    expect(screen.queryByRole("note")).toBeNull();
    fireEvent.click(saveBtn());
    fireEvent.change(screen.getByRole("searchbox"), { target: { value: "camille" } });
    fireEvent.click(saveBtn());
    expect(screen.getByRole("note").textContent).toMatch(/partie contact/);
    fireEvent.change(screen.getByLabelText("Nom de la vue"), { target: { value: "Q" } });
    fireEvent.click(screen.getByRole("button", { name: "Enregistrer" }));
    await waitFor(() => expect(server.calls).toHaveLength(1));
    const children = (server.calls[0].body as { config: { filters: { children: { columnId: string; operator: string; value: string }[] } } }).config.filters.children;
    expect(children).toEqual([expect.objectContaining({ columnId: "c-titre", operator: "contains", value: "camille" })]);
  });

  it("nom vide : message et aucun appel", async () => {
    render(wrap());
    await screen.findByRole("tablist");
    fireEvent.click(saveBtn());
    fireEvent.click(screen.getByRole("button", { name: "Enregistrer" }));
    expect((await screen.findByRole("alert")).textContent).toBe("Saisissez un nom");
    expect(server.calls).toHaveLength(0);
  });

  it("échec d'enregistrement : toast d'erreur avec Réessayer, formulaire conservé", async () => {
    server.writeOk = false;
    render(wrap());
    await screen.findByRole("tablist");
    fireEvent.click(saveBtn());
    fireEvent.change(screen.getByLabelText("Nom de la vue"), { target: { value: "X" } });
    fireEvent.click(screen.getByRole("button", { name: "Enregistrer" }));
    await waitFor(() => expect(toastApi.error).toHaveBeenCalled());
    expect(toastApi.error.mock.calls[0][1].action.label).toBe("Réessayer");
    expect(screen.getByLabelText("Nom de la vue")).toBeTruthy();
  });

  it("désactivé avec explication quand la vue courante est déjà enregistrée", async () => {
    render(wrap());
    await screen.findByRole("tablist");
    fireEvent.click(screen.getByRole("tab", { name: "Vue Tous" }));
    expect(saveBtn().getAttribute("aria-disabled")).toBe("true");
    fireEvent.click(saveBtn());
    expect(screen.queryByLabelText("Nom de la vue")).toBeNull();
    fireEvent.focus(saveBtn());
    expect(await screen.findByText("La vue courante est déjà enregistrée")).toBeTruthy();
  });

  it("viewer : Enregistrer et suppression désactivés avec la raison", async () => {
    server.dto = makeDto({ canEdit: false });
    render(wrap());
    await screen.findByRole("tablist");
    expect(saveBtn().getAttribute("aria-disabled")).toBe("true");
    fireEvent.focus(saveBtn());
    expect((await screen.findAllByText(/Lecture seule/)).length).toBeGreaterThan(0);
    fireEvent.click(screen.getByRole("button", { name: "Supprimer la vue Tous" }));
    expect(server.calls).toHaveLength(0);
  });

  it("suppression : DELETE immédiat, puis Annuler recrée la vue à l'identique", async () => {
    render(wrap());
    await screen.findByRole("tablist");
    fireEvent.click(screen.getByRole("button", { name: "Supprimer la vue Nouveaux" }));
    await waitFor(() => expect(server.calls.map((c) => c.method)).toEqual(["DELETE"]));
    expect(server.calls[0].url).toBe("/api/databases/db-d/views/v-new");
    await waitFor(() => expect(toastApi.success).toHaveBeenCalled());
    const opts = toastApi.success.mock.calls[0][1];
    expect(opts.action.label).toBe("Annuler");
    opts.action.onClick();
    await waitFor(() => expect(server.calls.map((c) => c.method)).toEqual(["DELETE", "POST"]));
    expect(server.calls[1].body).toMatchObject({ name: "Nouveaux", type: "grid", scope: "personal" });
  });

  it("échec de suppression : la vue reste, toast avec Réessayer", async () => {
    server.writeOk = false;
    render(wrap());
    await screen.findByRole("tablist");
    fireEvent.click(screen.getByRole("button", { name: "Supprimer la vue Nouveaux" }));
    await waitFor(() => expect(toastApi.error).toHaveBeenCalled());
    expect(toastApi.error.mock.calls[0][1].action.label).toBe("Réessayer");
    expect(screen.getByRole("tab", { name: "Vue Nouveaux" })).toBeTruthy();
  });

  it("vue dont une colonne a disparu : filtre ignoré avec avertissement", async () => {
    server.dto = makeDto({
      views: [
        {
          id: "v-old",
          name: "Ancienne",
          type: "grid",
          scope: "shared",
          config: { filters: { type: "group", conjunction: "and", children: [{ id: "z", columnId: "c-disparue", operator: "contains", value: "x" }] } },
        },
      ],
    });
    render(wrap());
    await screen.findByRole("tablist");
    fireEvent.click(screen.getByRole("tab", { name: "Vue Ancienne" }));
    expect(rowTitles()).toHaveLength(3);
    expect(screen.getByRole("status").textContent).toMatch(/1 filtre de cette vue est ignoré/);
  });

  it("liste filtrée vide : message et Réinitialiser", async () => {
    render(wrap());
    await screen.findByRole("tablist");
    fireEvent.change(screen.getByRole("searchbox"), { target: { value: "zzz" } });
    expect(screen.getByText("Aucun dossier ne correspond")).toBeTruthy();
    reset();
    expect(rowTitles()).toHaveLength(3);
  });

  it("recherche sur le contact et filtre En retard", async () => {
    render(wrap());
    await screen.findByRole("tablist");
    reset();
    fireEvent.change(screen.getByRole("searchbox"), { target: { value: "camille" } });
    expect(rowTitles()).toEqual(["Ouvrir le dossier Devis alpha"]);
    fireEvent.change(screen.getByRole("searchbox"), { target: { value: "" } });
    fireEvent.click(screen.getByRole("button", { name: "En retard" }));
    expect(rowTitles()).toEqual(["Ouvrir le dossier Devis alpha"]);
  });

  it("?contact=<uuid> pose la puce de contact, sans filtre Mes dossiers, et se retire", async () => {
    search.value = `contact=${K1}`;
    render(wrap());
    await screen.findByRole("tablist");
    expect(screen.getByText("Contact : Camille Roche")).toBeTruthy();
    expect(rowTitles()).toEqual(["Ouvrir le dossier Devis alpha"]);
    fireEvent.click(screen.getByRole("button", { name: "Retirer le filtre contact" }));
    expect(rowTitles()).toHaveLength(3);
  });

  it("?contact invalide est ignoré", async () => {
    search.value = "contact=pas-un-uuid";
    render(wrap());
    await screen.findByRole("tablist");
    expect(screen.queryByText(/Contact :/)).toBeNull();
  });

  it("ouvre la fiche au clic et au clavier", async () => {
    render(wrap());
    await screen.findByRole("tablist");
    const row = screen.getAllByTestId("dossier-row")[0];
    fireEvent.keyDown(row, { key: "Enter" });
    expect(await screen.findByRole("dialog")).toBeTruthy();
  });

  it("champ Responsable non raccordé : Mes dossiers retiré et option désactivée", async () => {
    server.dto = makeDto({ mineAvailable: false, fieldColumns: { ...makeDto().fieldColumns, responsable: null } });
    render(wrap());
    await screen.findByRole("tablist");
    expect(rowTitles()).toHaveLength(3);
  });

  it("erreur : état d'erreur avec Réessayer ; 404 : non raccordé", async () => {
    server.status = 500;
    render(wrap());
    expect(await screen.findByText("Impossible de charger les données")).toBeTruthy();
    cleanup();
    server.status = 404;
    render(wrap());
    expect(await screen.findByText("CRM non raccordé")).toBeTruthy();
  });

  it("base sans dossier : état vide dédié", async () => {
    server.dto = makeDto({ deals: [], rows: [] });
    render(wrap());
    await screen.findByRole("tablist");
    expect(screen.getByText("Aucun dossier dans la base")).toBeTruthy();
    expect(within(screen.getByRole("tablist")).getAllByRole("tab")).toHaveLength(2);
  });
});
