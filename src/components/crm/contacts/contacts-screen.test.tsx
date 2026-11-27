// @vitest-environment jsdom
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { act, cleanup, fireEvent, render, screen, waitFor, within } from "@testing-library/react";
import { NextIntlClientProvider } from "next-intl";
import { SWRConfig } from "swr";
import fr from "../../../../messages/fr.json";
import type { ContactsDto } from "@/lib/crm/contacts";
import { ContactsScreen } from "./contacts-screen";

const toastApi = vi.hoisted(() => Object.assign(vi.fn(), { success: vi.fn(), error: vi.fn(), info: vi.fn() }));
vi.mock("@/components/bases/row-aside", () => ({ RowAside: () => null }));
vi.mock("sonner", () => ({ toast: toastApi }));
vi.mock("next/navigation", () => ({
  useSearchParams: () => new URLSearchParams(""),
  useRouter: () => ({ push: vi.fn(), replace: vi.fn() }),
  usePathname: () => "/crm/contacts",
}));
vi.mock("@/i18n/routing", () => ({
  Link: ({ href, children, ...rest }: { href: string; children: React.ReactNode }) => (
    <a href={href} {...rest}>
      {children}
    </a>
  ),
}));

const K1 = "11111111-1111-4111-8111-111111111111";
const K2 = "22222222-2222-4222-8222-222222222222";
const mkRow = (id: string, nom: string) => ({ id, databaseId: "db-c", cells: { "c-nom": nom }, position: 0, createdAt: "", updatedAt: "" });

function makeDto(over: Partial<ContactsDto> = {}): ContactsDto {
  return {
    contacts: [
      { id: K1, name: "Camille Roche", email: "c@example.org", phone: null, org: "BELOW DREAMS", row: mkRow(K1, "Camille Roche"), openDeals: 2, openAmount: 1500, lastInteraction: { date: "2030-01-02", type: "Appel", title: "x" } },
      { id: K2, name: "Paul Durand", email: null, phone: null, org: null, row: mkRow(K2, "Paul Durand"), openDeals: 0, openAmount: 0, lastInteraction: null },
    ],
    columns: [{ id: "c-nom", name: "Nom", type: "text", config: {} }],
    databaseId: "db-c",
    spaceId: "s",
    canEdit: true,
    missing: [],
    currency: "EUR",
    ...over,
  };
}

const connection = { roles: { contacts: { connected: true, databaseId: "db-c", databaseName: "Contacts", spaceName: "Direction" } } };
let dto: ContactsDto;
let status = 200;
let failSearch = false;
let urls: string[] = [];
let activityUrls: string[] = [];
let activity: unknown = { items: [], role: "contact", canLogInteraction: false, partial: [] };

function install() {
  vi.stubGlobal(
    "fetch",
    vi.fn(async (url: string) => {
      if (url.startsWith("/api/crm/connection")) return { ok: true, status: 200, json: async () => connection };
      if (url.startsWith("/api/crm/contacts")) {
        urls.push(url);
        const sq = new URL(url, "http://x").searchParams.get("search") ?? "";
        if (failSearch && sq !== "") return { ok: false, status: 500, json: async () => ({}) };
        if (status !== 200) return { ok: false, status, json: async () => ({}) };
        const q = new URL(url, "http://x").searchParams.get("search") ?? "";
        const contacts = dto.contacts.filter((c) => c.name.toLowerCase().includes(q.toLowerCase()));
        return { ok: true, status: 200, json: async () => ({ ...dto, contacts }) };
      }
      if (url.startsWith("/api/crm/activity")) {
        activityUrls.push(url);
        return { ok: true, status: 200, json: async () => activity };
      }
      return { ok: true, status: 200, json: async () => ({}) };
    }),
  );
}

function wrap(node: React.ReactNode) {
  return (
    <NextIntlClientProvider locale="fr" messages={fr}>
      <SWRConfig value={{ provider: () => new Map(), dedupingInterval: 0 }}>{node}</SWRConfig>
    </NextIntlClientProvider>
  );
}

beforeEach(() => {
  dto = makeDto();
  status = 200;
  failSearch = false;
  urls = [];
  activityUrls = [];
  activity = { items: [], role: "contact", canLogInteraction: false, partial: [] };
  install();
  vi.stubGlobal("matchMedia", (q: string) => ({ matches: false, media: q, addEventListener: () => {}, removeEventListener: () => {}, addListener: () => {}, removeListener: () => {} }));
});
afterEach(() => {
  cleanup();
  vi.unstubAllGlobals();
  vi.useRealTimers();
});

