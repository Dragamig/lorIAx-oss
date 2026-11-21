// @vitest-environment jsdom
/**
 * T11 : édition directe d'un modèle (bandeau, « Terminer », lecture seule) et
 * « Enregistrer comme modèle » depuis l'éditeur et depuis la liste.
 *
 * Le vrai `PresentationRuntime` est monté : les messages du moteur sont
 * simulés par des `MessageEvent` dont la source est la fenêtre de l'iframe.
 *
 * Preuves par mutation (retrait temporaire, test rouge, restauration, vert) :
 *   - `if (!dirtyRef.current) resolve("saved")` retiré de `saveControlRef` : « Terminer sans
 *     modification » échoue (un PUT part) ;
 *   - `settle("conflict")` remplacé par `settle("error")` : « conflit de version » échoue ;
 *   - `await saveControlRef` retiré de `openSaveAsTemplate` : « la boîte s'ouvre après
 *     l'enregistrement » échoue (boîte ouverte avant le PUT) ;
 *   - `isAdmin` retiré devant le bouton `saveAsTemplate` de l'éditeur : « membre » échoue ;
 *   - `useTemplates({ enabled: false })` remplacé par `useTemplates()` : « n'appelle pas la
 *     liste des modèles » échoue.
 */
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { act, cleanup, fireEvent, screen, waitFor, within } from "@testing-library/react";
import { toast } from "sonner";
import { renderWithIntl } from "./support/render-intl";
import { PresentationEditor } from "@/components/presentations/presentation-editor";
import { TemplateReadOnlyView } from "@/components/presentations/templates/template-readonly-view";
import { PresentationsListClient } from "@/app/[locale]/(app)/presentations/presentations-list-client";
import { SWRConfig } from "swr";

const push = vi.fn();
vi.mock("@/i18n/routing", () => ({
  useRouter: () => ({ push }),
  Link: ({ href, children }: { href: unknown; children: React.ReactNode }) => (
    <a href={typeof href === "string" ? href : JSON.stringify(href)}>{children}</a>
  ),
}));
vi.mock("sonner", () => {
  const fn = Object.assign(vi.fn(), { info: vi.fn(), success: vi.fn(), error: vi.fn() });
  return { toast: fn };
});

const DECK = {
  format: "bento/slides",
  version: 1,
  docId: "11111111-1111-4111-8111-111111111111",
  title: "Pitch",
  size: { width: 1280, height: 720 },
  theme: { background: "#FFFFFF", color: "#1E2A3A", accent: "#F7A600", fontFamily: "Inter" },
  slides: [{ id: "s1", elements: [] }],
} as never;

const json = (body: unknown, status = 200) =>
  new Response(JSON.stringify(body), { status, headers: { "Content-Type": "application/json" } });

const calls: { url: string; method: string; body?: Record<string, unknown> }[] = [];
let putResponse: () => Response;

beforeEach(() => {
  vi.clearAllMocks();
  vi.useFakeTimers({ shouldAdvanceTime: true });
  calls.length = 0;
  putResponse = () => json({ presentation: { version: 4, slideCount: 1 } });
  vi.stubGlobal(
    "fetch",
    vi.fn(async (input: RequestInfo | URL, init?: RequestInit) => {
      const url = String(input);
      const method = init?.method ?? "GET";
      calls.push({ url, method, body: init?.body ? JSON.parse(String(init.body)) : undefined });
      if (method === "PUT") return putResponse();
      if (method === "POST" && url === "/api/presentations") return json({ id: "new-1" }, 201);
      if (method === "POST" && url.endsWith("/template")) return json({ template: { id: "t-new" } }, 201);
      if (method === "GET" && url.startsWith("/api/presentations?spaceId=")) {
        return json([{ id: "p1", title: "Bilan T3", slideCount: 4, updatedAt: "2026-11-10T10:00:00Z" }]);
      }
      if (method === "GET" && url === "/api/presentations/templates") return json({ templates: [] });
      return json({ error: "inattendu" }, 500);
    })
  );
});
afterEach(() => {
  cleanup();
  vi.useRealTimers();
  vi.unstubAllGlobals();
});

type Props = Partial<React.ComponentProps<typeof PresentationEditor>>;

function mount(props: Props = {}) {
  return renderWithIntl(
    <SWRConfig value={{ provider: () => new Map(), dedupingInterval: 0 }}>
      <PresentationEditor
        presentationId="p1"
        initialDeck={DECK}
        initialVersion={3}
        locale="fr"
        title="Pitch"
        spaceId="s-1"
        isTemplate={false}
        isAdmin={false}
        templateOrigin={null}
        templateSeedKey={null}
        {...props}
      />
    </SWRConfig>
  );
}

