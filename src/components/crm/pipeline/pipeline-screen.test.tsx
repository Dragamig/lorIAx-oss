// @vitest-environment jsdom
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { act, cleanup, fireEvent, render, screen, waitFor, within } from "@testing-library/react";
import { NextIntlClientProvider } from "next-intl";
import { SWRConfig } from "swr";
import fr from "../../../../messages/fr.json";
import type { PipelineDeal, PipelineDto } from "@/lib/crm/pipeline";
import { makeDealSheetDto } from "../fiche/deal-sheet-fixture";
import { PipelineScreen } from "./pipeline-screen";

const toastApi = vi.hoisted(() => {
  const fn = Object.assign(vi.fn(), { success: vi.fn(), error: vi.fn(), info: vi.fn() });
  return fn;
});
vi.mock("@/components/bases/row-aside", () => ({ RowAside: () => null }));
vi.mock("sonner", () => ({ toast: toastApi }));
vi.mock("next/navigation", () => ({
  useSearchParams: () => new URLSearchParams(""),
  useRouter: () => ({ push: vi.fn(), replace: vi.fn() }),
  usePathname: () => "/crm",
}));
vi.mock("@/i18n/routing", () => ({
  Link: ({ href, children, ...rest }: { href: string; children: React.ReactNode }) => (
    <a href={href} {...rest}>
      {children}
    </a>
  ),
}));

const ST = "c-statut";
const AM = "c-montant";
const deal = (id: string, status: string | null, amount: number | null, over: Partial<PipelineDeal> = {}): PipelineDeal => ({
  id,
  title: `Dossier ${id}`,
  status,
  amount,
  relance: null,
  closeDate: null,
  ownerIds: [],
  contactId: null,
  contactName: `Contact ${id}`,
  cells: { [ST]: status, [AM]: amount },
  ...over,
});

function makeDto(over: Partial<PipelineDto> = {}): PipelineDto {
  return {
    spaceId: "s",
    databaseId: "db-d",
    columns: [
      { id: ST, name: "Statut", type: "select", config: { options: ["Nouveau", "Gagné"] } },
      { id: AM, name: "Montant", type: "number", config: {} },
    ],
    statusColumnId: ST,
    amountColumnId: AM,
    lanes: [
      { key: "Nouveau", label: "Nouveau" },
      { key: "Gagné", label: "Gagné" },
      { key: "", label: "Sans valeur" },
    ],
    deals: [
      deal("1", "Nouveau", 1000, { ownerIds: ["u1"], relance: "2020-01-05" }),
      deal("2", "Nouveau", 500),
      deal("3", "Gagné", null),
    ],
    totals: { amountColumnId: AM, closedLanes: ["Gagné"], weights: { Nouveau: 50 }, showWeighted: true },
    totalsViewId: "v",
    mineAvailable: true,
    lateAvailable: true,
    canEdit: true,
    missing: [],
    owners: [{ id: "u1", name: "Anne Martin" }],
    ...over,
  };
}

const connection = {
  roles: { dossiers: { connected: true, databaseId: "db-d", databaseName: "Affaires", spaceName: "Direction" } },
};

interface Server {
  dto: PipelineDto;
  patchOk: boolean;
  pipelineUrls: string[];
  patches: unknown[];
  pipelineStatus: number;
}
let server: Server;

function install() {
  vi.stubGlobal(
    "fetch",
    vi.fn(async (url: string, init?: RequestInit) => {
      if (url.startsWith("/api/crm/connection")) return { ok: true, status: 200, json: async () => connection };
      if (url.startsWith("/api/crm/status")) return { ok: true, status: 200, json: async () => ({ enabled: true, complete: true, canAdmin: true }) };
      if (url.startsWith("/api/crm/pipeline")) {
        server.pipelineUrls.push(url);
        if (server.pipelineStatus !== 200) return { ok: false, status: server.pipelineStatus, json: async () => ({}) };
        return { ok: true, status: 200, json: async () => server.dto };
      }
      if (url.startsWith("/api/crm/activity")) return { ok: true, status: 200, json: async () => ({ items: [], role: "r", canLogInteraction: true, partial: [] }) };
      if (!init?.method && /^\/api\/crm\/deals\/[^/?]+$/.test(url)) {
        return { ok: true, status: 200, json: async () => makeDealSheetDto() };
      }
      if (init?.method === "PATCH") {
        const body = JSON.parse(String(init.body)) as { rows: { id: string; cells: Record<string, string | null> }[] };
        server.patches.push(body);
        if (!server.patchOk) return { ok: false, status: 500, json: async () => ({}) };
        const { id, cells } = body.rows[0];
        server.dto = {
          ...server.dto,
          deals: server.dto.deals.map((d) => (d.id === id ? { ...d, status: cells[ST], cells: { ...d.cells, ...cells } } : d)),
        };
        return { ok: true, status: 200, json: async () => ({}) };
      }
      return { ok: true, status: 200, json: async () => ({}) };
    }),
  );
}

