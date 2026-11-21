// @vitest-environment jsdom
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { cleanup, fireEvent, render, screen, waitFor, within } from "@testing-library/react";
import { OrganizationProvider } from "@/lib/org/organization-context";
import { ActivationDialog } from "./activation-dialog";

const h = vi.hoisted(() => ({ success: vi.fn(), error: vi.fn(), push: vi.fn(), custom: vi.fn(), dismiss: vi.fn() }));

vi.mock("next-intl", async () => (await import("@/components/media/test-fixtures")).intlMock());
vi.mock("sonner", () => ({ toast: Object.assign(vi.fn(), { success: h.success, error: h.error, custom: h.custom, dismiss: h.dismiss }) }));
vi.mock("@/i18n/routing", () => ({ useRouter: () => ({ push: h.push, refresh: vi.fn() }) }));

const SP = "55555555-5555-4555-8555-555555555555";
const C1 = "11111111-1111-4111-8111-111111111111";
const X1 = "44444444-4444-4444-8444-444444444444";
const SP2 = "66666666-6666-4666-8666-666666666666";

const cand = (databaseId: string, name: string, status: "compatible" | "almost") => ({
  databaseId,
  name,
  spaceId: SP,
  spaceName: "CRM",
  columns: [],
  proposal: {},
  score: 4,
  compatible: status === "compatible",
  status,
  missing: [],
});
const none = { candidates: [] as unknown[], preselected: null };

function previewOf(collisionDossiers = false) {
  return {
    roles: {
      contacts: { candidates: [cand(C1, "Contacts", "compatible")], preselected: C1 },
      dossiers: collisionDossiers ? { candidates: [cand(X1, "Dossiers", "compatible")], preselected: X1 } : none,
      interactions: none,
    },
    existing: false,
    spaces: [{ id: SP, name: "CRM" }],
    suggestedSpaceId: SP,
    collisions: { contacts: [], dossiers: collisionDossiers ? [{ databaseId: X1, name: "Dossiers" }] : [], interactions: [] },
    orgs: [{ slug: "lor", name: "LorIAx" }],
  };
}

/** Deux espaces ; la base « Dossiers » existe dans le second, hors de l'espace suggéré (aucune collision dans l'aperçu). */
function previewTwoSpaces(dossiersInSecond: boolean) {
  const p = previewOf();
  p.spaces = [
    { id: SP, name: "CRM" },
    { id: SP2, name: "Ventes" },
  ];
  if (dossiersInSecond) {
    p.roles.dossiers = { candidates: [{ ...cand(X1, "Dossiers", "compatible"), spaceId: SP2, spaceName: "Ventes" }], preselected: X1 };
  }
  return p;
}

let preview: object;
let activate: { status: number; body: unknown; gate?: Promise<void> };
const calls: { url: string; method: string; body?: unknown }[] = [];