/** Le moteur signale qu'il est prêt, comme le fait le vrai runtime. */
function engine() {
  const iframe = document.querySelector("iframe") as HTMLIFrameElement;
  const win = iframe.contentWindow as Window;
  const post = vi.spyOn(win, "postMessage");
  const send = (data: unknown) =>
    act(() => {
      window.dispatchEvent(new MessageEvent("message", { data, source: win }));
    });
  send({ type: "ready", readonly: false });
  return { post, send };
}

const puts = () => calls.filter((c) => c.method === "PUT");

describe("bandeau", () => {
  it("absent d'une présentation ordinaire", () => {
    mount({ isAdmin: true });
    expect(screen.queryByTestId("template-banner")).toBeNull();
    expect(screen.queryByRole("button", { name: "Terminer" })).toBeNull();
  });

  it("modèle, admin : « Vous modifiez un modèle » et « Terminer »", () => {
    mount({ isTemplate: true, isAdmin: true, spaceId: null, title: "Mon modèle" });
    const banner = screen.getByTestId("template-banner");
    expect(banner.dataset.kind).toBe("editing");
    expect(banner.textContent).toContain("Vous modifiez un modèle : Mon modèle");
    const done = screen.getByRole("button", { name: "Terminer" });
    expect(done.querySelector("svg")).toBeTruthy();
    expect(screen.queryByRole("button", { name: "Enregistrer comme modèle" })).toBeNull();
  });

  it("modèle LorIAx : le nom affiché est la traduction", () => {
    mount({
      isTemplate: true,
      isAdmin: true,
      spaceId: null,
      title: "Pitch (base)",
      templateOrigin: "lorIAx",
      templateSeedKey: "pitch",
    });
    expect(screen.getByTestId("template-banner").textContent).toContain("Présentation commerciale");
  });

  it("modèle masqué ouvert par un admin : badge « Masqué » dans le bandeau", () => {
    mount({ isTemplate: true, isAdmin: true, spaceId: null, templateHidden: true });
    expect(screen.getByTestId("template-banner").querySelector('[data-template-badge="hidden"]')).toBeTruthy();
  });

  it("modèle visible : pas de badge « Masqué »", () => {
    mount({ isTemplate: true, isAdmin: true, spaceId: null });
    expect(screen.getByTestId("template-banner").querySelector('[data-template-badge="hidden"]')).toBeNull();
  });

  it("n'appelle pas la liste des modèles à l'ouverture de l'éditeur", () => {
    mount({ isAdmin: true });
    expect(calls.filter((c) => c.url.includes("/templates"))).toHaveLength(0);
  });
});

const TEMPLATE = {
  id: "t1",
  title: "Mon modèle",
  templateDescription: "desc",
  templateOrigin: null,
  templateSeedKey: null,
  templateHiddenAt: null,
  version: 5,
  slideCount: 1,
  updatedAt: "2026-11-01T00:00:00Z",
};

describe("membre sur un modèle : aperçu sans moteur", () => {
  const mountMember = (spaces = [{ id: "s-1", name: "Général" }]) =>
    renderWithIntl(
      <SWRConfig value={{ provider: () => new Map(), dedupingInterval: 0 }}>
        <TemplateReadOnlyView template={TEMPLATE} deck={DECK} spaces={spaces} />
      </SWRConfig>
    );

  it("aucune iframe, bandeau lecture seule, « Utiliser ce modèle », aucun bouton d'écriture", () => {
    mountMember();
    expect(document.querySelector("iframe")).toBeNull();
    const banner = screen.getByTestId("template-banner");
    expect(banner.dataset.kind).toBe("readOnly");
    expect(banner.textContent).toContain("Modèle en lecture seule : Mon modèle");
    expect(screen.getByRole("button", { name: "Utiliser ce modèle" })).toBeTruthy();
    expect(screen.queryByRole("button", { name: "Terminer" })).toBeNull();
    expect(screen.queryByRole("button", { name: "Enregistrer comme modèle" })).toBeNull();
    expect(screen.getByRole("group", { name: "Diapositives du modèle" })).toBeTruthy();
  });

  it("« Utiliser » crée une présentation dans l'espace choisi, sans PUT ni lecture de la liste", async () => {
    mountMember([
      { id: "s-1", name: "Général" },
      { id: "s-2", name: "Ventes" },
    ]);
    fireEvent.change(screen.getByLabelText("Créer dans l'espace"), { target: { value: "s-2" } });
    fireEvent.click(screen.getByRole("button", { name: "Utiliser ce modèle" }));
    await waitFor(() => expect(push).toHaveBeenCalled());
    const post = calls.find((c) => c.method === "POST");
    expect(post?.url).toBe("/api/presentations");
    expect(post?.body).toEqual({ templateId: "t1", spaceId: "s-2" });
    expect(puts()).toHaveLength(0);
    expect(calls.some((c) => c.url.includes("/templates"))).toBe(false);
    expect(toast.success).toHaveBeenCalled();
  });

  it("sans espace accessible : bouton désactivé", () => {
    mountMember([]);
    expect((screen.getByRole("button", { name: "Utiliser ce modèle" }) as HTMLButtonElement).disabled).toBe(true);
  });
});

