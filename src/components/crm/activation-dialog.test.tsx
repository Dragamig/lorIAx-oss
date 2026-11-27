// @vitest-environment jsdom
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { cleanup, fireEvent, render, screen, waitFor, within } from "@testing-library/react";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { OrganizationProvider } from "@/lib/org/organization-context";
import { CRM_ACTIONS } from "@/lib/crm/actions";
import { ActivationDialog } from "./activation-dialog";

const h = vi.hoisted(() => ({ success: vi.fn(), error: vi.fn(), push: vi.fn(), forceMissing: false }));

vi.mock("next-intl", async () => (await import("@/components/media/test-fixtures")).intlMock());
vi.mock("sonner", () => ({ toast: Object.assign(vi.fn(), { success: h.success, error: h.error, custom: h.success, dismiss: vi.fn() }) }));
vi.mock("./activation-state", async () => {
  const actual = await vi.importActual<typeof import("./activation-state")>("./activation-state");
  return { ...actual, missingBases: (...args: Parameters<typeof actual.missingBases>) => (h.forceMissing ? (["dossiers"] as const) : actual.missingBases(...args)) };
});
vi.mock("@/i18n/routing", () => ({ useRouter: () => ({ push: h.push, refresh: vi.fn() }) }));

const SP = "55555555-5555-4555-8555-555555555555";
const C1 = "11111111-1111-4111-8111-111111111111";
const D1 = "22222222-2222-4222-8222-222222222222";
const X1 = "44444444-4444-4444-8444-444444444444";

type Status = "compatible" | "almost" | "none";
const cand = (databaseId: string, name: string, status: Status, score = 4, missing: unknown[] = []) => ({
  databaseId,
  name,
  spaceId: SP,
  spaceName: "CRM",
  columns: [],
  proposal: {},
  score,
  compatible: status === "compatible",
  status,
  missing,
});
const none = { candidates: [] as unknown[], preselected: null };
const noCollisions = { contacts: [], dossiers: [], interactions: [] };
const orgs = [
  { slug: "lor", name: "LorIAx" },
  { slug: "dra", name: "Acme" },
];

function mixed() {
  return {
    roles: {
      contacts: { candidates: [cand(C1, "Contacts", "compatible", 4)], preselected: C1 },
      dossiers: {
        candidates: [
          cand(C1, "Contacts", "almost", 3),
          { ...cand(D1, "Demandes", "almost", 3, []), columns: [{ id: "k1", name: "Montant", type: "text" }], missing: [
            { fieldKey: "statut", name: "Statut", type: "select", cause: "absent" },
            { fieldKey: "montant", name: "Montant (nombre)", type: "number", cause: "wrong_type", existingName: "Montant" },
          ] },
        ],
        preselected: null,
      },
      interactions: none,
    },
    existing: false,
    spaces: [{ id: SP, name: "CRM" }],
    suggestedSpaceId: SP,
    collisions: noCollisions,
    orgs,
  };
}

let preview: object | "fail";
let activateStatus: number;
const calls: { url: string; method: string; body?: unknown }[] = [];
const hrefSet = vi.fn();

beforeEach(() => {
  calls.length = 0;
  h.success.mockReset();
  h.error.mockReset();
  h.push.mockReset();
  hrefSet.mockReset();
  h.forceMissing = false;
  activateStatus = 200;
  preview = mixed();
  Object.defineProperty(window, "location", {
    configurable: true,
    value: {
      pathname: "/",
      search: "",
      hash: "",
      set href(v: string) {
        hrefSet(v);
      },
      get href() {
        return "";
      },
    },
  });
  vi.stubGlobal(
    "fetch",
    vi.fn(async (url: string, init?: RequestInit) => {
      const method = init?.method ?? "GET";
      calls.push({ url, method, body: init?.body ? JSON.parse(String(init.body)) : undefined });
      if (url === "/api/crm/activate/preview") {
        if (preview === "fail") return { ok: false, status: 500, json: async () => ({}) };
        return { ok: true, status: 200, json: async () => preview };
      }
      if (url === "/api/crm/activate") {
        return { ok: activateStatus === 200, status: activateStatus, json: async () => ({ enabled: true, reactivated: false }) };
      }
      return { ok: true, status: 200, json: async () => ({ enabled: false }) };
    }),
  );
});

