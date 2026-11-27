// @vitest-environment jsdom
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { cleanup, fireEvent, render, screen, waitFor, within } from "@testing-library/react";
import { NextIntlClientProvider } from "next-intl";
import { SWRConfig } from "swr";
import fr from "../../../../messages/fr.json";
import { addDaysIso, todayIn } from "@/lib/crm/dates";
import type { RelanceItem, RelancesDto } from "@/lib/crm/relances";
import { RelanceRow } from "./relance-row";
import { makeDealSheetDto } from "../fiche/deal-sheet-fixture";
import { RelancesScreen } from "./relances-screen";

const toastApi = vi.hoisted(() => Object.assign(vi.fn(), { success: vi.fn(), error: vi.fn(), info: vi.fn() }));
vi.mock("@/components/bases/row-aside", () => ({ RowAside: () => null }));
vi.mock("sonner", () => ({ toast: toastApi }));
const refresh = vi.hoisted(() => vi.fn());
vi.mock("@/lib/crm/use-crm-data", async (orig) => {
  const actual = await orig<typeof import("@/lib/crm/use-crm-data")>();
  return {
    ...actual,
    refreshCrmData: (...a: unknown[]) => {
      refresh(...a);
      return actual.refreshCrmData();
    },
  };
});
vi.mock("next/navigation", () => ({
  useSearchParams: () => new URLSearchParams(""),
  useRouter: () => ({ push: vi.fn(), replace: vi.fn() }),
  usePathname: () => "/crm/relances",
}));
vi.mock("@/i18n/routing", () => ({
  Link: ({ href, children, ...rest }: { href: string; children: React.ReactNode }) => (
    <a href={href} {...rest}>
      {children}
    </a>
  ),
}));

const today = todayIn(new Date(), Intl.DateTimeFormat().resolvedOptions().timeZone);
const day = (n: number) => addDaysIso(today, n);
const item = (id: string, relance: string, over: Partial<RelanceItem> = {}): RelanceItem => ({
  dealId: id,
  title: `Dossier ${id}`,
  status: "Devis envoyé",
  contactName: `Contact ${id}`,
  contactOrg: "Org",
  relance,
  lastInteraction: null,
  ...over,
});
function makeDto(over: Partial<RelancesDto> = {}): RelancesDto {
  return {
    groups: { late: [item("1", day(-4))], today: [item("2", day(0))], week: [item("3", day(3))] },
    tasks: [{ id: "t1", title: "Préparer le devis", dueAt: `${day(1)}T09:00:00.000Z`, dealId: "3", dealTitle: "Dossier 3", assigneeName: "Anne" }],
    interactionTypes: ["Appel", "Mail"],
    canLog: true,
    mineAvailable: true,
    missing: [],
    canEdit: true,
    ...over,
  };
}

const connection = { roles: { dossiers: { connected: true, databaseId: "db-d", databaseName: "Affaires", spaceName: "Direction" } } };
interface Server {
  dto: RelancesDto;
  status: number;
  code: string;
  relanceCalls: { url: string; body: unknown }[];
  interactionCalls: unknown[];
  urls: string[];
  failWithoutMine?: boolean;
}
let server: Server;