describe("enregistrement automatique", () => {
  it("un admin garde l'enregistrement automatique sur un modèle", async () => {
    mount({ isTemplate: true, isAdmin: true, spaceId: null });
    const { send } = engine();
    send({ type: "dirty", dirty: true });
    await act(async () => {
      await vi.advanceTimersByTimeAsync(2100);
    });
    send({ type: "saved", deck: DECK });
    await waitFor(() => expect(puts()).toHaveLength(1));
    expect(puts()[0].body?.expectedVersion).toBe(3);
  });
});

describe("Terminer", () => {
  it("enregistre par le PUT versionné, affiche un toast, revient à la liste", async () => {
    mount({ isTemplate: true, isAdmin: true, spaceId: null, title: "Mon modèle" });
    const { send, post } = engine();
    send({ type: "dirty", dirty: true });
    fireEvent.click(screen.getByRole("button", { name: "Terminer" }));
    expect(post).toHaveBeenCalledWith({ type: "requestSave" }, "*");
    expect(puts()).toHaveLength(0);
    send({ type: "saved", deck: DECK });
    await waitFor(() => expect(push).toHaveBeenCalledWith("/presentations"));
    expect(puts()).toHaveLength(1);
    expect(puts()[0].url).toBe("/api/presentations/p1");
    expect(puts()[0].body?.expectedVersion).toBe(3);
    expect(toast.success).toHaveBeenCalledWith('Modèle « Mon modèle » mis à jour');
  });

  it("sans modification : l'état du moteur est vérifié, aucun PUT, toast puis retour à la liste", async () => {
    mount({ isTemplate: true, isAdmin: true, spaceId: null, title: "Mon modèle" });
    const { post, send } = engine();
    fireEvent.click(screen.getByRole("button", { name: "Terminer" }));
    expect(post).toHaveBeenCalledWith({ type: "requestSave" }, "*");
    send({ type: "saved", deck: DECK });
    await waitFor(() => expect(push).toHaveBeenCalledWith("/presentations"));
    expect(puts()).toHaveLength(0);
    expect(toast.success).toHaveBeenCalledWith("Modèle « Mon modèle » mis à jour");
  });

  it("modification non encore signalée par le pont : l'état courant du moteur est écrit avant de quitter", async () => {
    mount({ isTemplate: true, isAdmin: true, spaceId: null, title: "Mon modèle" });
    const { post, send } = engine();
    // Aucun message « dirty » : le clic arrive avant le signal du pont.
    fireEvent.click(screen.getByRole("button", { name: "Terminer" }));
    expect(post).toHaveBeenCalledWith({ type: "requestSave" }, "*");
    send({ type: "saved", deck: { ...(DECK as object), title: "Modifié" } });
    await waitFor(() => expect(push).toHaveBeenCalledWith("/presentations"));
    expect(puts()).toHaveLength(1);
    expect((puts()[0].body?.deck as { title: string }).title).toBe("Modifié");
  });

  it("conflit de version (409) : rien n'est quitté, toast d'erreur, conflit affiché", async () => {
    putResponse = () => json({ error: "obsolète", currentVersion: 9 }, 409);
    mount({ isTemplate: true, isAdmin: true, spaceId: null });
    const { send } = engine();
    send({ type: "dirty", dirty: true });
    fireEvent.click(screen.getByRole("button", { name: "Terminer" }));
    send({ type: "saved", deck: DECK });
    await waitFor(() => expect(toast.error).toHaveBeenCalled());
    expect(push).not.toHaveBeenCalled();
    expect(toast.success).not.toHaveBeenCalled();
    expect((toast.error as ReturnType<typeof vi.fn>).mock.calls[0][0]).toMatch(/Rechargez la page/);
    // Le bouton redevient utilisable pour réessayer.
    await waitFor(() => expect((screen.getByRole("button", { name: "Terminer" }) as HTMLButtonElement).disabled).toBe(false));
  });

  it("échec serveur : toast d'erreur, pas de navigation", async () => {
    putResponse = () => json({ error: "boom" }, 500);
    mount({ isTemplate: true, isAdmin: true, spaceId: null });
    const { send } = engine();
    send({ type: "dirty", dirty: true });
    fireEvent.click(screen.getByRole("button", { name: "Terminer" }));
    send({ type: "saved", deck: DECK });
    await waitFor(() => expect(toast.error).toHaveBeenCalledWith("L'enregistrement du modèle a échoué."));
    expect(push).not.toHaveBeenCalled();
  });

  it("Terminer pendant un PUT d'autosave en vol : un seul PUT, aucun 409, sortie après la fin de l'écriture", async () => {
    const DECK2 = { ...(DECK as object), title: "Modifié" } as never;
    let release: (r: Response) => void = () => {};
    // Le serveur ne bumpe la version que s'il reçoit la bonne : une 2e écriture
    // contre la version périmée serait un faux conflit.
    let serverVersion = 3;
    putResponse = () =>
      new Promise<Response>((resolve) => {
        release = resolve;
      }) as unknown as Response;
    mount({ isTemplate: true, isAdmin: true, spaceId: null, title: "Mon modèle" });
    const { send } = engine();
    send({ type: "dirty", dirty: true });
    await act(async () => {
      await vi.advanceTimersByTimeAsync(2100);
    });
    send({ type: "saved", deck: DECK2 });
    await waitFor(() => expect(puts()).toHaveLength(1));
    // Le PUT d'autosave est en vol : l'utilisateur clique sur Terminer.
    fireEvent.click(screen.getByRole("button", { name: "Terminer" }));
    send({ type: "saved", deck: DECK2 });
    await act(async () => {
      await vi.advanceTimersByTimeAsync(50);
    });
    expect(puts()).toHaveLength(1);
    expect(push).not.toHaveBeenCalled();
    serverVersion = 4;
    await act(async () => {
      release(json({ presentation: { version: serverVersion, slideCount: 1 } }));
      await vi.advanceTimersByTimeAsync(50);
    });
    await waitFor(() => expect(push).toHaveBeenCalledWith("/presentations"));
    expect(puts()).toHaveLength(1);
    expect(puts()[0].body?.expectedVersion).toBe(3);
    expect(toast.error).not.toHaveBeenCalled();
  });

  it("moteur muet : toast d'erreur dédié, pas de sortie", async () => {
    mount({ isTemplate: true, isAdmin: true, spaceId: null });
    const { send } = engine();
    fireEvent.click(screen.getByRole("button", { name: "Terminer" }));
    await act(async () => {
      await vi.advanceTimersByTimeAsync(5100);
    });
    await waitFor(() => expect(toast.error).toHaveBeenCalledWith("L'enregistrement du modèle a échoué."));
    expect(push).not.toHaveBeenCalled();
    void send;
  });

  it("moteur muet : l'enregistrement échoue franchement, sans navigation", async () => {
    mount({ isTemplate: true, isAdmin: true, spaceId: null });
    const { send } = engine();
    send({ type: "dirty", dirty: true });
    fireEvent.click(screen.getByRole("button", { name: "Terminer" }));
    await act(async () => {
      await vi.advanceTimersByTimeAsync(5100);
    });
    await waitFor(() => expect(toast.error).toHaveBeenCalled());
    expect(puts()).toHaveLength(0);
    expect(push).not.toHaveBeenCalled();
  });
});

