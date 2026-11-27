// @vitest-environment jsdom
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react";

const toastMock = vi.hoisted(() => ({ success: vi.fn(), error: vi.fn() }));
vi.mock("sonner", () => ({ toast: toastMock }));
vi.mock("next-intl", async () => (await import("@/components/media/test-fixtures")).intlMock());

import { CreationCard } from "../creation-card";

const ID = "11111111-1111-4111-8111-111111111111";
const S1 = "22222222-2222-4222-8222-222222222222";
const S2 = "33333333-3333-4333-8333-333333333333";

function view(over: Record<string, unknown> = {}) {
  return {
    id: ID,
    kind: "spreadsheet",
    status: "pending",
    title: "Suivi des commandes",
    spaceId: S1,
    spaceName: "Achats",
    createdAt: "2026-11-26T10:00:00Z",
    expiresAt: "2026-11-27T10:00:00Z",
    canApply: true,
    editableSpaces: [
      { id: S1, name: "Achats" },
      { id: S2, name: "Projet Atelier" },
    ],
    preview: {
      kind: "spreadsheet",
      columns: [{ name: "Fournisseur" }, { name: "Quantité", type: "number" }],
      rows: [["Tissus Delmas", "120"]],
      rowCount: 1,
    },
    result: null,
    ...over,
  };
}

type Call = { url: string; method: string; body?: string };
let calls: Call[];
let current: ReturnType<typeof view>;
let post: Record<string, { status: number; body: unknown; delay?: boolean }>;
let release: (() => void) | null;
let afterPost: Record<string, Partial<ReturnType<typeof view>>>;

beforeEach(() => {
  calls = [];
  current = view();
  post = {};
  afterPost = {};
  release = null;
  toastMock.success.mockClear();
  toastMock.error.mockClear();
  vi.stubGlobal(
    "fetch",
    vi.fn(async (url: string, init?: RequestInit) => {
      const method = init?.method ?? "GET";
      calls.push({ url, method, body: init?.body as string | undefined });
      const json = (status: number, body: unknown) =>
        ({ ok: status >= 200 && status < 300, status, json: async () => body }) as Response;
      if (method === "GET") return json(200, { creations: [current] });
      const action = url.split("/").pop()!;
      const conf = post[action] ?? { status: 200, body: {} };
      if (conf.delay) await new Promise<void>((r) => (release = r));
      if (conf.status < 300 && afterPost[action]) current = { ...current, ...afterPost[action] };
      return json(conf.status, conf.body);
    }),
  );
});
afterEach(() => {
  cleanup();
  vi.unstubAllGlobals();
});

const posts = () => calls.filter((c) => c.method === "POST");