function install() {
  vi.stubGlobal(
    "fetch",
    vi.fn(async (url: string, init?: RequestInit) => {
      if (url.startsWith("/api/crm/connection")) return { ok: true, status: 200, json: async () => connection };
      if (url.startsWith("/api/crm/relances")) {
        server.urls.push(url);
        if (server.failWithoutMine && !url.includes("mine=1")) return { ok: false, status: 500, json: async () => ({}) };
        if (server.status === 404) return { ok: false, status: 404, json: async () => ({}) };
        return { ok: true, status: 200, json: async () => server.dto };
      }
      if (url.startsWith("/api/crm/activity")) return { ok: true, status: 200, json: async () => ({ items: [], role: "r", canLogInteraction: true, partial: [] }) };
      if (!init?.method && /^\/api\/crm\/deals\/[^/?]+$/.test(url)) {
        const id = url.split("/").pop() as string;
        return { ok: true, status: 200, json: async () => makeDealSheetDto({ deal: { ...makeDealSheetDto().deal, id, title: `Dossier ${id}` } }) };
      }
      if (init?.method === "POST" && url.includes("/relance")) {
        server.relanceCalls.push({ url, body: JSON.parse(String(init.body)) });
        if (server.code) return { ok: false, status: 400, json: async () => ({ error: "Paramètres invalides", code: server.code }) };
        return { ok: true, status: 200, json: async () => ({ relance: null }) };
      }
      if (init?.method === "POST" && url.includes("/interactions")) {
        server.interactionCalls.push(JSON.parse(String(init.body)));
        if (server.code) return { ok: false, status: 500, json: async () => ({}) };
        return { ok: true, status: 201, json: async () => ({}) };
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
const renderScreen = () => render(wrap(<RelancesScreen />));
const group = (g: string) => document.querySelector(`[data-group="${g}"]`) as HTMLElement | null;
const rowIds = (g: string) => {
  const el = group(g);
  return el ? within(el).queryAllByTestId("relance-row").map((r) => r.getAttribute("data-id")) : [];
};
const done = (n: string) => screen.getByRole("button", { name: `Marquer la relance de Dossier ${n} comme faite` });
const snooze = (n: string) => screen.getByRole("button", { name: `Reporter la relance de Dossier ${n}` });

beforeEach(() => {
  vi.stubGlobal("matchMedia", (q: string) => ({ matches: false, media: q, addEventListener: () => {}, removeEventListener: () => {}, addListener: () => {}, removeListener: () => {} }));
  for (const f of [toastApi, toastApi.success, toastApi.error, refresh]) f.mockClear();
  server = { dto: makeDto(), status: 200, code: "", relanceCalls: [], interactionCalls: [], urls: [] };
  install();
});
afterEach(() => {
  cleanup();
  vi.unstubAllGlobals();
});

async function loaded() {
  await screen.findByText("Dossier 1");
}

describe("écran À relancer", () => {
  it("affiche les groupes En retard, Aujourd'hui, Cette semaine puis les tâches liées, filtre Mes dossiers par défaut", async () => {
    renderScreen();
    await loaded();
    expect(rowIds("late")).toEqual(["1"]);
    expect(rowIds("today")).toEqual(["2"]);
    expect(rowIds("week")).toEqual(["3"]);
    expect(within(group("tasks")!).getByText("Préparer le devis")).toBeTruthy();
    expect(screen.getByText("En retard de 4 jours")).toBeTruthy();
    expect(screen.getByRole("button", { name: "Mes dossiers" }).getAttribute("aria-pressed")).toBe("true");
    expect(server.urls[0]).toContain("mine=1");
  });

  it("Faite retire la ligne, toast avec Annuler, un seul appel au double clic", async () => {
    renderScreen();
    await loaded();
    const button = done("2");
    fireEvent.click(button);
    fireEvent.click(button);
    await waitFor(() => expect(rowIds("today")).toEqual([]));
    await waitFor(() => expect(toastApi.success).toHaveBeenCalled());
    expect(server.relanceCalls).toHaveLength(1);
    expect(server.relanceCalls[0].body).toEqual({ done: true });
    expect(toastApi.success.mock.calls[0][1].action.label).toBe("Annuler");
    expect(refresh).toHaveBeenCalled();
  });

  it("Annuler d'une relance en retard restaure la ligne par { restore }", async () => {
    renderScreen();
    await loaded();
    fireEvent.click(done("1"));
    await waitFor(() => expect(rowIds("late")).toEqual([]));
    await waitFor(() => expect(toastApi.success).toHaveBeenCalled());
    toastApi.success.mock.calls[0][1].action.onClick();
    await waitFor(() => expect(server.relanceCalls).toHaveLength(2));
    expect(server.relanceCalls[1].body).toEqual({ restore: day(-4) });
    await waitFor(() => expect(rowIds("late")).toEqual(["1"]));
    expect(toastApi.success).toHaveBeenLastCalledWith("Action annulée");
  });

  it("Reporter +1 semaine d'une ligne en retard la déplace vers Cette semaine", async () => {
    renderScreen();
    await loaded();
    fireEvent.click(snooze("1"));
    fireEvent.click(await screen.findByRole("menuitem", { name: "+1 semaine" }));
    await waitFor(() => expect(rowIds("late")).toEqual([]));
    expect(server.relanceCalls[0].body).toEqual({ snoozeDays: 7 });
    await waitFor(() => expect(rowIds("week")).toEqual(["3", "1"]));
  });

  it("Reporter +1 jour d'une ligne du jour la place dans Cette semaine", async () => {
    renderScreen();
    await loaded();
    fireEvent.click(snooze("2"));
    fireEvent.click(await screen.findByRole("menuitem", { name: "+1 jour" }));
    await waitFor(() => expect(rowIds("week")).toEqual(["2", "3"]));
    expect(rowIds("today")).toEqual([]);
  });

  it("date précise passée : message sous le champ, aucun appel", async () => {
    renderScreen();
    await loaded();
    fireEvent.click(snooze("3"));
    fireEvent.click(await screen.findByRole("menuitem", { name: "Date précise" }));
    fireEvent.change(screen.getByLabelText("Nouvelle date de relance"), { target: { value: day(-1) } });
    fireEvent.click(screen.getByRole("button", { name: "Valider" }));
    expect((await screen.findByRole("alert")).textContent).toContain("aujourd'hui ou plus tard");
    expect(server.relanceCalls).toHaveLength(0);
  });

  it("date précise valide : envoie { date } et déplace la ligne", async () => {
    renderScreen();
    await loaded();
    fireEvent.click(snooze("3"));
    fireEvent.click(await screen.findByRole("menuitem", { name: "Date précise" }));
    fireEvent.change(screen.getByLabelText("Nouvelle date de relance"), { target: { value: day(0) } });
    fireEvent.click(screen.getByRole("button", { name: "Valider" }));
    await waitFor(() => expect(rowIds("today")).toEqual(["2", "3"]));
    expect(server.relanceCalls[0].body).toEqual({ date: day(0) });
  });

  it("consigne une interaction en place ; une saisie vide est refusée avec explication", async () => {
    renderScreen();
    await loaded();
    fireEvent.click(screen.getByRole("button", { name: "Consigner une interaction sur Dossier 2" }));
    fireEvent.click(screen.getByRole("button", { name: "Enregistrer" }));
    expect((await screen.findByRole("alert")).textContent).toContain("Choisissez un type");
    expect(server.interactionCalls).toHaveLength(0);
    fireEvent.change(screen.getByLabelText("Type d'interaction"), { target: { value: "Appel" } });
    fireEvent.change(screen.getByLabelText("Intitulé de l'interaction"), { target: { value: "Relance téléphone" } });
    fireEvent.click(screen.getByRole("button", { name: "Enregistrer" }));
    await waitFor(() => expect(server.interactionCalls).toEqual([{ type: "Appel", title: "Relance téléphone" }]));
    await waitFor(() => expect(toastApi.success).toHaveBeenCalledWith("Interaction consignée sur Dossier 2"));
    expect(refresh).toHaveBeenCalled();
  });

  it("échec d'écriture : la ligne revient, toast d'erreur avec Réessayer", async () => {
    server.code = "boom";
    renderScreen();
    await loaded();
    fireEvent.click(done("2"));
    await waitFor(() => expect(toastApi.error).toHaveBeenCalled());
    expect(toastApi.error.mock.calls[0][1].action.label).toBe("Réessayer");
    await waitFor(() => expect(rowIds("today")).toEqual(["2"]));
    server.code = "";
    toastApi.error.mock.calls[0][1].action.onClick();
    await waitFor(() => expect(rowIds("today")).toEqual([]));
    expect(server.relanceCalls).toHaveLength(2);
  });

  it("past_date renvoyé par le serveur : message explicite, ligne rétablie", async () => {
    server.code = "past_date";
    renderScreen();
    await loaded();
    fireEvent.click(snooze("3"));
    fireEvent.click(await screen.findByRole("menuitem", { name: "Date précise" }));
    fireEvent.change(screen.getByLabelText("Nouvelle date de relance"), { target: { value: day(2) } });
    fireEvent.click(screen.getByRole("button", { name: "Valider" }));
    await waitFor(() => expect(toastApi.error).toHaveBeenCalledWith("La date doit être aujourd'hui ou plus tard"));
    await waitFor(() => expect(rowIds("week")).toEqual(["3"]));
  });

  it("lecture seule : Faite et Reporter désactivés avec la raison, aucun appel", async () => {
    server.dto = makeDto({ canEdit: false });
    renderScreen();
    await loaded();
    expect(done("2").getAttribute("aria-disabled")).toBe("true");
    expect(snooze("2").getAttribute("aria-disabled")).toBe("true");
    fireEvent.click(done("2"));
    expect(server.relanceCalls).toHaveLength(0);
    expect(rowIds("today")).toEqual(["2"]);
  });

  it("saisie d'interaction indisponible sans droit ou sans champs raccordés", async () => {
    server.dto = makeDto({ canLog: false });
    renderScreen();
    await loaded();
    const log = screen.getByRole("button", { name: "Consigner une interaction sur Dossier 2" });
    expect(log.getAttribute("aria-disabled")).toBe("true");
    fireEvent.click(log);
    expect(screen.queryByLabelText("Type d'interaction")).toBeNull();
  });

  it("filtre Mes dossiers désactivé sans champ Responsable", async () => {
    server.dto = makeDto({ mineAvailable: false });
    renderScreen();
    await loaded();
    const b = screen.getByRole("button", { name: "Mes dossiers" });
    expect(b.getAttribute("aria-disabled")).toBe("true");
    expect(b.getAttribute("aria-pressed")).toBe("false");
  });

  it("retirer le filtre recharge sans mine", async () => {
    renderScreen();
    await loaded();
    fireEvent.click(screen.getByRole("button", { name: "Mes dossiers" }));
    await waitFor(() => expect(server.urls.some((u) => !u.includes("mine=1"))).toBe(true));
  });

  it("échec du rechargement après changement de filtre : état d'erreur avec Réessayer", async () => {
    renderScreen();
    await loaded();
    server.failWithoutMine = true;
    fireEvent.click(screen.getByRole("button", { name: "Mes dossiers" }));
    expect(await screen.findByText("Impossible de charger les données")).toBeTruthy();
    server.failWithoutMine = false;
    fireEvent.click(screen.getByRole("button", { name: "Réessayer" }));
    await screen.findByText("Dossier 1");
  });

  it("Annuler d'un report (date passée comprise) restaure l'ancienne date par { restore }", async () => {
    renderScreen();
    await loaded();
    fireEvent.click(snooze("1"));
    fireEvent.click(await screen.findByRole("menuitem", { name: "+1 jour" }));
    await waitFor(() => expect(rowIds("late")).toEqual([]));
    await waitFor(() => expect(toastApi.success).toHaveBeenCalled());
    toastApi.success.mock.calls[0][1].action.onClick();
    await waitFor(() => expect(server.relanceCalls).toHaveLength(2));
    expect(server.relanceCalls[1].body).toEqual({ restore: day(-4) });
    await waitFor(() => expect(rowIds("late")).toEqual(["1"]));
  });

  it("ouvre la fiche du dossier (pas la page Bases) avec précédent et suivant dans l'ordre de la file", async () => {
    renderScreen();
    await loaded();
    expect(screen.queryByRole("link", { name: "Ouvrir le dossier Dossier 2" })).toBeNull();
    fireEvent.click(screen.getByRole("button", { name: "Ouvrir le dossier Dossier 2" }));
    expect(await screen.findByRole("dialog", { name: /^Dossier :/ })).toBeTruthy();
    expect(await screen.findByTestId("fiche-relance")).toBeTruthy();
    expect(screen.getByText("Dossier 2 sur 3")).toBeTruthy();
  });

  it("aucune relance : état vide", async () => {
    server.dto = makeDto({ groups: { late: [], today: [], week: [] }, tasks: [] });
    renderScreen();
    expect(await screen.findByText("Aucune relance à faire cette semaine")).toBeTruthy();
    expect(screen.getByRole("link", { name: "Tous les dossiers" }).getAttribute("href")).toBe("/crm/dossiers");
  });

  it("groupe vide non affiché", async () => {
    server.dto = makeDto({ groups: { late: [], today: [item("2", day(0))], week: [] } });
    renderScreen();
    await screen.findByText("Dossier 2");
    expect(group("late")).toBeNull();
    expect(group("week")).toBeNull();
  });

  it("état de chargement puis erreur avec Réessayer", async () => {
    server.status = 500;
    vi.stubGlobal(
      "fetch",
      vi.fn(async (url: string) => {
        if (url.startsWith("/api/crm/connection")) return { ok: true, status: 200, json: async () => connection };
        return { ok: false, status: 500, json: async () => ({}) };
      }),
    );
    renderScreen();
    expect(screen.getByRole("status", { name: "Chargement des données" })).toBeTruthy();
    expect(await screen.findByText("Impossible de charger les données")).toBeTruthy();
    expect(screen.getByRole("button", { name: "Réessayer" })).toBeTruthy();
  });

  it("connexion incomplète (404) : état non raccordé", async () => {
    server.status = 404;
    renderScreen();
    expect(await screen.findByText("CRM non raccordé")).toBeTruthy();
  });
});

describe("RelanceRow : Reporter sans relance", () => {
  it("Reporter désactivé avec la raison quand la relance est vide", () => {
    render(
      wrap(
        <ul>
          <RelanceRow
            item={item("9", "")}
            today={today}
            late={false}
            onOpen={() => {}}
            interactionTypes={[]}
            panel={null}
            onPanel={() => {}}
            onDone={() => {}}
            onSnoozeDays={() => {}}
            onSnoozeDate={() => {}}
            onLog={() => {}}
          />
        </ul>,
      ),
    );
    expect(screen.getByRole("button", { name: "Reporter la relance de Dossier 9" }).getAttribute("aria-disabled")).toBe("true");
  });
});