describe("Enregistrer comme modèle depuis l'éditeur", () => {
  it("absent pour un membre", () => {
    mount({ isAdmin: false });
    expect(screen.queryByRole("button", { name: "Enregistrer comme modèle" })).toBeNull();
  });

  it("moteur pas prêt : bouton désactivé, l'info-bulle donne la raison", () => {
    mount({ isAdmin: true });
    const btn = screen.getByRole("button", { name: "Enregistrer comme modèle" }) as HTMLButtonElement;
    expect(btn.disabled).toBe(true);
    fireEvent.mouseEnter(btn.parentElement as HTMLElement);
    expect(screen.getByRole("tooltip").textContent).toContain("Le moteur d'édition se charge, patientez un instant");
    fireEvent.mouseLeave(btn.parentElement as HTMLElement);
    engine();
    expect(btn.disabled).toBe(false);
  });

  it("la boîte s'ouvre après l'enregistrement des modifications en attente", async () => {
    mount({ isAdmin: true, title: "Bilan T3" });
    const { send, post } = engine();
    send({ type: "dirty", dirty: true });
    fireEvent.click(screen.getByRole("button", { name: "Enregistrer comme modèle" }));
    expect(post).toHaveBeenCalledWith({ type: "requestSave" }, "*");
    expect(screen.queryByRole("dialog")).toBeNull();
    expect(puts()).toHaveLength(0);
    send({ type: "saved", deck: DECK });
    await screen.findByRole("dialog");
    expect(puts()).toHaveLength(1);
    expect(calls.some((c) => c.method === "POST" && c.url.endsWith("/template"))).toBe(false);
  });

  it("conflit ou échec de l'enregistrement : toast d'erreur, boîte non ouverte", async () => {
    putResponse = () => json({ error: "obsolète" }, 409);
    mount({ isAdmin: true });
    const { send } = engine();
    send({ type: "dirty", dirty: true });
    fireEvent.click(screen.getByRole("button", { name: "Enregistrer comme modèle" }));
    send({ type: "saved", deck: DECK });
    await waitFor(() => expect(toast.error).toHaveBeenCalled());
    expect(screen.queryByRole("dialog")).toBeNull();
    expect((toast.error as ReturnType<typeof vi.fn>).mock.calls[0][0]).toMatch(/Rechargez la page/);
  });

  it("admin : icône, boîte, copie créée, présentation inchangée", async () => {
    mount({ isAdmin: true, title: "Bilan T3" });
    const { send } = engine();
    const btn = screen.getByRole("button", { name: "Enregistrer comme modèle" });
    expect(btn.querySelector("svg")).toBeTruthy();
    fireEvent.mouseEnter(btn.parentElement as HTMLElement);
    expect(screen.getByRole("tooltip").textContent).toBeTruthy();
    fireEvent.click(btn);
    send({ type: "saved", deck: DECK });
    const dialog = await screen.findByRole("dialog");
    expect((within(dialog).getByLabelText("Nom du modèle") as HTMLInputElement).value).toBe("Bilan T3");
    fireEvent.click(within(dialog).getByRole("button", { name: "Enregistrer" }));
    await waitFor(() => expect(toast.success).toHaveBeenCalled());
    const post = calls.find((c) => c.method === "POST");
    expect(post?.url).toBe("/api/presentations/p1/template");
    expect(post?.body).toEqual({ name: "Bilan T3" });
    expect(puts()).toHaveLength(0);
    expect(push).not.toHaveBeenCalled();
    expect(screen.queryByTestId("template-banner")).toBeNull();
  });
});