describe("CreationCard", () => {
  it("affiche l'état en attente avec aperçu et trois boutons nommés", async () => {
    render(<CreationCard proposalId={ID} />);
    expect(await screen.findByText("Suivi des commandes")).toBeTruthy();
    expect(screen.getByText("En attente")).toBeTruthy();
    expect(screen.getByRole("table", { name: "Aperçu du tableur" })).toBeTruthy();
    expect(screen.getByText("Tissus Delmas")).toBeTruthy();
    for (const name of ["Créer : tableur", "Modifier avant création", "Ignorer cette proposition"]) {
      expect(screen.getByRole("button", { name })).toBeTruthy();
    }
  });

  it("Créer envoie apply sans corps, toast avec Annuler qui appelle undo", async () => {
    afterPost.apply = { status: "applied", result: { id: "r1", title: "Suivi des commandes", href: "/s/achats/r1" } } as never;
    post.apply = { status: 200, body: { status: "applied", result: { title: "Suivi des commandes" } } };
    render(<CreationCard proposalId={ID} />);
    fireEvent.click(await screen.findByRole("button", { name: "Créer : tableur" }));
    await waitFor(() => expect(screen.getByText("Créé")).toBeTruthy());
    expect(posts()[0].url).toBe(`/api/ai/creations/${ID}/apply`);
    expect(posts()[0].body).toBeUndefined();
    expect(screen.getByRole("link", { name: "Ouvrir le tableur" }).getAttribute("href")).toBe("/s/achats/r1");
    const opts = toastMock.success.mock.calls[0][1] as { action: { label: string; onClick: () => void } };
    expect(opts.action.label).toBe("Annuler");
    opts.action.onClick();
    await waitFor(() => expect(posts().some((c) => c.url.endsWith("/undo"))).toBe(true));
  });

  it("le bouton Annuler la création appelle undo et passe en Annulée", async () => {
    current = view({ status: "applied", result: { id: "r1", title: "T", href: "/s/achats/r1" } });
    render(<CreationCard proposalId={ID} />);
    fireEvent.click(await screen.findByRole("button", { name: /Annuler la création/ }));
    await waitFor(() => expect(screen.getByText("Annulée")).toBeTruthy());
    expect(posts()[0].url).toBe(`/api/ai/creations/${ID}/undo`);
  });

  it("double clic sur Créer : une seule requête, bouton désactivé pendant l'envoi", async () => {
    post.apply = { status: 200, body: { result: { title: "T" } }, delay: true };
    render(<CreationCard proposalId={ID} />);
    const btn = await screen.findByRole("button", { name: "Créer : tableur" });
    fireEvent.click(btn);
    fireEvent.click(btn);
    await waitFor(() => expect((screen.getByRole("button", { name: /Création en cours/ }) as HTMLButtonElement).disabled).toBe(true));
    expect(posts()).toHaveLength(1);
    release?.();
    await waitFor(() => expect(toastMock.success).toHaveBeenCalled());
  });

  it("Ignorer envoie dismiss et affiche Ignorée avec seulement Rétablir", async () => {
    afterPost.dismiss = { status: "dismissed" } as never;
    render(<CreationCard proposalId={ID} />);
    fireEvent.click(await screen.findByRole("button", { name: "Ignorer cette proposition" }));
    await waitFor(() => expect(screen.getByText("Ignorée")).toBeTruthy());
    expect(posts()[0].url).toBe(`/api/ai/creations/${ID}/dismiss`);
    expect(screen.getAllByRole("button").map((b) => b.getAttribute("aria-label"))).toEqual(["Rétablir cette proposition ignorée"]);
    expect(toastMock.success).toHaveBeenCalledWith("Proposition ignorée", expect.objectContaining({ action: expect.objectContaining({ label: "Annuler" }) }));
  });

  it("Rétablir envoie restore et repasse la carte en attente", async () => {
    current = view({ status: "dismissed" });
    afterPost.restore = { status: "pending" } as never;
    render(<CreationCard proposalId={ID} />);
    fireEvent.click(await screen.findByRole("button", { name: "Rétablir cette proposition ignorée" }));
    await waitFor(() => expect(screen.getByRole("button", { name: "Créer : tableur" })).toBeTruthy());
    expect(posts()[0].url).toBe(`/api/ai/creations/${ID}/restore`);
  });

  it("l'action Annuler du toast d'ignorance rétablit la proposition", async () => {
    afterPost.dismiss = { status: "dismissed" } as never;
    afterPost.restore = { status: "pending" } as never;
    render(<CreationCard proposalId={ID} />);
    fireEvent.click(await screen.findByRole("button", { name: "Ignorer cette proposition" }));
    await waitFor(() => expect(toastMock.success).toHaveBeenCalled());
    toastMock.success.mock.calls[0][1].action.onClick();
    await waitFor(() => expect(posts().map((c) => c.url.split("/").pop())).toEqual(["dismiss", "restore"]));
  });

  it("proposition annulée au rechargement : badge Annulée, aucun lien ni bouton", async () => {
    current = view({ status: "undone" });
    render(<CreationCard proposalId={ID} />);
    await waitFor(() => expect(screen.getByText("Annulée")).toBeTruthy());
    expect(screen.queryByRole("button")).toBeNull();
    expect(screen.queryByRole("link")).toBeNull();
  });

  it("dismiss refusé (409) : toast d'erreur et état relu depuis le serveur", async () => {
    post.dismiss = { status: 409, body: { code: "refused", error: "Cette proposition ne peut plus être ignorée" } };
    afterPost.dismiss = {};
    current = view();
    render(<CreationCard proposalId={ID} />);
    fireEvent.click(await screen.findByRole("button", { name: "Ignorer cette proposition" }));
    await waitFor(() => expect(toastMock.error).toHaveBeenCalledWith("Cette proposition ne peut plus être ignorée"));
  });

  it("état refusée : Créer désactivé avec motif en info-bulle, message visible", async () => {
    current = view({ canApply: false });
    render(<CreationCard proposalId={ID} />);
    const btn = (await screen.findByRole("button", { name: "Créer (indisponible)" })) as HTMLButtonElement;
    expect(btn.disabled).toBe(true);
    expect(screen.getByText("Refusée")).toBeTruthy();
    expect(screen.getByText(/vous n'avez plus le droit d'édition sur l'espace Achats/)).toBeTruthy();
    fireEvent.focus(btn.parentElement!);
    expect(await screen.findByText("Indisponible : droit d'édition retiré sur l'espace Achats")).toBeTruthy();
  });

  it("refus serveur 409 à l'apply : carte passe en Refusée avec le message", async () => {
    post.apply = { status: 409, body: { code: "refused", error: "Vous n'avez plus le droit d'éditer cet espace" } };
    render(<CreationCard proposalId={ID} />);
    fireEvent.click(await screen.findByRole("button", { name: "Créer : tableur" }));
    await waitFor(() => expect(screen.getByText("Refusée")).toBeTruthy());
    expect(screen.getByText(/Vous n'avez plus le droit d'éditer cet espace/)).toBeTruthy();
    expect(toastMock.error).toHaveBeenCalled();
  });

  it("changer d'espace envoie overrides.spaceId, seulement les espaces éditeur sont listés", async () => {
    post.apply = { status: 200, body: { result: { title: "T" } } };
    render(<CreationCard proposalId={ID} />);
    fireEvent.click(await screen.findByRole("button", { name: "Modifier avant création" }));
    const select = screen.getByLabelText("Espace cible") as HTMLSelectElement;
    expect([...select.options].map((o) => o.text)).toEqual(["Achats", "Projet Atelier"]);
    fireEvent.change(select, { target: { value: S2 } });
    fireEvent.change(screen.getByLabelText("Titre"), { target: { value: "Nouveau titre" } });
    fireEvent.click(screen.getByRole("button", { name: "Créer : tableur" }));
    await waitFor(() => expect(posts()).toHaveLength(1));
    expect(JSON.parse(posts()[0].body!)).toEqual({ overrides: { title: "Nouveau titre", spaceId: S2 } });
  });

  it("refusée : choisir un autre espace réactive Créer", async () => {
    current = view({ canApply: false });
    render(<CreationCard proposalId={ID} />);
    fireEvent.click(await screen.findByRole("button", { name: "Choisir un autre espace" }));
    fireEvent.change(screen.getByLabelText("Espace cible"), { target: { value: S2 } });
    const btn = screen.getByRole("button", { name: "Créer : tableur" }) as HTMLButtonElement;
    expect(btn.disabled).toBe(false);
  });

  it("document : plan modifié envoyé en overrides.outline avec niveaux conservés", async () => {
    current = view({
      kind: "document",
      title: "Note",
      preview: { kind: "document", outline: [{ heading: "A", level: 1 }, { heading: "B", level: 2 }], visibility: "team" },
    });
    post.apply = { status: 200, body: { result: { title: "Note" } } };
    render(<CreationCard proposalId={ID} />);
    fireEvent.click(await screen.findByRole("button", { name: "Modifier avant création" }));
    fireEvent.change(screen.getByLabelText("Plan (une section par ligne)"), { target: { value: "A\nC" } });
    fireEvent.click(screen.getByRole("button", { name: "Créer : document" }));
    await waitFor(() => expect(posts()).toHaveLength(1));
    expect(JSON.parse(posts()[0].body!)).toEqual({
      overrides: { outline: [{ heading: "A", level: 1 }, { heading: "C", level: 2 }] },
    });
  });

  it("présentation : vignettes de même gabarit, texte jamais interprété comme HTML", async () => {
    current = view({
      kind: "presentation",
      preview: { kind: "presentation", slides: [{ title: "<img src=x onerror=alert(1)>", layout: "cover" }, { title: "Suite" }] },
    });
    const { container } = render(<CreationCard proposalId={ID} />);
    expect(await screen.findByText("<img src=x onerror=alert(1)>")).toBeTruthy();
    expect(container.querySelector("img")).toBeNull();
    const items = screen.getAllByRole("listitem");
    expect(items).toHaveLength(2);
    expect(items[0].className).toContain("aspect-video");
    expect(items[1].className).toContain("aspect-video");
  });

  it("erreur de chargement : message et bouton Réessayer", async () => {
    vi.stubGlobal("fetch", vi.fn(async () => ({ ok: false, status: 404, json: async () => ({}) }) as Response));
    render(<CreationCard proposalId={ID} />);
    expect(await screen.findByRole("alert")).toBeTruthy();
    expect(screen.getByRole("button", { name: "Relire la proposition" })).toBeTruthy();
  });
});