describe("ContactsScreen", () => {
  it("affiche les contacts avec dossiers ouverts, montant et dernière interaction", async () => {
    render(wrap(<ContactsScreen />));
    const rows = await screen.findAllByTestId("contact-row");
    expect(rows).toHaveLength(2);
    expect(within(rows[0]).getByText("Camille Roche")).toBeTruthy();
    expect(within(rows[0]).getByText("BELOW DREAMS")).toBeTruthy();
    expect(within(rows[0]).getByText("2")).toBeTruthy();
    expect(rows[0].textContent).toMatch(/1\s?500/);
    expect(rows[0].textContent).toContain("Appel");
  });

  it("contact sans dossier : 0, 0 €, aucune interaction, jamais de tiret", async () => {
    render(wrap(<ContactsScreen />));
    const row = (await screen.findAllByTestId("contact-row"))[1];
    expect(row.textContent).toMatch(/0\s?€/);
    expect(row.textContent).toContain("Aucune");
    expect(row.textContent).not.toMatch(/[—–-]/);
    expect(row.textContent).not.toContain("Non chiffré");
  });

  it("recherche : une seule requête après 250 ms", async () => {
    render(wrap(<ContactsScreen />));
    await screen.findAllByTestId("contact-row");
    vi.useFakeTimers();
    const before = urls.length;
    const input = screen.getByLabelText("Rechercher un contact");
    for (const v of ["p", "pa", "pau"]) fireEvent.change(input, { target: { value: v } });
    await act(async () => {
      await vi.advanceTimersByTimeAsync(200);
    });
    expect(urls.length).toBe(before);
    await act(async () => {
      await vi.advanceTimersByTimeAsync(100);
    });
    vi.useRealTimers();
    await waitFor(() => expect(urls.length).toBe(before + 1));
    expect(urls[urls.length - 1]).toContain("search=pau");
    await waitFor(() => expect(screen.getAllByTestId("contact-row")).toHaveLength(1));
  });

  it("aucun résultat : état vide de recherche avec bouton pour effacer", async () => {
    render(wrap(<ContactsScreen />));
    await screen.findAllByTestId("contact-row");
    fireEvent.change(screen.getByLabelText("Rechercher un contact"), { target: { value: "zzz" } });
    expect(await screen.findByText("Aucun contact trouvé")).toBeTruthy();
    fireEvent.click(screen.getByRole("button", { name: "Effacer la recherche" }));
    expect((await screen.findAllByTestId("contact-row")).length).toBe(2);
  });

  it("base sans contact : état vide", async () => {
    dto = makeDto({ contacts: [] });
    render(wrap(<ContactsScreen />));
    expect(await screen.findByText("Aucun contact")).toBeTruthy();
  });

  it("chargement puis erreur avec réessai", async () => {
    status = 500;
    render(wrap(<ContactsScreen />));
    expect(screen.getByRole("status", { name: fr.crm.shell.loading })).toBeTruthy();
    expect(await screen.findByRole("alert")).toBeTruthy();
    status = 200;
    fireEvent.click(screen.getByRole("button", { name: fr.crm.error.retry }));
    expect((await screen.findAllByTestId("contact-row")).length).toBe(2);
  });

  it("404 : état non raccordé", async () => {
    status = 404;
    render(wrap(<ContactsScreen />));
    expect(await screen.findByText(fr.crm.shell.notConnectedTitle)).toBeTruthy();
  });

  it("Voir les dossiers pointe vers le filtre contact, Ouvrir dans Bases vers la ligne", async () => {
    render(wrap(<ContactsScreen />));
    await screen.findAllByTestId("contact-row");
    const deals = screen.getByRole("link", { name: "Voir les dossiers de Camille Roche" });
    expect(deals.getAttribute("href")).toBe(`/crm/dossiers?contact=${K1}`);
    const bases = screen.getByRole("link", { name: "Ouvrir Camille Roche dans Bases" });
    expect(bases.getAttribute("href")).toBe(`/bases/db-c?row=${K1}`);
  });

  it("cliquer sur un lien de la ligne n'ouvre pas la fiche", async () => {
    render(wrap(<ContactsScreen />));
    await screen.findAllByTestId("contact-row");
    const link = screen.getByRole("link", { name: "Voir les dossiers de Camille Roche" });
    link.addEventListener("click", (e) => e.preventDefault());
    fireEvent.click(link);
    expect(screen.queryByRole("dialog")).toBeNull();
  });

  it("ouvrir une ligne affiche la fiche du contact (RecordDialog)", async () => {
    render(wrap(<ContactsScreen />));
    const row = (await screen.findAllByTestId("contact-row"))[0];
    fireEvent.click(row);
    expect(await screen.findByRole("dialog")).toBeTruthy();
  });

  it("les boutons sont nommés et la ligne est focalisable", async () => {
    render(wrap(<ContactsScreen />));
    const row = (await screen.findAllByTestId("contact-row"))[0];
    expect(row.getAttribute("tabindex")).toBe("0");
    for (const el of document.querySelectorAll("[data-action]")) expect(el.getAttribute("aria-label")).toBeTruthy();
  });

  it("montants dans la devise du DTO", async () => {
    dto = makeDto({ currency: "USD" });
    render(wrap(<ContactsScreen />));
    const row = (await screen.findAllByTestId("contact-row"))[0];
    expect(row.textContent).toMatch(/\$/);
    expect(row.textContent).not.toContain("€");
  });

  it("nom vide : repli Sans nom dans la cellule et le nom accessible", async () => {
    const base = makeDto();
    dto = makeDto({ contacts: [{ ...base.contacts[0], name: "" }] });
    render(wrap(<ContactsScreen />));
    const row = await screen.findByTestId("contact-row");
    expect(row.textContent).toContain("Sans nom");
    expect(row.getAttribute("aria-label")).toContain("Sans nom");
  });

  it("recherche en échec : la barre reste, la liste passe en erreur avec Réessayer", async () => {
    render(wrap(<ContactsScreen />));
    await screen.findAllByTestId("contact-row");
    failSearch = true;
    fireEvent.change(screen.getByLabelText("Rechercher un contact"), { target: { value: "pa" } });
    expect(await screen.findByRole("alert")).toBeTruthy();
    expect(screen.getByLabelText("Rechercher un contact")).toBeTruthy();
    failSearch = false;
    fireEvent.click(screen.getByRole("button", { name: fr.crm.error.retry }));
    await waitFor(() => expect(screen.queryByRole("alert")).toBeNull());
    expect(screen.getAllByTestId("contact-row").length).toBe(1);
  });

  it("pas d'état sans résultat tant que la recherche n'est pas partie", async () => {
    render(wrap(<ContactsScreen />));
    await screen.findAllByTestId("contact-row");
    fireEvent.change(screen.getByLabelText("Rechercher un contact"), { target: { value: "zzz" } });
    expect(screen.queryByText("Aucun contact trouvé")).toBeNull();
    expect(await screen.findByText("Aucun contact trouvé")).toBeTruthy();
  });

  it("la fiche ouverte reste ouverte quand la recherche exclut le contact", async () => {
    render(wrap(<ContactsScreen />));
    fireEvent.click((await screen.findAllByTestId("contact-row"))[0]);
    expect(await screen.findByRole("dialog")).toBeTruthy();
    fireEvent.change(screen.getByLabelText("Rechercher un contact"), { target: { value: "paul" } });
    await waitFor(() => expect(screen.getAllByTestId("contact-row")).toHaveLength(1));
    expect(screen.getByRole("dialog")).toBeTruthy();
    expect(within(screen.getByRole("dialog")).getAllByText("Camille Roche").length).toBeGreaterThan(0);
  });

  it("la fiche contact affiche le fil d'activité, sans bouton d'ajout", async () => {
    activity = {
      items: [{ kind: "interaction", id: "i1", at: "2030-01-02T10:00:00.000Z", interaction: { id: "i1", date: "2030-01-02", type: "Appel", title: "Point budget", notes: null, authorName: null } }],
      role: "contact",
      canLogInteraction: false,
      partial: [],
    };
    render(wrap(<ContactsScreen />));
    fireEvent.click((await screen.findAllByTestId("contact-row"))[0]);
    const dialog = await screen.findByRole("dialog");
    expect(await within(dialog).findByTestId("fiche-activity")).toBeTruthy();
    expect(activityUrls.some((u) => u.includes(`rowId=${K1}`) || u.includes(K1))).toBe(true);
    expect(dialog.querySelector('[data-action="ficheInteractionAdd"]')).toBeNull();
  });

  it("contact sans activité : état vide dans la fiche", async () => {
    render(wrap(<ContactsScreen />));
    fireEvent.click((await screen.findAllByTestId("contact-row"))[1]);
    const dialog = await screen.findByRole("dialog");
    expect(await within(dialog).findByText(fr.crm.fiche.activity.empty)).toBeTruthy();
  });
});