describe("Enregistrer comme modèle depuis la liste", () => {
  const SPACE = "11111111-1111-4111-8111-111111111111";
  const mountList = (isAdmin: boolean) =>
    renderWithIntl(
      <SWRConfig value={{ provider: () => new Map(), dedupingInterval: 0 }}>
        <PresentationsListClient spaceId={SPACE} isAdmin={isAdmin} />
      </SWRConfig>
    );

  it("membre : pas de menu « ⋯ »", async () => {
    mountList(false);
    await screen.findByText("Bilan T3");
    expect(screen.queryByRole("button", { name: "Autres actions" })).toBeNull();
  });

  it("admin : menu de la carte, boîte, copie créée, carte toujours présente", async () => {
    mountList(true);
    await screen.findByText("Bilan T3");
    const more = screen.getByRole("button", { name: "Autres actions" });
    expect(more.querySelector("svg")).toBeTruthy();
    fireEvent.click(more);
    fireEvent.click(await screen.findByRole("menuitem", { name: "Enregistrer comme modèle" }));
    const dialog = await screen.findByRole("dialog");
    expect((within(dialog).getByLabelText("Nom du modèle") as HTMLInputElement).value).toBe("Bilan T3");
    fireEvent.click(within(dialog).getByRole("button", { name: "Enregistrer" }));
    await waitFor(() => expect(toast.success).toHaveBeenCalled());
    const post = calls.find((c) => c.method === "POST");
    expect(post?.url).toBe("/api/presentations/p1/template");
    expect(calls.some((c) => c.method === "DELETE" || c.method === "PUT")).toBe(false);
    expect(screen.getByText("Bilan T3")).toBeTruthy();
  });
});