function renderScreen() {
  return render(
    <NextIntlClientProvider locale="fr" messages={fr}>
      <SWRConfig value={{ provider: () => new Map(), dedupingInterval: 0 }}>
        <PipelineScreen />
      </SWRConfig>
    </NextIntlClientProvider>,
  );
}

const lane = (key: string) => document.querySelector(`[data-lane="${key}"]`) as HTMLElement;
const laneAmount = (key: string) => within(lane(key)).getByTestId("kanban-lane-amount").textContent ?? "";
const digits = (s: string) => s.replace(/\D/g, "");

beforeEach(() => {
  vi.stubGlobal("matchMedia", (q: string) => ({ matches: false, media: q, addEventListener: () => {}, removeEventListener: () => {}, addListener: () => {}, removeListener: () => {} }));
  toastApi.mockClear();
  toastApi.success.mockClear();
  toastApi.error.mockClear();
  server = { dto: makeDto(), patchOk: true, pipelineUrls: [], patches: [], pipelineStatus: 200 };
  install();
});
afterEach(() => {
  cleanup();
  vi.unstubAllGlobals();
});

async function moveVia(title: string, laneLabel: RegExp | string) {
  const trigger = screen.getByRole("button", { name: `Changer le statut du dossier ${title}` });
  trigger.focus();
  fireEvent.click(trigger);
  const item = await screen.findByRole("menuitem", { name: laneLabel });
  fireEvent.click(item);
}