afterEach(() => {
  cleanup();
  vi.unstubAllGlobals();
});

const orgValue = {
  org: { id: "o1", slug: "lor", name: "LorIAx", plan: "free", maxUsers: null, maxSpaces: null, memberCount: 1 },
  role: "admin" as const,
  isSuperAdmin: false,
};

function mount(props: Partial<React.ComponentProps<typeof ActivationDialog>> = {}) {
  const onDone = vi.fn();
  const onOpenChange = vi.fn();
  render(
    <OrganizationProvider value={orgValue}>
      <ActivationDialog open onOpenChange={onOpenChange} onDone={onDone} {...props} />
    </OrganizationProvider>,
  );
  return { onDone, onOpenChange };
}

const popups = () => Array.from(document.body.querySelectorAll("div.bg-foreground.text-background"));

async function ready() {
  await screen.findByRole("group", { name: "Mode pour Contacts" });
}

const nextBtn = () => screen.getByRole("button", { name: "Suivant" });
async function toRecap() {
  fireEvent.click(nextBtn());
  await screen.findByRole("button", { name: "Retour" });
}

describe("ActivationDialog", () => {
  it("chargement : squelettes de tuiles, puis trois tuiles de largeur et de hauteur identiques (même classe)", async () => {
    mount();
    expect(screen.getByRole("status", { name: "Analyse des bases de l'organisation" })).toBeTruthy();
    expect(screen.getAllByLabelText(/chargement/).length).toBe(3);
    await ready();
    const tiles = ["Contacts", "Dossiers", "Interactions"].map((r) => screen.getByTestId(`activation-role-${r.toLowerCase()}`));
    expect(tiles.length).toBe(3);
    const cls = new Set(tiles.map((el) => el.className));
    expect(cls.size).toBe(1);
    expect([...cls][0]).toMatch(/h-\[440px\]/);
  });

  it("modes initiaux : Raccorder, Compléter, Créer, avec colonnes ajoutées et mauvais type à côté", async () => {
    mount();
    await ready();
    const pressed = (role: string, mode: string) =>
      within(screen.getByRole("group", { name: `Mode pour ${role}` })).getByRole("button", { name: new RegExp(`^${mode} pour`) });
    expect(pressed("Contacts", "Raccorder").getAttribute("aria-pressed")).toBe("true");
    expect(pressed("Dossiers", "Compléter").getAttribute("aria-pressed")).toBe("true");
    expect(pressed("Interactions", "Créer").getAttribute("aria-pressed")).toBe("true");
    expect(screen.getByText("Colonnes ajoutées (3)")).toBeTruthy();
    expect(screen.getByText(/À côté de « Montant » \(Texte, conservée\)/)).toBeTruthy();
  });

  it("sélecteur d'espace désactivé sans rôle en Créer, avec raison en info-bulle", async () => {
    const p = mixed();
    p.roles.interactions = { candidates: [cand(X1, "Interactions", "compatible", 6)], preselected: X1 } as never;
    preview = p;
    mount();
    await ready();
    const select = screen.getByLabelText("Espace des bases à créer") as HTMLSelectElement;
    expect(select.disabled).toBe(true);
    fireEvent.focus(select.parentElement as HTMLElement);
    expect(await screen.findByText("Aucune base à créer : tous les rôles sont raccordés ou complétés")).toBeTruthy();
  });

  it("sélecteur d'espace actif quand un rôle est en Créer", async () => {
    mount();
    await ready();
    expect((screen.getByLabelText("Espace des bases à créer") as HTMLSelectElement).disabled).toBe(false);
  });

  it("choisir une autre organisation redirige vers l'URL de l'organisation avec ?activer-crm=1 et n'appelle aucune route", async () => {
    mount();
    await ready();
    const before = calls.length;
    fireEvent.change(screen.getByLabelText("Organisation"), { target: { value: "dra" } });
    expect(hrefSet).toHaveBeenCalledWith("/org/dra/admin/modules?activer-crm=1");
    expect(calls.length).toBe(before);
  });

  it("changement d'organisation : Annuler et Confirmer expliquent le blocage, tuiles inertes, déblocage au retour de page", async () => {
    mount();
    await ready();
    fireEvent.change(screen.getByLabelText("Organisation"), { target: { value: "dra" } });
    const confirm = nextBtn();
    const close = screen.getByRole("button", { name: "Fermer la fenêtre d'activation" });
    expect(confirm.getAttribute("aria-disabled")).toBe("true");
    expect(close.getAttribute("aria-disabled")).toBe("true");
    fireEvent.focus(close);
    expect((await screen.findAllByText("Changement d'organisation en cours")).length).toBeGreaterThan(0);
    expect(screen.getByTestId("activation-role-contacts").closest("fieldset")?.disabled).toBe(true);
    fireEvent(window, new Event("pageshow"));
    await waitFor(() => expect(screen.getByRole("button", { name: "Fermer la fenêtre d'activation" }).getAttribute("aria-disabled")).toBeNull());
    expect(screen.getByTestId("activation-role-contacts").closest("fieldset")?.disabled).toBe(false);
  });

  it("collision : mode Créer indisponible et message avec le nom", async () => {
    const p = mixed();
    p.roles.dossiers = { candidates: [cand(X1, "Dossiers", "none", 1)], preselected: null } as never;
    p.collisions = { contacts: [], dossiers: [{ databaseId: X1, name: "Dossiers" }], interactions: [] } as never;
    preview = p;
    mount();
    await ready();
    const create = within(screen.getByRole("group", { name: "Mode pour Dossiers" })).getByRole("button", { name: /^Créer pour Dossiers/ });
    expect(create.getAttribute("aria-disabled")).toBe("true");
    expect(create.getAttribute("aria-label")).toContain("Une base « Dossiers » existe déjà dans cet espace");
    expect(screen.getByText(/Une base « Dossiers » existe déjà dans l'espace « CRM »/)).toBeTruthy();
    const confirm = nextBtn();
    expect(confirm.getAttribute("aria-disabled")).toBe("true");
    fireEvent.focus(confirm);
    expect(await screen.findByText("Mode indisponible pour : Dossiers")).toBeTruthy();
  });

  it("base prise par un autre rôle : option désactivée avec raison", async () => {
    mount();
    await ready();
    const taken = screen.getByRole("radio", { name: /Contacts, espace CRM, score .* indisponible : déjà utilisée pour Contacts/ });
    expect(taken.getAttribute("aria-disabled")).toBe("true");
    fireEvent.focus(taken);
    expect(await screen.findByText("Déjà utilisée pour le rôle Contacts : une base ne sert qu'à un rôle")).toBeTruthy();
  });

  it("choisir une base et un mode met à jour l'état puis POST avec le corps V2", async () => {
    const { onOpenChange } = mount();
    await ready();
    fireEvent.click(screen.getByRole("radio", { name: /^Demandes, espace CRM/ }));
    await toRecap();
    fireEvent.click(screen.getByRole("button", { name: "Activer le module" }));
    await waitFor(() => expect(h.success).toHaveBeenCalled());
    const post = calls.find((c) => c.url === "/api/crm/activate");
    expect(post?.body).toEqual({
      space: { mode: "existing", spaceId: SP },
      roles: {
        contacts: { mode: "connect", databaseId: C1 },
        dossiers: { mode: "complete", databaseId: D1 },
        interactions: { mode: "create" },
      },
    });
    expect(h.push).toHaveBeenCalledWith("/crm/raccordement");
    expect(onOpenChange).toHaveBeenCalledWith(false);
  });

  it("adopter la base existante bascule le rôle en Raccorder", async () => {
    const p = mixed();
    p.roles.dossiers = { candidates: [cand(X1, "Dossiers", "compatible", 7)], preselected: X1 } as never;
    p.collisions = { contacts: [], dossiers: [{ databaseId: X1, name: "Dossiers" }], interactions: [] } as never;
    preview = p;
    mount();
    await ready();
    const dossiers = within(screen.getByTestId("activation-role-dossiers"));
    expect(dossiers.getByRole("button", { name: /^Raccorder pour Dossiers/ }).getAttribute("aria-pressed")).toBe("true");
    fireEvent.click(within(screen.getByRole("group", { name: "Mode pour Dossiers" })).getByRole("button", { name: /^Créer pour Dossiers/ }));
    expect(within(screen.getByRole("group", { name: "Mode pour Dossiers" })).getByRole("button", { name: /^Créer pour Dossiers/ }).getAttribute("aria-disabled")).toBe("true");
  });

  it("chaque bouton a un data-action du registre, une icône, un aria-label et une info-bulle au focus", async () => {
    const p = mixed();
    p.roles.dossiers = { candidates: [cand(X1, "Dossiers", "compatible", 7)], preselected: X1 } as never;
    p.collisions = { contacts: [], dossiers: [{ databaseId: X1, name: "Dossiers" }], interactions: [] } as never;
    preview = p;
    mount();
    await ready();
    // Créer redevient possible hors de l'espace suggéré ; revenir dans l'espace suggéré fait apparaître la collision.
    fireEvent.change(screen.getByLabelText("Espace des bases à créer"), { target: { value: "create" } });
    fireEvent.click(within(screen.getByRole("group", { name: "Mode pour Dossiers" })).getByRole("button", { name: /^Créer pour Dossiers/ }));
    fireEvent.change(screen.getByLabelText("Espace des bases à créer"), { target: { value: SP } });
    expect(await screen.findByRole("button", { name: "Raccorder la base existante" })).toBeTruthy();
    const ids = new Set(CRM_ACTIONS.map((a) => a.id));
    const buttons = within(screen.getByRole("dialog")).getAllByRole("button");
    expect(buttons.length).toBeGreaterThan(5);
    for (const b of buttons) {
      const name = b.getAttribute("aria-label") ?? b.outerHTML;
      const action = b.getAttribute("data-action");
      expect(action, name).toBeTruthy();
      expect(ids.has(action as string), `${name} : ${action} absent du registre`).toBe(true);
      expect(b.getAttribute("aria-label"), b.outerHTML).toBeTruthy();
      expect(b.querySelector("svg"), name).toBeTruthy();
      fireEvent.focus(b);
      await waitFor(() => expect(popups().length, `${name} : info-bulle absente au focus`).toBe(1));
      fireEvent.blur(b);
      await waitFor(() => expect(popups().length, name).toBe(0));
    }
    expect(buttons.some((b) => b.getAttribute("data-action") === "activation.adopt")).toBe(true);
    expect(buttons.some((b) => b.getAttribute("data-action") === "activation.next")).toBe(true);
  });

  it("Suivant sans base choisie : désactivé, la raison s'affiche au focus", async () => {
    h.forceMissing = true;
    mount();
    await ready();
    const confirm = nextBtn();
    expect(confirm.getAttribute("aria-disabled")).toBe("true");
    fireEvent.focus(confirm);
    expect(await screen.findByText("Choisissez une base pour : Dossiers")).toBeTruthy();
    fireEvent.click(confirm);
    expect(screen.queryByRole("button", { name: "Retour" })).toBeNull();
    expect(calls.some((c) => c.url === "/api/crm/activate")).toBe(false);
  });

  it("erreur d'analyse : bouton Réessayer relance l'analyse", async () => {
    preview = "fail";
    mount();
    expect((await screen.findByRole("alert")).textContent).toContain("L'analyse des bases de LorIAx a échoué");
    preview = mixed();
    fireEvent.click(screen.getByRole("button", { name: "Réessayer" }));
    await waitFor(() => expect(calls.filter((c) => c.url === "/api/crm/activate/preview").length).toBe(2));
    await ready();
  });

  it("étape 1 : Suivant actif une fois l'analyse prête, récapitulatif absent, pas de bouton Afficher le détail", async () => {
    mount();
    expect(nextBtn().getAttribute("aria-disabled")).toBe("true");
    await ready();
    expect(nextBtn().getAttribute("aria-disabled")).toBeNull();
    expect(screen.queryByLabelText("Récapitulatif Dossiers")).toBeNull();
    expect(screen.queryByRole("button", { name: "Afficher le détail" })).toBeNull();
    expect(document.querySelector('[aria-current="step"]')?.textContent).toContain("Analyse");
  });

  it("étape 2 : récapitulatif déplié, organisation et espace verrouillés avec leur raison, Retour revient", async () => {
    mount();
    await ready();
    await toRecap();
    expect(document.querySelector('[aria-current="step"]')?.textContent).toContain("Récapitulatif");
    const recap = screen.getByLabelText("Récapitulatif Dossiers");
    expect(within(recap).getByText("Aucune colonne existante n'est modifiée.")).toBeTruthy();
    expect(within(recap).getByText(/: à côté de « Montant » \(Texte, conservée\)/)).toBeTruthy();
    expect(screen.queryByText(/\{(role|name|field)\}/)).toBeNull();
    const org = screen.getByLabelText("Organisation") as HTMLSelectElement;
    const space = screen.getByLabelText("Espace des bases à créer") as HTMLSelectElement;
    expect(org.disabled).toBe(true);
    expect(space.disabled).toBe(true);
    fireEvent.focus(org.parentElement as HTMLElement);
    expect((await screen.findAllByText("Revenir à l'analyse pour changer d'organisation")).length).toBeGreaterThan(0);
    fireEvent.blur(org.parentElement as HTMLElement);
    fireEvent.focus(space.parentElement as HTMLElement);
    expect((await screen.findAllByText("Modifiable à l'étape Analyse")).length).toBeGreaterThan(0);
    fireEvent.click(screen.getByRole("button", { name: "Retour" }));
    await ready();
    expect(screen.queryByLabelText("Récapitulatif Dossiers")).toBeNull();
  });

  it("choix de la base : radiogroup, roving tabindex, flèches qui déplacent et sélectionnent, Home et End", async () => {
    const p = mixed();
    p.roles.dossiers = {
      candidates: [
        { ...cand(D1, "Demandes", "almost", 3), missing: [] },
        { ...cand(X1, "Dossiers", "almost", 3), missing: [] },
        { ...cand(C1, "Contacts", "almost", 3), missing: [] },
      ],
      preselected: null,
    } as never;
    preview = p;
    mount();
    await ready();
    const group = screen.getByRole("radiogroup", { name: "Base à compléter pour Dossiers" });
    const radios = () => within(group).getAllByRole("radio");
    expect(radios().length).toBe(3);
    // Option cochée par défaut : D1 (première libre) ; C1 est prise par Contacts.
    expect(radios()[0].getAttribute("aria-checked")).toBe("true");
    expect(radios().map((r) => r.tabIndex)).toEqual([0, -1, -1]);
    expect(radios()[2].getAttribute("aria-disabled")).toBe("true");
    radios()[0].focus();
    fireEvent.keyDown(radios()[0], { key: "ArrowDown" });
    expect(radios()[1].getAttribute("aria-checked")).toBe("true");
    expect(radios()[0].getAttribute("aria-checked")).toBe("false");
    expect(document.activeElement).toBe(radios()[1]);
    expect(radios().map((r) => r.tabIndex)).toEqual([-1, 0, -1]);
    // Saute l'option indisponible et boucle.
    fireEvent.keyDown(radios()[1], { key: "ArrowRight" });
    expect(radios()[0].getAttribute("aria-checked")).toBe("true");
    fireEvent.keyDown(radios()[0], { key: "ArrowUp" });
    expect(radios()[1].getAttribute("aria-checked")).toBe("true");
    fireEvent.keyDown(radios()[1], { key: "Home" });
    expect(radios()[0].getAttribute("aria-checked")).toBe("true");
    fireEvent.keyDown(radios()[0], { key: "End" });
    expect(radios()[1].getAttribute("aria-checked")).toBe("true");
    expect(radios()[2].getAttribute("aria-checked")).toBe("false");
  });

  it("échec 404 : message d'erreur, pas de fermeture", async () => {
    activateStatus = 404;
    const { onOpenChange } = mount();
    await ready();
    await toRecap();
    fireEvent.click(screen.getByRole("button", { name: "Activer le module" }));
    expect((await screen.findByRole("alert")).textContent).toContain("Introuvable");
    expect(onOpenChange).not.toHaveBeenCalledWith(false);
    expect(h.push).not.toHaveBeenCalled();
  });

  it("jamais de confirm natif", () => {
    for (const f of ["activation-dialog", "activation-role-tile", "activation-recap"]) {
      const src = readFileSync(join(process.cwd(), `src/components/crm/${f}.tsx`), "utf8");
      expect(src).not.toMatch(/\bwindow\.(confirm|alert|prompt)\s*\(|(?<![\w.])(alert|prompt)\s*\(/);
    }
  });
});
