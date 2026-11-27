// @vitest-environment jsdom
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { cleanup, fireEvent, render, screen, waitFor, within } from "@testing-library/react";
import { NextIntlClientProvider } from "next-intl";
import { SWRConfig } from "swr";
import fr from "../../../../messages/fr.json";
import { addDaysIso, todayIn } from "@/lib/crm/dates";
import type { DealSheetDto } from "@/lib/crm/deals";
import { DealSheet } from "./deal-sheet";
import { makeDealSheetDto } from "./deal-sheet-fixture";

const toastApi = vi.hoisted(() => Object.assign(vi.fn(), { success: vi.fn(), error: vi.fn(), info: vi.fn() }));
vi.mock("@/components/bases/row-aside", () => ({ RowAside: () => null }));
vi.mock("@/i18n/routing", () => ({
  Link: ({ href, children, ...rest }: { href: string; children: React.ReactNode }) => (
    <a href={href} {...rest}>
      {children}
    </a>
  ),
}));
vi.mock("sonner", () => ({ toast: toastApi }));
vi.mock("next/navigation", () => ({
  useSearchParams: () => new URLSearchParams(""),
  useRouter: () => ({ push: vi.fn(), replace: vi.fn() }),
  usePathname: () => "/crm",
}));
vi.mock("@/lib/crm/use-crm-data", async (orig) => ({ ...(await orig<object>()), refreshCrmData: vi.fn(async () => undefined) }));

const today = todayIn(new Date(), Intl.DateTimeFormat().resolvedOptions().timeZone);

interface Server {
  dto: DealSheetDto | null;
  status: number;
  posts: { url: string; body: unknown }[];
  postOk: boolean;
  activity: unknown;
}
let server: Server;

beforeEach(() => {
  vi.stubGlobal("matchMedia", (q: string) => ({ matches: false, media: q, addEventListener: () => {}, removeEventListener: () => {}, addListener: () => {}, removeListener: () => {} }));
  for (const f of [toastApi, toastApi.success, toastApi.error]) f.mockClear();
  server = { dto: makeDealSheetDto(), status: 200, posts: [], postOk: true, activity: { items: [], role: "r", canLogInteraction: true, partial: [] } };
  vi.stubGlobal(
    "fetch",
    vi.fn(async (url: string, init?: RequestInit) => {
      if (init?.method === "POST") {
        server.posts.push({ url, body: JSON.parse(String(init.body)) });
        return server.postOk ? { ok: true, status: 200, json: async () => ({ relance: null }) } : { ok: false, status: 500, json: async () => ({}) };
      }
      if (url.startsWith("/api/crm/activity")) {
        return { ok: true, status: 200, json: async () => server.activity };
      }
      if (url.startsWith("/api/crm/deals/")) {
        if (server.status !== 200) return { ok: false, status: server.status, json: async () => ({}) };
        return { ok: true, status: 200, json: async () => server.dto };
      }
      return { ok: true, status: 200, json: async () => ({ rows: [], columns: [], events: [], comments: [], tasks: [] }) };
    }),
  );
});
afterEach(() => {
  cleanup();
  vi.unstubAllGlobals();
});

function renderSheet(props: Partial<React.ComponentProps<typeof DealSheet>> = {}) {
  const onClose = vi.fn();
  render(
    <NextIntlClientProvider locale="fr" messages={fr}>
      <SWRConfig value={{ provider: () => new Map(), dedupingInterval: 0 }}>
        <DealSheet rowId="1" onClose={onClose} {...props} />
      </SWRConfig>
    </NextIntlClientProvider>,
  );
  return { onClose };
}
const loaded = () => screen.findByTestId("fiche-relance");
const btn = (name: string | RegExp) => screen.getByRole("button", { name });

