// @vitest-environment jsdom
/**
 * T10 : galerie à la création, section Modèles, aperçu et boîtes.
 * Preuve par mutation (vérifiée) : remplacer `isAdmin` par `true` devant le bouton
 * Modifier de `template-preview-dialog.tsx` fait échouer le parcours membre ; retirer
 * `disabledReason` du bouton Utiliser fait échouer le test du modèle masqué.
 */
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { cleanup, fireEvent, render, screen, waitFor, within } from "@testing-library/react";
import { SWRConfig } from "swr";
import { toast } from "sonner";
import { renderWithIntl } from "./support/render-intl";
import { PresentationsListClient } from "@/app/[locale]/(app)/presentations/presentations-list-client";

const push = vi.fn();
vi.mock("@/i18n/routing", () => ({
  useRouter: () => ({ push }),
  Link: ({ href, children }: { href: string; children: React.ReactNode }) => (
    <a href={href}>{children}</a>
  ),
}));
vi.mock("sonner", () => {
  const fn = Object.assign(vi.fn(), { info: vi.fn(), success: vi.fn(), error: vi.fn() });
  return { toast: fn };
});

const SPACE = "11111111-1111-4111-8111-111111111111";

const tpl = (over: Record<string, unknown>) => ({
  id: "t-x",
  title: "Modèle",
  templateDescription: null,
  templateOrigin: null,
  templateSeedKey: null,
  templateHiddenAt: null,
  version: 3,
  slideCount: 7,
  updatedAt: "2026-11-01T00:00:00Z",
  ...over,
});
const PITCH = tpl({
  id: "t-pitch",
  title: "Pitch (titre en base)",
  templateOrigin: "lorIAx",
  templateSeedKey: "pitch",
  templateDescription: "desc pitch",
});
const ORG = tpl({ id: "t-org", title: "Proposition grand compte", templateDescription: "desc org" });
const HIDDEN = tpl({
  id: "t-hid",
  title: "Ancien modèle",
  templateOrigin: "lorIAx",
  templateSeedKey: "training",
  templateHiddenAt: "2026-11-01T00:00:00Z",
});
const ROWS = [
  { id: "p1", title: "Bilan T3", slideCount: 4, updatedAt: "2026-11-10T10:00:00Z" },
  { id: "p2", title: "Roadmap", slideCount: 1, updatedAt: "2026-11-11T10:00:00Z" },
];
const DECK = {
  slides: [
    { id: "s1", elements: [] },
    { id: "s2", elements: [] },
    { id: "s3", elements: [] },
  ],
};

type Handler = (url: string, init?: RequestInit) => Response | Promise<Response> | undefined;
const json = (body: unknown, status = 200) =>
  new Response(JSON.stringify(body), { status, headers: { "Content-Type": "application/json" } });

let templates: unknown[] = [];
let templatesResponse: () => Response | Promise<Response>;
let extra: Handler | undefined;
const calls: { url: string; method: string; body?: unknown }[] = [];

beforeEach(() => {
  vi.clearAllMocks();
  calls.length = 0;
  extra = undefined;
  templates = [PITCH, ORG];
  templatesResponse = () => json({ templates });
  vi.stubGlobal(
    "fetch",
    vi.fn(async (input: RequestInfo | URL, init?: RequestInit) => {
      const url = String(input);
      const method = init?.method ?? "GET";
      calls.push({ url, method, body: init?.body ? JSON.parse(String(init.body)) : undefined });
      const custom = extra?.(url, init);
      if (custom) return custom;
      if (method === "GET" && url.startsWith("/api/presentations?spaceId=")) return json(ROWS);
      if (method === "GET" && url === "/api/presentations/templates") return templatesResponse();
      if (method === "GET" && /^\/api\/presentations\/templates\/t-/.test(url))
        return json({ template: {}, deck: DECK });
      if (method === "POST" && url === "/api/presentations") return json({ id: "new-1" }, 201);
      if (method === "DELETE" && url.includes("/templates/")) return json({ template: { id: "t-org" } });
      if (method === "DELETE") return json({ ok: true });
      if (method === "PATCH") return json({ template: { id: "t-org" } });
      if (method === "POST" && url.endsWith("/reset")) return json({ template: { id: "t-pitch" } });
      if (method === "POST" && url.endsWith("/template")) return json({ template: { id: "t-new" } });
      return json({ error: "inattendu" }, 500);
    })
  );
});
afterEach(() => {
  cleanup();
  vi.unstubAllGlobals();
});