beforeEach(() => {
  calls.length = 0;
  h.success.mockReset();
  h.error.mockReset();
  h.custom.mockReset();
  h.dismiss.mockReset();
  h.push.mockReset();
  preview = previewOf();
  activate = { status: 200, body: { enabled: true, reactivated: false, created: [], completed: [], unlinkedRelations: [] } };
  vi.stubGlobal(
    "fetch",
    vi.fn(async (url: string, init?: RequestInit) => {
      calls.push({ url, method: init?.method ?? "GET", body: init?.body ? JSON.parse(String(init.body)) : undefined });
      if (url === "/api/crm/activate/preview") return { ok: true, status: 200, json: async () => preview };
      if (url === "/api/crm/activate") {
        await activate.gate;
        return { ok: activate.status === 200, status: activate.status, json: async () => activate.body };
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

async function open() {
  const onDone = vi.fn();
  const onOpenChange = vi.fn();
  render(
    <OrganizationProvider value={orgValue}>
      <ActivationDialog open onOpenChange={onOpenChange} onDone={onDone} />
    </OrganizationProvider>,
  );
  await screen.findByRole("button", { name: "Activer le module" });
  return { onDone, onOpenChange };
}
const confirmBtn = () => screen.getByRole("button", { name: "Activer le module" });
const dossiersMode = (name: RegExp) =>
  within(screen.getByRole("group", { name: "Mode pour Dossiers" })).getByRole("button", { name });
const toastOf = () => render(<>{(h.custom.mock.calls[0][0] as (id: string) => React.ReactNode)("t1")}</>);
const posts = () => calls.filter((c) => c.url === "/api/crm/activate");

describe("soumission de la modale d'activation", () => {
  it("succès : toast avec Annuler, appel POST activate avec le corps attendu", async () => {
    const { onOpenChange } = await open();
    fireEvent.click(confirmBtn());
    await waitFor(() => expect(h.custom).toHaveBeenCalledTimes(1));
    expect(posts()[0].body).toEqual({
      space: { mode: "existing", spaceId: SP },
      roles: { contacts: { mode: "connect", databaseId: C1 }, dossiers: { mode: "create" }, interactions: { mode: "create" } },
    });
    const { container } = toastOf();
    // sonner porte déjà la région live : le contenu n'en déclare pas une seconde.
    expect(container.querySelector("[aria-live], [role=status]")).toBeNull();
    expect(h.custom.mock.calls[0][1]).toMatchObject({ duration: 10000 });
    expect(document.body.textContent).toContain("CRM activé pour LorIAx, les bases sont créées ou complétées");
    const undo = screen.getByRole("button", { name: /^Annuler : CRM activé/ });
    expect(undo.getAttribute("data-action")).toBe("activation.undo");
    expect(onOpenChange).toHaveBeenCalledWith(false);
  });

  it("l'info-bulle de Annuler s'affiche au focus clavier", async () => {
    await open();
    fireEvent.click(confirmBtn());
    await waitFor(() => expect(h.custom).toHaveBeenCalledTimes(1));
    toastOf();
    screen.getByRole("button", { name: /^Annuler : CRM activé/ }).focus();
    expect(await screen.findByText("Annuler cette action")).toBeTruthy();
  });

  it("Annuler appelle deactivate et conserve les bases (aucun appel de suppression)", async () => {
    const { onDone } = await open();
    fireEvent.click(confirmBtn());
    await waitFor(() => expect(h.custom).toHaveBeenCalledTimes(1));
    toastOf();
    fireEvent.click(screen.getByRole("button", { name: /^Annuler : CRM activé/ }));
    await waitFor(() => expect(h.success).toHaveBeenCalledWith("Module CRM désactivé, les bases sont conservées"));
    expect(calls.some((c) => c.url === "/api/crm/deactivate" && c.method === "POST")).toBe(true);
    expect(calls.some((c) => c.method === "DELETE")).toBe(false);
    expect(h.dismiss).toHaveBeenCalledWith("t1");
    expect(onDone).toHaveBeenCalled();
  });

  it("double clic sur Annuler : un seul deactivate", async () => {
    await open();
    fireEvent.click(confirmBtn());
    await waitFor(() => expect(h.custom).toHaveBeenCalledTimes(1));
    toastOf();
    const undo = screen.getByRole("button", { name: /^Annuler : CRM activé/ });
    fireEvent.click(undo);
    fireEvent.click(undo);
    await waitFor(() => expect(h.success).toHaveBeenCalledWith("Module CRM désactivé, les bases sont conservées"));
    expect(calls.filter((c) => c.url === "/api/crm/deactivate")).toHaveLength(1);
  });

  it("409 : la base du même nom est connue dans l'espace cible, le rôle bascule en Raccorder", async () => {
    preview = previewTwoSpaces(true);
    activate = { status: 409, body: { error: "x", code: "name_collision", role: "dossiers" } };
    const { onOpenChange } = await open();
    expect(dossiersMode(/^Raccorder pour Dossiers/).getAttribute("aria-pressed")).toBe("true");
    fireEvent.click(dossiersMode(/^Créer pour Dossiers/));
    fireEvent.change(screen.getByLabelText("Espace des bases à créer"), { target: { value: SP2 } });
    expect(dossiersMode(/^Créer pour Dossiers/).getAttribute("aria-pressed")).toBe("true");
    fireEvent.click(confirmBtn());
    await waitFor(() => expect(posts()).toHaveLength(1));
    expect(posts()[0].body).toMatchObject({ roles: { dossiers: { mode: "create" } } });
    expect(onOpenChange).not.toHaveBeenCalledWith(false);
    const dossiers = within(screen.getByTestId("activation-role-dossiers"));
    expect(await dossiers.findByText(/Nom déjà pris pour le rôle Dossiers/)).toBeTruthy();
    expect(h.error).not.toHaveBeenCalled();
    expect(dossiersMode(/^Raccorder pour Dossiers/).getAttribute("aria-pressed")).toBe("true");
    expect(dossiersMode(/^Créer pour Dossiers/).getAttribute("aria-pressed")).toBe("false");
  });

  it("409 sans base connue : Créer indisponible, message d'invitation à changer d'espace, Confirmer bloqué", async () => {
    activate = { status: 409, body: { error: "x", code: "name_collision", role: "interactions" } };
    const { onOpenChange } = await open();
    fireEvent.click(confirmBtn());
    const tile = within(screen.getByTestId("activation-role-interactions"));
    expect(await tile.findByText(/Changez d'espace pour créer ce rôle/)).toBeTruthy();
    expect(onOpenChange).not.toHaveBeenCalledWith(false);
    expect(tile.queryByText(/Nom déjà pris/)).toBeNull();
    expect(within(screen.getByRole("group", { name: "Mode pour Interactions" })).getByRole("button", { name: /^Créer pour Interactions/ }).getAttribute("aria-disabled")).toBe("true");
    expect(confirmBtn().getAttribute("aria-disabled")).toBe("true");
  });

  it("409 sans base connue puis changement d'espace : Créer de nouveau disponible", async () => {
    preview = previewTwoSpaces(false);
    activate = { status: 409, body: { error: "x", code: "name_collision", role: "interactions" } };
    await open();
    fireEvent.click(confirmBtn());
    await waitFor(() => expect(posts()).toHaveLength(1));
    const createInteractions = () =>
      within(screen.getByRole("group", { name: "Mode pour Interactions" })).getByRole("button", { name: /^Créer pour Interactions/ });
    expect(createInteractions().getAttribute("aria-disabled")).toBe("true");
    fireEvent.change(screen.getByLabelText("Espace des bases à créer"), { target: { value: SP2 } });
    await waitFor(() => expect(createInteractions().getAttribute("aria-disabled")).toBeNull());
    expect(within(screen.getByTestId("activation-role-interactions")).queryByText(/Changez d'espace/)).toBeNull();
    expect(confirmBtn().getAttribute("aria-disabled")).toBeNull();
  });

  it("404 et 403 : messages distincts, jamais le nom d'une ressource, boutons réactivés", async () => {
    await open();
    activate = { status: 404, body: { error: "Introuvable : Base secrète" } };
    fireEvent.click(confirmBtn());
    expect((await screen.findByRole("alert")).textContent).toBe("Introuvable");
    expect(screen.queryByText(/secrète/)).toBeNull();
    expect(confirmBtn().getAttribute("aria-disabled")).toBeNull();
    activate = { status: 403, body: { error: "Interdit : Base secrète", code: "forbidden" } };
    fireEvent.click(confirmBtn());
    await waitFor(() => expect(screen.getByRole("alert").textContent).toBe("Accès refusé"));
    expect(h.error).not.toHaveBeenCalled();
  });

  it("quota d'espaces et erreur générique : message unique dans la modale, sans toast d'erreur", async () => {
    await open();
    activate = { status: 400, body: { error: "x", code: "space_quota" } };
    fireEvent.click(confirmBtn());
    await waitFor(() => expect(screen.getByRole("alert").textContent).toContain("Quota d'espaces atteint"));
    activate = { status: 500, body: {} };
    fireEvent.click(confirmBtn());
    await waitFor(() => expect(screen.getByRole("alert").textContent).toContain("Une erreur est survenue"));
    expect(h.error).not.toHaveBeenCalled();
    expect(confirmBtn().getAttribute("aria-disabled")).toBeNull();
  });

  it("409 sans rôle : message générique sans rôle vide, boutons réactivés", async () => {
    activate = { status: 409, body: { error: "x", code: "name_collision" } };
    await open();
    fireEvent.click(confirmBtn());
    const alert = await screen.findByRole("alert");
    expect(alert.textContent).toBe("Une erreur est survenue. Aucune modification n'a été enregistrée.");
    expect(document.body.textContent).not.toMatch(/rôle\s*:/);
    expect(confirmBtn().getAttribute("aria-disabled")).toBeNull();
  });

  it("500 (collision d'inverse ou code inconnu) : message générique, boutons réactivés", async () => {
    activate = { status: 500, body: { error: "x", code: "inverse_collision" } };
    await open();
    fireEvent.click(confirmBtn());
    expect((await screen.findByRole("alert")).textContent).toContain("Une erreur est survenue");
    expect(confirmBtn().getAttribute("aria-disabled")).toBeNull();
    expect(screen.getByRole("button", { name: "Fermer la fenêtre d'activation" }).getAttribute("aria-disabled")).toBeNull();
  });

  it("double clic sur Confirmer : un seul POST", async () => {
    let release!: () => void;
    activate.gate = new Promise<void>((r) => (release = r));
    await open();
    fireEvent.click(confirmBtn());
    fireEvent.click(confirmBtn());
    release();
    await waitFor(() => expect(h.custom).toHaveBeenCalledTimes(1));
    expect(posts()).toHaveLength(1);
  });

  it("progression annoncée en aria-live pendant l'appel", async () => {
    let release!: () => void;
    activate.gate = new Promise<void>((r) => (release = r));
    await open();
    fireEvent.click(confirmBtn());
    const status = await screen.findByRole("status", { name: "Progression de la création" });
    expect(status.getAttribute("aria-live")).toBe("polite");
    expect(status.textContent).toContain("Création en cours");
    expect(status.textContent).toContain("Raccordement des trois rôles");
    release();
    await waitFor(() => expect(h.custom).toHaveBeenCalled());
  });
});