describe("DealSheet : sections CRM", () => {
  it("rend relance, contact lié et dernières interactions depuis le DTO", async () => {
    renderSheet();
    const relance = await loaded();
    expect(within(relance).getByRole("button", { name: /Marquer la relance de Dossier 1 comme faite/ })).toBeTruthy();
    const contact = screen.getByTestId("fiche-contact");
    expect(within(contact).getByText("Camille Roche")).toBeTruthy();
    expect(within(contact).getByText("camille@example.org")).toBeTruthy();
    expect(within(contact).getByText("BELOW DREAMS")).toBeTruthy();
    const feed = await screen.findByTestId("fiche-activity");
    expect(within(feed).getByText("Activité")).toBeTruthy();
    expect(await within(feed).findByText("Aucune activité")).toBeTruthy();
  });

  it("le fil affiche l'interaction ET le mail lié, sans plafond de 3", async () => {
    const mk = (n: number) => ({
      kind: "interaction",
      id: `i${n}`,
      date: `2030-01-${String(10 - n).padStart(2, "0")}`,
      interaction: { id: `i${n}`, date: `2030-01-${String(10 - n).padStart(2, "0")}`, type: "Appel", title: `Interaction ${n}`, note: null, dealId: "1" },
    });
    server.activity = {
      items: [
        ...[1, 2, 3, 4].map(mk),
        { kind: "mail", id: "m1", date: "2030-01-01T10:00:00.000Z", status: "sent", error: null, retryable: false, mail: { id: "m1", subject: "Mail lié", to: ["a@b.fr"], cc: [], bcc: [], bodyText: "", bodyHtml: "", date: "2030-01-01T10:00:00.000Z", status: "sent", error: null } },
      ],
      role: "r",
      canLogInteraction: true,
      partial: [],
    };
    renderSheet();
    await loaded();
    expect(await screen.findAllByTestId("fiche-interaction")).toHaveLength(4);
    expect(screen.getByText("Mail lié")).toBeTruthy();
  });

  it("chargement puis ligne introuvable (404) dans l'état du Sheet existant", async () => {
    server.status = 404;
    renderSheet();
    expect(await screen.findByText(fr.recordSheet.notFoundTitle)).toBeTruthy();
  });

  it("erreur serveur : état d'erreur avec Réessayer", async () => {
    server.status = 500;
    renderSheet();
    expect(await screen.findByText(fr.recordSheet.errorTitle)).toBeTruthy();
    expect(screen.getByRole("button", { name: fr.recordSheet.retry })).toBeTruthy();
  });

  it("Faite : une seule écriture, relance vidée, toast avec Annuler qui restaure", async () => {
    renderSheet();
    await loaded();
    fireEvent.click(btn(/comme faite/));
    await waitFor(() => expect(toastApi.success).toHaveBeenCalledTimes(1));
    expect(server.posts).toHaveLength(1);
    expect(server.posts[0].url).toContain("/api/crm/deals/1/relance");
    expect(server.posts[0].body).toEqual({ done: true });
    expect(screen.getByText("Aucune relance prévue.")).toBeTruthy();
    const opts = toastApi.success.mock.calls[0][1] as { action: { label: string; onClick: () => void } };
    expect(opts.action.label).toBe("Annuler");
    opts.action.onClick();
    await waitFor(() => expect(server.posts).toHaveLength(2));
    expect(server.posts[1].body).toEqual({ restore: "2030-01-10" });
  });

  it("échec de Faite : la relance revient, toast d'erreur avec Réessayer", async () => {
    server.postOk = false;
    renderSheet();
    await loaded();
    fireEvent.click(btn(/comme faite/));
    await waitFor(() => expect(toastApi.error).toHaveBeenCalled());
    expect((toastApi.error.mock.calls[0][1] as { action: { label: string } }).action.label).toBe("Réessayer");
    expect(btn(/comme faite/)).toBeTruthy();
  });

  it("Planifier : le raccourci Dans 3 jours écrit aujourd'hui + 3", async () => {
    renderSheet();
    await loaded();
    fireEvent.click(btn("Planifier une relance"));
    for (const l of ["Demain", "Dans 3 jours", "Dans 1 semaine", "Dans 2 semaines"]) expect(btn(l)).toBeTruthy();
    fireEvent.click(btn("Dans 3 jours"));
    await waitFor(() => expect(server.posts).toHaveLength(1));
    expect(server.posts[0].body).toEqual({ date: addDaysIso(today, 3) });
  });

  it("Planifier : date précise passée refusée sans appel, date valide écrite", async () => {
    renderSheet();
    await loaded();
    fireEvent.click(btn("Planifier une relance"));
    const input = screen.getByLabelText("Date de la relance");
    fireEvent.change(input, { target: { value: addDaysIso(today, -2) } });
    fireEvent.click(btn("Enregistrer"));
    expect(await screen.findByRole("alert")).toBeTruthy();
    expect(server.posts).toHaveLength(0);
    fireEvent.change(input, { target: { value: addDaysIso(today, 10) } });
    fireEvent.click(btn("Enregistrer"));
    await waitFor(() => expect(server.posts).toHaveLength(1));
    expect(server.posts[0].body).toEqual({ date: addDaysIso(today, 10) });
  });

  it("Escape dans la date précise ferme le panneau sans fermer la fiche", async () => {
    const { onClose } = renderSheet();
    await loaded();
    fireEvent.click(btn("Planifier une relance"));
    fireEvent.keyDown(screen.getByLabelText("Date de la relance"), { key: "Escape" });
    expect(screen.queryByLabelText("Date de la relance")).toBeNull();
    expect(onClose).not.toHaveBeenCalled();
  });

  it("section relance absente quand le champ n'est pas raccordé", async () => {
    server.dto = makeDealSheetDto({ relanceColumnId: null });
    renderSheet();
    await screen.findByTestId("fiche-contact");
    expect(screen.queryByTestId("fiche-relance")).toBeNull();
    expect(screen.queryByRole("button", { name: "Planifier une relance" })).toBeNull();
  });

  it("copier l'e-mail : presse-papiers puis toast ; désactivé avec raison sans e-mail", async () => {
    const writeText = vi.fn(async () => undefined);
    Object.defineProperty(navigator, "clipboard", { value: { writeText }, configurable: true });
    renderSheet();
    await loaded();
    fireEvent.click(btn(/Copier l'e-mail de Camille Roche/));
    await waitFor(() => expect(writeText).toHaveBeenCalledWith("camille@example.org"));
    await waitFor(() => expect(toastApi.success).toHaveBeenCalledWith("Adresse e-mail copiée"));
    cleanup();
    writeText.mockClear();
    server.dto = makeDealSheetDto({ contact: { id: "k1", name: "Camille Roche", email: null, phone: null, org: null } });
    renderSheet();
    await loaded();
    const copy = btn(/Copier l'e-mail de Camille Roche/);
    expect(copy.getAttribute("aria-disabled")).toBe("true");
    fireEvent.click(copy);
    expect(writeText).not.toHaveBeenCalled();
  });

  it("contact absent : Aucun contact lié avec Changer de contact", async () => {
    server.dto = makeDealSheetDto({ contact: null, contactRow: null });
    renderSheet();
    await loaded();
    expect(screen.getByText("Aucun contact lié")).toBeTruthy();
    expect(btn("Changer le contact du dossier").getAttribute("aria-disabled")).toBeNull();
  });

  it("Ouvrir la fiche du contact l'affiche dans le même Sheet générique", async () => {
    renderSheet();
    await loaded();
    fireEvent.click(btn("Ouvrir la fiche de Camille Roche"));
    expect(await screen.findByRole("dialog", { name: /Contact : Camille Roche/ })).toBeTruthy();
    expect(screen.queryByTestId("fiche-relance")).toBeNull();
  });

  it("lecteur : aucune écriture possible, raisons dans les boutons désactivés", async () => {
    server.dto = makeDealSheetDto({ canEdit: false });
    renderSheet();
    await loaded();
    for (const b of [btn(/comme faite/), btn("Planifier une relance"), btn("Changer le contact du dossier")]) {
      expect(b.getAttribute("aria-disabled")).toBe("true");
      fireEvent.click(b);
    }
    expect(server.posts).toHaveLength(0);
    expect(screen.queryByLabelText("Date de la relance")).toBeNull();
  });

  it("précédent et suivant suivent l'ordre fourni", async () => {
    const onNavigate = vi.fn();
    renderSheet({ nav: { index: 1, total: 3, prevId: "a", nextId: "c", outOfList: false }, onNavigate });
    await loaded();
    expect(screen.getByText("Dossier 2 sur 3")).toBeTruthy();
    fireEvent.click(screen.getByRole("button", { name: fr.recordSheet.next }));
    fireEvent.click(screen.getByRole("button", { name: fr.recordSheet.prev }));
    expect(onNavigate.mock.calls).toEqual([["c"], ["a"]]);
  });
});