describe("PipelineScreen", () => {
  it("demande mine=1 par défaut et le retire quand on désactive Mes dossiers", async () => {
    renderScreen();
    await screen.findAllByTestId("pipeline-card");
    expect(server.pipelineUrls[0]).toContain("mine=1");
    const mineBtn = screen.getByRole("button", { name: "Mes dossiers" });
    expect(mineBtn.getAttribute("aria-pressed")).toBe("true");
    fireEvent.click(mineBtn);
    await waitFor(() => expect(server.pipelineUrls.some((u) => !u.includes("mine=1"))).toBe(true));
    await waitFor(() => expect(screen.getByRole("button", { name: "Mes dossiers" }).getAttribute("aria-pressed")).toBe("false"));
    // La barre d'outils reste montée pendant le rechargement.
    expect(screen.getByRole("button", { name: "Mes dossiers" })).toBeTruthy();
  });

  it("affiche les totaux par voie et le bandeau, et la ligne Pondéré avec Total pondéré", async () => {
    renderScreen();
    await screen.findAllByTestId("pipeline-card");
    expect(digits(laneAmount("Nouveau"))).toBe("1500");
    expect(screen.getByTestId("kanban-totals-banner").textContent).toContain("3 dossiers");
    expect(screen.queryByTestId("kanban-lane-weighted")).toBeNull();
    fireEvent.click(screen.getByRole("button", { name: "Total pondéré" }));
    await waitFor(() => expect(within(lane("Nouveau")).getByTestId("kanban-lane-weighted").textContent).toContain("Pondéré (50 %)"));
    expect(screen.getByTestId("kanban-totals-banner").textContent).toContain("pondérés");
  });

  it("ouvrir une carte monte la fiche CRM du dossier (sections CRM, précédent et suivant)", async () => {
    renderScreen();
    await screen.findAllByTestId("pipeline-card");
    fireEvent.click(screen.getByRole("button", { name: "Ouvrir le dossier Dossier 2" }));
    expect(await screen.findByTestId("fiche-relance")).toBeTruthy();
    expect(screen.getByTestId("fiche-contact")).toBeTruthy();
    expect(screen.getByRole("button", { name: fr.recordSheet.next })).toBeTruthy();
  });

  it("n'affiche aucun bouton + de création de carte", async () => {
    renderScreen();
    await screen.findAllByTestId("pipeline-card");
    expect(screen.queryByRole("button", { name: /Ajouter une carte/ })).toBeNull();
  });

  it("cartes : montant ou Non chiffré, échéance en retard, initiales, état vide par voie", async () => {
    renderScreen();
    await screen.findAllByTestId("pipeline-card");
    const c3 = within(lane("Gagné")).getByTestId("pipeline-card");
    expect(c3.textContent).toContain("Non chiffré");
    const c1 = within(lane("Nouveau")).getAllByTestId("pipeline-card")[0];
    expect(within(c1).getByLabelText(/Relance en retard/)).toBeTruthy();
    expect(within(c1).getByLabelText("Responsable : AM")).toBeTruthy();
    expect(within(lane("")).getByText("Aucun dossier")).toBeTruthy();
    expect(within(lane("")).getByTestId("kanban-lane-header").textContent).toContain("Sans valeur");
  });

  it("le menu Changer le statut déplace la carte au clavier, met à jour les deux totaux et PATCH une fois", async () => {
    renderScreen();
    await screen.findAllByTestId("pipeline-card");
    await moveVia("Dossier 1", "Gagné");
    await waitFor(() => expect(within(lane("Gagné")).getAllByTestId("pipeline-card")).toHaveLength(2));
    expect(digits(laneAmount("Nouveau"))).toBe("500");
    expect(digits(laneAmount("Gagné"))).toBe("1000");
    await waitFor(() => expect(server.patches).toHaveLength(1));
    expect(server.patches[0]).toEqual({ rows: [{ id: "1", cells: { [ST]: "Gagné" } }] });
    await waitFor(() => expect(toastApi.success).toHaveBeenCalledTimes(1));
    expect(toastApi.success.mock.calls[0][0]).toBe("Dossier 1 déplacé vers Gagné");
  });

  it("le menu se pilote avec les flèches : la navigation déplace le focus, Entrée valide l'élément actif", async () => {
    renderScreen();
    await screen.findAllByTestId("pipeline-card");
    const trigger = screen.getByRole("button", { name: "Changer le statut du dossier Dossier 2" });
    trigger.focus();
    fireEvent.click(trigger); // Entrée sur un bouton natif déclenche un clic
    const items = await screen.findAllByRole("menuitem");
    expect(items.map((i) => i.textContent)).toEqual(["Nouveau (statut actuel)", "Gagné", "Sans valeur"]);
    act(() => items[1].focus());
    fireEvent.keyDown(items[1], { key: "ArrowDown" });
    await waitFor(() => expect(document.activeElement).toBe(items[2]));
    fireEvent.keyDown(items[2], { key: "ArrowUp" });
    await waitFor(() => expect(document.activeElement).toBe(items[1]));
    fireEvent.click(document.activeElement as HTMLElement);
    await waitFor(() => expect(server.patches).toHaveLength(1));
    expect((server.patches[0] as { rows: { cells: Record<string, string> }[] }).rows[0].cells[ST]).toBe("Gagné");
  });

  it("choisir la voie actuelle n'envoie aucun PATCH", async () => {
    renderScreen();
    await screen.findAllByTestId("pipeline-card");
    const trigger = screen.getByRole("button", { name: "Changer le statut du dossier Dossier 1" });
    fireEvent.click(trigger);
    const current = await screen.findByRole("menuitem", { name: "Nouveau (statut actuel)" });
    fireEvent.click(current);
    await act(async () => {});
    expect(server.patches).toHaveLength(0);
  });

  it("échec du PATCH : la carte revient, toast d'erreur avec Réessayer", async () => {
    server.patchOk = false;
    renderScreen();
    await screen.findAllByTestId("pipeline-card");
    await moveVia("Dossier 1", "Gagné");
    await waitFor(() => expect(toastApi.error).toHaveBeenCalledTimes(1));
    expect(within(lane("Nouveau")).getAllByTestId("pipeline-card")).toHaveLength(2);
    expect(digits(laneAmount("Nouveau"))).toBe("1500");
    const opts = toastApi.error.mock.calls[0][1] as { action: { label: string; onClick: () => void } };
    expect(opts.action.label).toBe("Réessayer");
    server.patchOk = true;
    await act(async () => opts.action.onClick());
    await waitFor(() => expect(within(lane("Gagné")).getAllByTestId("pipeline-card")).toHaveLength(2));
    expect(server.patches).toHaveLength(2);
  });

  it("Annuler restaure la carte et ses totaux", async () => {
    renderScreen();
    await screen.findAllByTestId("pipeline-card");
    await moveVia("Dossier 1", "Gagné");
    await waitFor(() => expect(toastApi.success).toHaveBeenCalledTimes(1));
    const opts = toastApi.success.mock.calls[0][1] as { action: { label: string; onClick: () => void } };
    expect(opts.action.label).toBe("Annuler");
    await act(async () => opts.action.onClick());
    await waitFor(() => expect(within(lane("Nouveau")).getAllByTestId("pipeline-card")).toHaveLength(2));
    expect(digits(laneAmount("Nouveau"))).toBe("1500");
    expect(server.patches).toHaveLength(2);
    expect((server.patches[1] as { rows: { cells: Record<string, string> }[] }).rows[0].cells[ST]).toBe("Nouveau");
  });

  it("pendant un rechargement : tableau occupé, bandeau masqué, déplacement désactivé avec sa raison", async () => {
    renderScreen();
    await screen.findAllByTestId("pipeline-card");
    let release: () => void = () => {};
    const gate = new Promise<void>((r) => (release = r));
    const inner = global.fetch as unknown as (u: string, i?: RequestInit) => Promise<unknown>;
    vi.stubGlobal("fetch", vi.fn(async (u: string, i?: RequestInit) => {
      if (u.startsWith("/api/crm/pipeline")) await gate;
      return inner(u, i);
    }));
    fireEvent.click(screen.getByRole("button", { name: "Mes dossiers" }));
    await waitFor(() => expect(screen.getByRole("list", { name: "Pipeline par statut" }).getAttribute("aria-busy")).toBe("true"));
    expect(screen.queryByTestId("kanban-totals-banner")).toBeNull();
    const btn = screen.getByRole("button", { name: "Changer le statut du dossier Dossier 1" });
    expect(btn.getAttribute("aria-disabled")).toBe("true");
    fireEvent.click(btn);
    expect(screen.queryByRole("menuitem")).toBeNull();
    fireEvent.focus(btn);
    expect(await screen.findByText("Rechargement en cours : déplacement indisponible")).toBeTruthy();
    expect(server.patches).toHaveLength(0);
    release();
    await waitFor(() => expect(screen.getByRole("list", { name: "Pipeline par statut" }).getAttribute("aria-busy")).toBe("false"));
    expect(screen.getByTestId("kanban-totals-banner")).toBeTruthy();
  });

  describe("glisser-déposer", () => {
    const MIME = "application/x-crm-deal";
    const card = (id: string) => document.querySelector(`[data-testid="pipeline-card"][data-id="${id}"]`) as HTMLElement;
    function dragData() {
      const store: Record<string, string> = {};
      return {
        types: [] as string[],
        setData(t: string, v: string) {
          store[t] = v;
          this.types = Object.keys(store);
        },
        getData: (t: string) => store[t] ?? "",
        effectAllowed: "",
        dropEffect: "",
      };
    }
    async function dragTo(id: string, laneKey: string) {
      const data = dragData();
      fireEvent.dragStart(card(id), { dataTransfer: data });
      fireEvent.dragOver(lane(laneKey), { dataTransfer: data });
      await act(async () => {
        fireEvent.drop(lane(laneKey), { dataTransfer: data });
      });
      return data;
    }

    it("déposer une carte sur une autre voie la déplace par le même chemin : totaux, un PATCH, toast Annuler", async () => {
      renderScreen();
      await screen.findAllByTestId("pipeline-card");
      await dragTo("1", "Gagné");
      await waitFor(() => expect(within(lane("Gagné")).getAllByTestId("pipeline-card")).toHaveLength(2));
      expect(digits(laneAmount("Gagné"))).toBe("1000");
      await waitFor(() => expect(server.patches).toHaveLength(1));
      expect(server.patches[0]).toEqual({ rows: [{ id: "1", cells: { [ST]: "Gagné" } }] });
      await waitFor(() => expect(toastApi.success).toHaveBeenCalledTimes(1));
      expect((toastApi.success.mock.calls[0][1] as { action: { label: string } }).action.label).toBe("Annuler");
      expect(screen.getByRole("status", { name: "Annonce des déplacements" }).textContent).toBe("Dossier 1 déplacé vers Gagné");
    });

    it("déposer sur la voie d'origine n'envoie aucun PATCH", async () => {
      renderScreen();
      await screen.findAllByTestId("pipeline-card");
      await dragTo("1", "Nouveau");
      expect(server.patches).toHaveLength(0);
    });

    it("échec du PATCH : la carte revient et l'annonce signale l'échec", async () => {
      server.patchOk = false;
      renderScreen();
      await screen.findAllByTestId("pipeline-card");
      await dragTo("1", "Gagné");
      await waitFor(() => expect(toastApi.error).toHaveBeenCalledTimes(1));
      expect(within(lane("Nouveau")).getAllByTestId("pipeline-card")).toHaveLength(2);
      await waitFor(() =>
        expect(screen.getByRole("status", { name: "Annonce des déplacements" }).textContent).toBe("Déplacement impossible : Dossier 1 reste dans Nouveau"),
      );
    });

    it("lecture seule : cartes non glissables, aucun PATCH", async () => {
      server.dto = makeDto({ canEdit: false });
      renderScreen();
      await screen.findAllByTestId("pipeline-card");
      expect(card("1").getAttribute("draggable")).toBe("false");
      await dragTo("1", "Gagné");
      expect(server.patches).toHaveLength(0);
    });

    it("pendant un rechargement : cartes non glissables, aucun PATCH", async () => {
      renderScreen();
      await screen.findAllByTestId("pipeline-card");
      let release: () => void = () => {};
      const gate = new Promise<void>((r) => (release = r));
      const inner = global.fetch as unknown as (u: string, i?: RequestInit) => Promise<unknown>;
      vi.stubGlobal("fetch", vi.fn(async (u: string, i?: RequestInit) => {
        if (u.startsWith("/api/crm/pipeline")) await gate;
        return inner(u, i);
      }));
      fireEvent.click(screen.getByRole("button", { name: "Mes dossiers" }));
      await waitFor(() => expect(screen.getByRole("list", { name: "Pipeline par statut" }).getAttribute("aria-busy")).toBe("true"));
      expect(card("1").getAttribute("draggable")).toBe("false");
      await dragTo("1", "Gagné");
      expect(server.patches).toHaveLength(0);
      release();
      await waitFor(() => expect(card("1").getAttribute("draggable")).toBe("true"));
    });

    it("la voie survolée est signalée visuellement", async () => {
      renderScreen();
      await screen.findAllByTestId("pipeline-card");
      const data = dragData();
      fireEvent.dragStart(card("1"), { dataTransfer: data });
      fireEvent.dragOver(lane("Gagné"), { dataTransfer: data });
      expect(lane("Gagné").getAttribute("data-drop-target")).toBe("true");
      expect(lane("Nouveau").getAttribute("data-drop-target")).toBeNull();
      expect(data.types).toContain(MIME);
    });
  });

  it("ouvrir la carte : le titre ouvre le panneau, le menu de déplacement et le glisser ne l'ouvrent pas", async () => {
    const dealFetches = () => vi.mocked(fetch).mock.calls.filter(([u]) => /^\/api\/crm\/deals\/[^/?]+$/.test(String(u))).length;
    renderScreen();
    await screen.findAllByTestId("pipeline-card");
    const before = dealFetches();
    fireEvent.click(screen.getByRole("button", { name: "Changer le statut du dossier Dossier 1" }));
    await screen.findByRole("menuitem", { name: "Gagné" });
    fireEvent.keyDown(document.activeElement ?? document.body, { key: "Escape" });
    const card = document.querySelector('[data-testid="pipeline-card"][data-id]') as HTMLElement;
    fireEvent.dragStart(card, { dataTransfer: { setData: () => {}, effectAllowed: "", types: [] } });
    fireEvent.dragEnd(card);
    expect(dealFetches()).toBe(before);
    expect(card.className).toContain("hover:shadow-md");
    fireEvent.click(within(card).getByRole("button", { name: /^Ouvrir/ }));
    await waitFor(() => expect(dealFetches()).toBeGreaterThan(before));
  });

  it("le lien Modifier les voies ouvre la vue des totaux", async () => {
    server.dto = makeDto({ totalsViewId: "v1" });
    renderScreen();
    await screen.findAllByTestId("pipeline-card");
    expect(document.querySelector('[data-action="pipelineOpenInBases"]')?.getAttribute("href")).toBe("/bases/db-d/views/v1?spaceId=s");
  });

  it("lecture seule : le bouton de déplacement est désactivé avec sa raison", async () => {
    server.dto = makeDto({ canEdit: false });
    renderScreen();
    await screen.findAllByTestId("pipeline-card");
    const btn = screen.getByRole("button", { name: "Changer le statut du dossier Dossier 1" });
    expect(btn.getAttribute("aria-disabled")).toBe("true");
    fireEvent.click(btn);
    expect(screen.queryByRole("menuitem")).toBeNull();
    fireEvent.focus(btn);
    expect(await screen.findByText("Lecture seule : vous ne pouvez pas modifier les statuts")).toBeTruthy();
  });

  it("mineAvailable false : Mes dossiers est désactivé avec la raison", async () => {
    server.dto = makeDto({ mineAvailable: false });
    renderScreen();
    await screen.findAllByTestId("pipeline-card");
    const btn = screen.getByRole("button", { name: "Mes dossiers" });
    expect(btn.getAttribute("aria-disabled")).toBe("true");
    expect(btn.getAttribute("aria-pressed")).toBe("false");
    fireEvent.focus(btn);
    expect(await screen.findByText(/Le champ Responsable n'est pas raccordé/)).toBeTruthy();
  });

  it("le filtre Responsable relance la requête avec ownerId", async () => {
    renderScreen();
    await screen.findAllByTestId("pipeline-card");
    const trigger = screen.getByRole("button", { name: "Filtrer par responsable : Tous" });
    fireEvent.click(trigger);
    fireEvent.click(await screen.findByRole("menuitem", { name: "Anne Martin" }));
    await waitFor(() => expect(server.pipelineUrls.some((u) => u.includes("ownerId=u1"))).toBe(true));
  });

  it("état de chargement : squelettes annoncés", () => {
    renderScreen();
    expect(screen.getByRole("status", { name: "Chargement des données" })).toBeTruthy();
  });

  it("état d'erreur : alerte et Réessayer relance la requête", async () => {
    server.pipelineStatus = 500;
    renderScreen();
    expect(await screen.findByRole("alert")).toBeTruthy();
    const before = server.pipelineUrls.length;
    server.pipelineStatus = 200;
    fireEvent.click(screen.getByRole("button", { name: "Réessayer" }));
    await screen.findAllByTestId("pipeline-card");
    expect(server.pipelineUrls.length).toBeGreaterThan(before);
  });

  it("échec du rechargement après changement de filtre : alerte et Réessayer", async () => {
    renderScreen();
    await screen.findAllByTestId("pipeline-card");
    server.pipelineStatus = 500;
    fireEvent.click(screen.getByRole("button", { name: "Mes dossiers" }));
    expect(await screen.findByRole("alert")).toBeTruthy();
    server.pipelineStatus = 200;
    fireEvent.click(screen.getByRole("button", { name: "Réessayer" }));
    await screen.findAllByTestId("pipeline-card");
  });
  it("Statut non raccordé (bad) : avis, déplacement désactivé avec sa raison, aucun PATCH", async () => {
    server.dto = makeDto({ statusColumnId: null, canEdit: false, missing: ["statut"] });
    renderScreen();
    await screen.findAllByTestId("pipeline-card");
    expect(await screen.findByTestId("crm-fields-notice")).toBeTruthy();
    expect(await screen.findByRole("link", { name: "Raccordement" })).toBeTruthy();
    const moveButtons = screen.getAllByRole("button", { name: /Changer le statut/ });
    for (const b of moveButtons) {
      expect(b.getAttribute("aria-disabled")).toBe("true");
      fireEvent.click(b);
    }
    expect(server.patches).toHaveLength(0);
  });

  it("non raccordé (404) : renvoie vers le raccordement", async () => {
    server.pipelineStatus = 404;
    renderScreen();
    expect(await screen.findByRole("link", { name: "Raccordement" })).toBeTruthy();
  });

  it("tous les boutons ont un nom accessible et une action du registre", async () => {
    renderScreen();
    await screen.findAllByTestId("pipeline-card");
    const buttons = screen.getAllByRole("button");
    for (const b of buttons) {
      expect((b.getAttribute("aria-label") ?? b.textContent ?? "").trim(), b.outerHTML).not.toBe("");
    }
    for (const b of document.querySelectorAll("[data-action]")) {
      expect(b.getAttribute("data-action")).toMatch(/^pipeline[A-Z]|openInBases|retry|goToRaccordement/);
    }
  });
});