function mount(isAdmin: boolean) {
  return renderWithIntl(
    <SWRConfig value={{ provider: () => new Map(), dedupingInterval: 0 }}>
      <PresentationsListClient spaceId={SPACE} isAdmin={isAdmin} />
    </SWRConfig>
  );
}

const ADMIN_LABELS = [
  /^Retirer des modèles$/,
  /^Réinitialiser$/,
  /^Modifier le modèle$/,
  /^Enregistrer comme modèle$/,
  /^Masquer$/,
];

async function openPreview(name: string) {
  fireEvent.click(await screen.findByRole("button", { name: `Aperçu du modèle ${name}` }));
  return screen.findByRole("dialog");
}

describe("parcours membre", () => {
  it("voit les modèles (nom traduit pour LorIAx) et aucun bouton admin", async () => {
    mount(false);
    expect(await screen.findByRole("button", { name: "Aperçu du modèle Présentation commerciale" })).toBeTruthy();
    expect(screen.getByRole("button", { name: "Aperçu du modèle Proposition grand compte" })).toBeTruthy();
    for (const label of ADMIN_LABELS) expect(screen.queryByRole("button", { name: label })).toBeNull();

    const dialog = await openPreview("Présentation commerciale");
    await within(dialog).findByRole("button", { name: "Utiliser ce modèle" });
    for (const label of ADMIN_LABELS) expect(within(dialog).queryByRole("button", { name: label })).toBeNull();
  });

  it("ne rend jamais un modèle masqué à un membre, même renvoyé par l'API", async () => {
    templates = [PITCH, HIDDEN];
    mount(false);
    await screen.findByRole("button", { name: /Aperçu du modèle Présentation commerciale/ });
    expect(screen.queryByText("Masqué")).toBeNull();
    expect(screen.queryByRole("button", { name: /Formation/ })).toBeNull();
  });

  it("vide membre : message sans action", async () => {
    templates = [PITCH];
    mount(false);
    fireEvent.click(await screen.findByRole("button", { name: "Organisation (0)" }));
    expect(await screen.findByText(/n'ont pas encore enregistré de modèle/)).toBeTruthy();
    expect(screen.queryByRole("button", { name: "Enregistrer une présentation comme modèle" })).toBeNull();
  });
});

describe("parcours admin", () => {
  it("l'aperçu d'un modèle LorIAx propose utiliser, modifier, retirer, réinitialiser", async () => {
    mount(true);
    const dialog = await openPreview("Présentation commerciale");
    for (const name of ["Utiliser ce modèle", "Modifier le modèle", "Retirer des modèles", "Réinitialiser"]) {
      const b = await within(dialog).findByRole("button", { name });
      expect((b as HTMLButtonElement).disabled).toBe(false);
    }
    // Bande de diapositives
    expect(await within(dialog).findByRole("button", { name: "Diapositive 3" })).toBeTruthy();
  });

  it("Réinitialiser est désactivé avec sa raison pour un modèle d'organisation", async () => {
    mount(true);
    const dialog = await openPreview("Proposition grand compte");
    const b = (await within(dialog).findByRole("button", { name: "Réinitialiser" })) as HTMLButtonElement;
    expect(b.disabled).toBe(true);
    fireEvent.mouseEnter(b.parentElement as HTMLElement);
    const tips = await screen.findAllByRole("tooltip");
    expect(tips.map((x) => x.textContent)).toContain(
      "Seuls les modèles livrés par LorIAx peuvent être réinitialisés"
    );
  });

  it("montre un modèle masqué avec son badge", async () => {
    templates = [PITCH, HIDDEN];
    mount(true);
    expect(await screen.findByText("Masqué")).toBeTruthy();
  });

  it("Modifier le modèle ouvre l'éditeur du modèle et émet un toast", async () => {
    mount(true);
    const dialog = await openPreview("Proposition grand compte");
    fireEvent.click(await within(dialog).findByRole("button", { name: "Modifier le modèle" }));
    expect(push).toHaveBeenCalledWith("/presentations/t-org");
    expect(toast.success).toHaveBeenCalledWith("Modèle ouvert en édition");
  });
});

describe("états de la section", () => {
  it("chargement : tuiles squelettes, section occupée", async () => {
    templatesResponse = () => new Promise<Response>(() => {});
    mount(true);
    const busy = await screen.findByLabelText("Modèles", { selector: "[aria-busy='true']" });
    expect(busy.querySelectorAll("[data-template-tile]").length).toBeGreaterThanOrEqual(4);
  });

  it("erreur : alerte avec réessayer, qui recharge", async () => {
    templatesResponse = () => json({ error: "x" }, 503);
    mount(true);
    const alert = await screen.findByRole("alert");
    expect(alert.textContent).toContain("Les modèles n'ont pas pu être chargés.");
    templatesResponse = () => json({ templates });
    fireEvent.click(within(alert).getByRole("button", { name: "Réessayer" }));
    expect(await screen.findByRole("button", { name: /Aperçu du modèle Présentation commerciale/ })).toBeTruthy();
  });

  it("vide admin : action pour enregistrer une présentation comme modèle", async () => {
    templates = [PITCH];
    mount(true);
    fireEvent.click(await screen.findByRole("button", { name: "Organisation (0)" }));
    expect(await screen.findByText("Aucun modèle d'organisation")).toBeTruthy();
    expect(screen.getByRole("button", { name: "Enregistrer une présentation comme modèle" })).toBeTruthy();
  });
});

describe("galerie et utilisation", () => {
  it("toutes les tuiles ont le même gabarit (vierge, modèles, squelettes)", async () => {
    mount(true);
    await screen.findByRole("button", { name: /Aperçu du modèle Présentation commerciale/ });
    fireEvent.click(screen.getByRole("button", { name: "Nouvelle présentation" }));
    const dialog = await screen.findByRole("dialog");
    const tiles = dialog.querySelectorAll("[data-template-tile]");
    expect(tiles.length).toBe(3); // vierge + 2 modèles
    const sizes = new Set([...tiles].map((t) => (t.className.match(/\b(?:h|w)-\S+/g) ?? []).join(" ")));
    expect(sizes.size).toBe(1);
    expect([...tiles][0].className).toContain("h-56");
  });

  it("la galerie ne propose pas les modèles masqués", async () => {
    templates = [PITCH, HIDDEN];
    mount(true);
    await screen.findByRole("button", { name: /Aperçu du modèle Présentation commerciale/ });
    fireEvent.click(screen.getByRole("button", { name: "Nouvelle présentation" }));
    const dialog = await screen.findByRole("dialog");
    expect(within(dialog).queryByRole("button", { name: /Formation/ })).toBeNull();
  });

  it("clic sur un modèle : POST templateId + spaceId, toast, navigation", async () => {
    mount(false);
    await screen.findByRole("button", { name: /Aperçu du modèle Présentation commerciale/ });
    fireEvent.click(screen.getByRole("button", { name: "Nouvelle présentation" }));
    const dialog = await screen.findByRole("dialog");
    fireEvent.click(within(dialog).getByRole("button", { name: "Créer une présentation à partir de Présentation commerciale" }));
    await waitFor(() => expect(push).toHaveBeenCalledWith("/presentations/new-1"));
    const post = calls.find((c) => c.method === "POST" && c.url === "/api/presentations");
    expect(post?.body).toEqual({ templateId: "t-pitch", spaceId: SPACE });
    expect(toast.success).toHaveBeenCalledWith(
      "Nouvelle présentation créée depuis « Présentation commerciale ». Le modèle reste inchangé."
    );
  });

  it("tuile Vierge : POST du spaceId seul", async () => {
    mount(false);
    await screen.findByRole("button", { name: /Aperçu du modèle Présentation commerciale/ });
    fireEvent.click(screen.getByRole("button", { name: "Nouvelle présentation" }));
    const dialog = await screen.findByRole("dialog");
    fireEvent.click(within(dialog).getByRole("button", { name: "Créer une présentation vierge" }));
    await waitFor(() => expect(push).toHaveBeenCalledWith("/presentations/new-1"));
    expect(calls.find((c) => c.method === "POST")?.body).toEqual({ spaceId: SPACE });
  });

  it("Échap ferme la galerie", async () => {
    mount(false);
    await screen.findByRole("button", { name: /Aperçu du modèle Présentation commerciale/ });
    fireEvent.click(screen.getByRole("button", { name: "Nouvelle présentation" }));
    const dialog = await screen.findByRole("dialog");
    fireEvent.keyDown(dialog, { key: "Escape" });
    await waitFor(() => expect(screen.queryByRole("dialog")).toBeNull());
  });
});

describe("erreurs traduites par statut", () => {
  const cases: [number | "net", string][] = [
    [403, "Seuls les administrateurs de l'organisation peuvent faire cela."],
    [404, "Ce modèle n'existe plus ou a été retiré."],
    [409, "Le modèle a été modifié ailleurs. Rechargez la liste puis réessayez."],
    [422, "Les informations envoyées ne sont pas valides."],
    ["net", "Le serveur est injoignable. Vérifiez votre connexion."],
  ];
  it.each(cases)("utilisation en échec (%s)", async (status, description) => {
    extra = (url, init) => {
      if (init?.method === "POST" && url === "/api/presentations") {
        if (status === "net") throw new TypeError("fetch failed");
        return json({ error: "refus" }, status);
      }
    };
    mount(false);
    const dialog = await openPreview("Présentation commerciale");
    fireEvent.click(await within(dialog).findByRole("button", { name: "Utiliser ce modèle" }));
    await waitFor(() =>
      expect(toast.error).toHaveBeenCalledWith("La création de la présentation a échoué.", { description })
    );
    expect(push).not.toHaveBeenCalled();
  });
});

describe("retirer", () => {
  it("modale de confirmation, DELETE, toast avec Annuler qui rétablit", async () => {
    mount(true);
    const dialog = await openPreview("Proposition grand compte");
    fireEvent.click(await within(dialog).findByRole("button", { name: "Retirer des modèles" }));
    const confirm = await screen.findByRole("dialog", { name: "Retirer ce modèle ?" });
    expect(confirm.textContent).toContain("Proposition grand compte");
    expect(calls.some((c) => c.method === "DELETE")).toBe(false);
    fireEvent.click(within(confirm).getByRole("button", { name: "Retirer" }));
    await waitFor(() => expect(calls.some((c) => c.method === "DELETE" && c.url.endsWith("/t-org"))).toBe(true));
    await waitFor(() => expect(toast.success).toHaveBeenCalled());
    const [msg, opts] = (toast.success as unknown as ReturnType<typeof vi.fn>).mock.calls[0];
    expect(msg).toBe("Modèle « Proposition grand compte » retiré de la liste");
    render(opts.action);
    fireEvent.click(screen.getByRole("button", { name: "Annuler" }));
    await waitFor(() =>
      expect(calls.some((c) => c.method === "PATCH" && (c.body as { hidden: boolean }).hidden === false)).toBe(true)
    );
  });

  it("Annuler dans la modale ne retire rien", async () => {
    mount(true);
    const dialog = await openPreview("Proposition grand compte");
    fireEvent.click(await within(dialog).findByRole("button", { name: "Retirer des modèles" }));
    const confirm = await screen.findByRole("dialog", { name: "Retirer ce modèle ?" });
    fireEvent.click(within(confirm).getByRole("button", { name: "Annuler" }));
    await waitFor(() => expect(screen.queryByRole("dialog")).toBeNull());
    expect(calls.some((c) => c.method === "DELETE")).toBe(false);
    expect(toast.success).not.toHaveBeenCalled();
  });
});

describe("réinitialiser", () => {
  it("modale d'avertissement, puis POST reset avec la version, puis toast", async () => {
    mount(true);
    const dialog = await openPreview("Présentation commerciale");
    fireEvent.click(await within(dialog).findByRole("button", { name: "Réinitialiser" }));
    const confirm = await screen.findByRole("dialog", { name: "Réinitialiser le modèle ?" });
    expect(confirm.textContent).toContain("seront écrasées par la version livrée par LorIAx");
    expect(calls.some((c) => c.url.endsWith("/reset"))).toBe(false);
    expect(toast.success).not.toHaveBeenCalled();
    fireEvent.click(within(confirm).getByRole("button", { name: "Réinitialiser" }));
    await waitFor(() => expect(toast.success).toHaveBeenCalledWith("Modèle « Présentation commerciale » réinitialisé"));
    const reset = calls.find((c) => c.url === "/api/presentations/templates/t-pitch/reset");
    expect(reset?.method).toBe("POST");
    expect(reset?.body).toEqual({ expectedVersion: 3 });
  });

  it("Échap ferme la modale sans réinitialiser", async () => {
    mount(true);
    const dialog = await openPreview("Présentation commerciale");
    fireEvent.click(await within(dialog).findByRole("button", { name: "Réinitialiser" }));
    const confirm = await screen.findByRole("dialog", { name: "Réinitialiser le modèle ?" });
    fireEvent.keyDown(confirm, { key: "Escape" });
    await waitFor(() => expect(screen.queryByRole("dialog")).toBeNull());
    expect(calls.some((c) => c.url.endsWith("/reset"))).toBe(false);
  });

  it("409 : toast d'erreur traduit", async () => {
    extra = (url) => (url.endsWith("/reset") ? json({ error: "conflit", currentVersion: 4 }, 409) : undefined);
    mount(true);
    const dialog = await openPreview("Présentation commerciale");
    fireEvent.click(await within(dialog).findByRole("button", { name: "Réinitialiser" }));
    const confirm = await screen.findByRole("dialog", { name: "Réinitialiser le modèle ?" });
    fireEvent.click(within(confirm).getByRole("button", { name: "Réinitialiser" }));
    await waitFor(() =>
      expect(toast.error).toHaveBeenCalledWith("La réinitialisation du modèle a échoué.", {
        description: "Le modèle a été modifié ailleurs. Rechargez la liste puis réessayez.",
      })
    );
  });
});

describe("enregistrer comme modèle", () => {
  it("vide admin : choisir une présentation, nommer, enregistrer, toast", async () => {
    templates = [PITCH];
    mount(true);
    fireEvent.click(await screen.findByRole("button", { name: "Organisation (0)" }));
    fireEvent.click(await screen.findByRole("button", { name: "Enregistrer une présentation comme modèle" }));
    const pick = await screen.findByRole("dialog", { name: "Choisir une présentation" });
    fireEvent.click(await within(pick).findByRole("button", { name: "Enregistrer Bilan T3 comme modèle" }));
    const save = await screen.findByRole("dialog", { name: "Enregistrer comme modèle" });
    const name = within(save).getByLabelText("Nom du modèle") as HTMLInputElement;
    expect(name.value).toBe("Bilan T3");
    fireEvent.change(name, { target: { value: "Bilan type" } });
    fireEvent.change(within(save).getByLabelText("Description"), { target: { value: "Pour les bilans" } });
    fireEvent.click(within(save).getByRole("button", { name: "Enregistrer" }));
    await waitFor(() => expect(toast.success).toHaveBeenCalledWith("Modèle « Bilan type » enregistré pour l'organisation"));
    const post = calls.find((c) => c.url === "/api/presentations/p1/template");
    expect(post?.body).toEqual({ name: "Bilan type", description: "Pour les bilans" });
  });

  it("le bouton Enregistrer est désactivé sans nom, avec sa raison", async () => {
    templates = [PITCH];
    mount(true);
    fireEvent.click(await screen.findByRole("button", { name: "Organisation (0)" }));
    fireEvent.click(await screen.findByRole("button", { name: "Enregistrer une présentation comme modèle" }));
    const pick = await screen.findByRole("dialog", { name: "Choisir une présentation" });
    fireEvent.click(await within(pick).findByRole("button", { name: "Enregistrer Bilan T3 comme modèle" }));
    const save = await screen.findByRole("dialog", { name: "Enregistrer comme modèle" });
    fireEvent.change(within(save).getByLabelText("Nom du modèle"), { target: { value: "  " } });
    const btn = within(save).getByRole("button", { name: "Enregistrer" }) as HTMLButtonElement;
    expect(btn.disabled).toBe(true);
    fireEvent.mouseEnter(btn.parentElement as HTMLElement);
    const tips = await screen.findAllByRole("tooltip");
    expect(tips.map((x) => x.textContent)).toContain("Saisissez un nom pour enregistrer");
  });

  it("aucun bouton d'enregistrement dans la section pour un membre", async () => {
    mount(false);
    await screen.findByRole("button", { name: /Aperçu du modèle Présentation commerciale/ });
    expect(screen.queryByRole("button", { name: "Enregistrer une présentation comme modèle" })).toBeNull();
  });
});

describe("modèle masqué, rétablir", () => {
  it("aperçu admin : Rétablir remplace Retirer, Utiliser est désactivé avec sa raison, PATCH puis toast", async () => {
    templates = [PITCH, HIDDEN];
    mount(true);
    const dialog = await openPreview("Formation");
    expect(within(dialog).queryByRole("button", { name: "Retirer des modèles" })).toBeNull();
    const use = (await within(dialog).findByRole("button", { name: "Utiliser ce modèle" })) as HTMLButtonElement;
    expect(use.disabled).toBe(true);
    fireEvent.mouseEnter(use.parentElement as HTMLElement);
    const tips = await screen.findAllByRole("tooltip");
    expect(tips.map((x) => x.textContent)).toContain("Ce modèle est masqué : rétablissez-le pour l'utiliser");
    fireEvent.click(within(dialog).getByRole("button", { name: "Rétablir" }));
    await waitFor(() =>
      expect(calls.some((c) => c.method === "PATCH" && (c.body as { hidden: boolean }).hidden === false)).toBe(true)
    );
    await waitFor(() => expect(toast.success).toHaveBeenCalledWith("Modèle « Formation » rétabli"));
  });

  it("modèle visible : pas de Rétablir", async () => {
    mount(true);
    const dialog = await openPreview("Proposition grand compte");
    await within(dialog).findByRole("button", { name: "Retirer des modèles" });
    expect(within(dialog).queryByRole("button", { name: "Rétablir" })).toBeNull();
  });
});

describe("galerie : états", () => {
  it("chargement : squelettes de même gabarit", async () => {
    templatesResponse = () => new Promise<Response>(() => {});
    mount(false);
    fireEvent.click(await screen.findByRole("button", { name: "Nouvelle présentation" }));
    const dialog = await screen.findByRole("dialog");
    const tiles = dialog.querySelectorAll("[data-template-tile]");
    expect(tiles.length).toBe(4); // vierge + 3 squelettes
    expect(dialog.querySelector("[aria-busy='true']")).toBeTruthy();
  });

  it("erreur : message et Réessayer", async () => {
    templatesResponse = () => json({ error: "x" }, 503);
    mount(false);
    fireEvent.click(await screen.findByRole("button", { name: "Nouvelle présentation" }));
    const dialog = await screen.findByRole("dialog");
    const alert = await within(dialog).findByRole("alert");
    expect(alert.textContent).toContain("Les modèles n'ont pas pu être chargés.");
    templatesResponse = () => json({ templates });
    fireEvent.click(within(alert).getByRole("button", { name: "Réessayer" }));
    expect(await within(dialog).findByRole("button", { name: /Créer une présentation à partir de Présentation commerciale/ })).toBeTruthy();
  });

  it("le pied de tuile affiche le nombre de diapositives", async () => {
    mount(false);
    const tile = await screen.findByRole("button", { name: "Aperçu du modèle Présentation commerciale" });
    expect(tile.textContent).toContain("7 diapositives");
  });
});

describe("aperçu : échec de chargement", () => {
  it("Réessayer relit le modèle par la route des modèles", async () => {
    let fail = true;
    extra = (url) =>
      /\/api\/presentations\/templates\/t-pitch$/.test(url) && fail ? json({ error: "x" }, 500) : undefined;
    mount(false);
    const dialog = await openPreview("Présentation commerciale");
    const retry = await within(dialog).findByRole("button", { name: "Réessayer" });
    fail = false;
    fireEvent.click(retry);
    expect(await within(dialog).findByRole("button", { name: "Diapositive 3" })).toBeTruthy();
    expect(calls.filter((c) => c.url === "/api/presentations/templates/t-pitch").length).toBe(2);
  });
});

describe("suppression d'une présentation", () => {
  it("modale applicative (pas de confirm natif), DELETE, toast", async () => {
    const nativeConfirm = vi.fn(() => true);
    vi.stubGlobal("confirm", nativeConfirm);
    mount(false);
    fireEvent.click((await screen.findAllByRole("button", { name: "Supprimer" }))[0]);
    const dialog = await screen.findByRole("dialog");
    expect(dialog.textContent).toContain("Bilan T3");
    expect(calls.some((c) => c.method === "DELETE")).toBe(false);
    fireEvent.click(within(dialog).getByRole("button", { name: "Supprimer" }));
    await waitFor(() => expect(toast.success).toHaveBeenCalledWith("Présentation « Bilan T3 » supprimée"));
    expect(calls.some((c) => c.method === "DELETE" && c.url === "/api/presentations/p1")).toBe(true);
    expect(nativeConfirm).not.toHaveBeenCalled();
  });
});
