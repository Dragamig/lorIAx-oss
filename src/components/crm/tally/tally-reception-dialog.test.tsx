// @vitest-environment jsdom
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { cleanup, fireEvent, render, screen, waitFor, within } from "@testing-library/react";
import { TallyReceptionDialog } from "./tally-reception-dialog";

const h = vi.hoisted(() => ({ success: vi.fn(), error: vi.fn(), plain: vi.fn() }));

vi.mock("next-intl", async () => (await import("@/components/media/test-fixtures")).intlMock());
vi.mock("sonner", () => ({ toast: Object.assign(h.plain, { success: h.success, error: h.error }) }));

const FIELDS = [
  { key: "q1", label: "Votre nom", type: "INPUT_TEXT" },
  { key: "q2", label: "Société", type: "INPUT_TEXT" },
  { key: "q3", label: "E-mail", type: "INPUT_EMAIL" },
];
const CONFIG = { token: "tok123", secret: "whsec_abc", tallyFormId: null, lastReceived: { at: "x" } };
const AUTOMATION = { id: "a1", databaseId: "d1", triggerConfig: CONFIG as Record<string, unknown> };

let fieldsReply: { fields: typeof FIELDS | never[] } | "error";
const fetchMock = vi.fn();

beforeEach(() => {
  fieldsReply = { fields: [] };
  fetchMock.mockReset();
  fetchMock.mockImplementation(async (url: string, init?: RequestInit) => {
    if (init?.method === "PATCH") return { ok: true, json: async () => ({}) };
    if (fieldsReply === "error") return { ok: false, json: async () => ({}) };
    return { ok: true, json: async () => fieldsReply };
  });
  vi.stubGlobal("fetch", fetchMock);
  Object.assign(navigator, { clipboard: { writeText: vi.fn().mockResolvedValue(undefined), readText: vi.fn().mockResolvedValue("https://tally.so/r/abc123") } });
  h.success.mockReset();
  h.error.mockReset();
  h.plain.mockReset();
});
afterEach(() => {
  cleanup();
  vi.unstubAllGlobals();
});

const open = (props: Partial<React.ComponentProps<typeof TallyReceptionDialog>> = {}) =>
  render(<TallyReceptionDialog open onOpenChange={() => {}} automation={AUTOMATION} onSaved={() => {}} {...props} />);

describe("TallyReceptionDialog", () => {
  it("sans réponse de test : état vide avec Recharger, qui relit les champs", async () => {
    open();
    expect(await screen.findByText(/apparaissent après la première réponse de test/)).toBeTruthy();
    const btn = screen.getByRole("button", { name: "Recharger les champs du formulaire" });
    fetchMock.mockClear();
    fireEvent.click(btn);
    await waitFor(() => expect(fetchMock).toHaveBeenCalledWith("/api/databases/d1/automations/a1/tally-fields"));
    await waitFor(() => expect(h.plain).toHaveBeenCalledWith("Aucune réponse de test reçue pour le moment"));
  });

  it("champs reçus : détection signalée, titre automatique, menus étiquetés", async () => {
    fieldsReply = { fields: FIELDS };
    open();
    const name = (await screen.findByLabelText("Champ Tally pour Nom")) as HTMLSelectElement;
    expect(name.value).toBe("q1");
    expect((screen.getByLabelText("Champ Tally pour E-mail") as HTMLSelectElement).value).toBe("q3");
    const title = screen.getByLabelText("Champ Tally pour Titre") as HTMLSelectElement;
    expect(title.value).toBe("");
    expect(within(title).getByText("Automatique : nom du contact")).toBeTruthy();
    expect(screen.getAllByText("détecté automatiquement")).toHaveLength(2);
    fireEvent.change(name, { target: { value: "q2" } });
    expect(screen.getAllByText("détecté automatiquement")).toHaveLength(1);
    expect(h.success).toHaveBeenCalledWith("Correspondance modifiée : Nom", expect.objectContaining({ action: expect.objectContaining({ label: "Annuler" }) }));
  });

  it("annuler un changement de correspondance rétablit la détection", async () => {
    fieldsReply = { fields: FIELDS };
    open();
    const name = (await screen.findByLabelText("Champ Tally pour Nom")) as HTMLSelectElement;
    fireEvent.change(name, { target: { value: "q2" } });
    const opts = h.success.mock.calls.at(-1)![1] as { action: { onClick: () => void } };
    opts.action.onClick();
    await waitFor(() => expect((screen.getByLabelText("Champ Tally pour Nom") as HTMLSelectElement).value).toBe("q1"));
    expect(screen.getAllByText("détecté automatiquement")).toHaveLength(2);
  });

  it("Enregistrer est inactif et explique pourquoi tant que le formulaire est invalide", async () => {
    open();
    const save = screen.getByRole("button", { name: "Enregistrer" });
    expect(save.getAttribute("aria-disabled")).toBe("true");
    fireEvent.click(save);
    expect(fetchMock.mock.calls.some((c) => c[1]?.method === "PATCH")).toBe(false);
    const input = screen.getByLabelText("Identifiant ou URL du formulaire");
    fireEvent.change(input, { target: { value: "nimporte quoi" } });
    expect(screen.getByText("Ni une URL tally.so ni un identifiant valide")).toBeTruthy();
    fireEvent.change(input, { target: { value: "https://tally.so/r/wMx4Rq?x=1" } });
    expect(screen.getByText("Formulaire reconnu : wMx4Rq")).toBeTruthy();
    expect(save.getAttribute("aria-disabled")).toBeNull();
  });

  it("enregistre le formulaire et la correspondance explicite sans renvoyer token, secret ni dernier corps", async () => {
    fieldsReply = { fields: FIELDS };
    const onSaved = vi.fn();
    const onOpenChange = vi.fn();
    open({ onSaved, onOpenChange });
    const name = (await screen.findByLabelText("Champ Tally pour Nom")) as HTMLSelectElement;
    fireEvent.change(name, { target: { value: "q2" } });
    fireEvent.change(screen.getByLabelText("Identifiant ou URL du formulaire"), { target: { value: "wMx4Rq" } });
    fireEvent.click(screen.getByRole("button", { name: "Enregistrer" }));
    await waitFor(() => expect(onSaved).toHaveBeenCalled());
    const call = fetchMock.mock.calls.find((c) => c[1]?.method === "PATCH")!;
    expect(call[0]).toBe("/api/databases/d1/automations/a1");
    expect(JSON.parse(call[1].body)).toEqual({ triggerConfig: { tallyFormId: "wMx4Rq", tallyFieldMap: { name: "q2" } } });
    expect(onOpenChange).toHaveBeenCalledWith(false);
    expect(h.success).toHaveBeenCalledWith("Formulaire wMx4Rq enregistré, activation possible", expect.objectContaining({ action: expect.objectContaining({ label: "Annuler" }) }));
  });

  it("échec d'enregistrement : toast d'erreur, boîte ouverte", async () => {
    const onOpenChange = vi.fn();
    fetchMock.mockImplementation(async (_u: string, init?: RequestInit) => (init?.method === "PATCH" ? { ok: false, json: async () => ({}) } : { ok: true, json: async () => ({ fields: [] }) }));
    open({ onOpenChange });
    fireEvent.change(screen.getByLabelText("Identifiant ou URL du formulaire"), { target: { value: "wMx4Rq" } });
    fireEvent.click(screen.getByRole("button", { name: "Enregistrer" }));
    await waitFor(() => expect(h.error).toHaveBeenCalledWith("Enregistrement impossible"));
    expect(onOpenChange).not.toHaveBeenCalled();
  });

  it("secret masqué, affichable et copiable ; URL copiable", async () => {
    open();
    const secret = screen.getByLabelText("Secret (en-tête X-Webhook-Secret)") as HTMLInputElement;
    expect(secret.type).toBe("password");
    fireEvent.click(screen.getByRole("button", { name: "Afficher le secret" }));
    expect(secret.type).toBe("text");
    fireEvent.click(screen.getByRole("button", { name: "Copier le secret" }));
    await waitFor(() => expect(navigator.clipboard.writeText).toHaveBeenCalledWith("whsec_abc"));
    fireEvent.click(screen.getByRole("button", { name: "Copier l'URL du webhook" }));
    await waitFor(() => expect(navigator.clipboard.writeText).toHaveBeenCalledWith(expect.stringContaining("/api/automations/hook/tok123")));
    expect(h.success).toHaveBeenCalledWith("URL du webhook copiée");
  });

  it("secret vide : Copier le secret est inactif et explique pourquoi", async () => {
    open({ automation: { ...AUTOMATION, triggerConfig: { ...CONFIG, secret: "" } } });
    const btn = screen.getByRole("button", { name: "Copier le secret" });
    expect(btn.getAttribute("aria-disabled")).toBe("true");
    fireEvent.click(btn);
    expect(navigator.clipboard.writeText).not.toHaveBeenCalled();
    fireEvent.focus(btn);
    expect(await screen.findByText("Aucun secret à copier : le secret n'est pas encore généré")).toBeTruthy();
  });

  it("coller depuis le presse-papiers remplit le champ", async () => {
    open();
    fireEvent.click(screen.getByRole("button", { name: "Coller depuis le presse-papiers" }));
    await waitFor(() => expect((screen.getByLabelText("Identifiant ou URL du formulaire") as HTMLInputElement).value).toBe("https://tally.so/r/abc123"));
  });

  it("chaque bouton a un nom accessible et une icône", async () => {
    fieldsReply = { fields: FIELDS };
    open();
    await screen.findByLabelText("Champ Tally pour Nom");
    for (const b of screen.getAllByRole("button")) {
      expect(b.getAttribute("aria-label") || b.textContent, "bouton sans nom").toBeTruthy();
      expect(b.querySelector("svg"), b.getAttribute("aria-label") ?? "").toBeTruthy();
    }
  });
});

describe("aides pas à pas", () => {
  const dialog = () => screen.getAllByRole("dialog").at(-1)!;

  it("Aide du formulaire : 2 étapes, navigation au clavier", async () => {
    open();
    fireEvent.click(screen.getByRole("button", { name: "Aide : choisir le formulaire Tally" }));
    expect(await screen.findByText("1 sur 2")).toBeTruthy();
    expect(screen.getByRole("heading", { name: "1. Créer ou ouvrir le formulaire" })).toBeTruthy();
    fireEvent.keyDown(dialog(), { key: "ArrowRight" });
    expect(screen.getByRole("heading", { name: "2. Coller l'URL du formulaire" })).toBeTruthy();
    expect(screen.getByRole("button", { name: "Terminer" })).toBeTruthy();
    fireEvent.keyDown(dialog(), { key: "ArrowLeft" });
    expect(screen.getByText("1 sur 2")).toBeTruthy();
  });

  it("Aide À coller : 3 étapes", async () => {
    open();
    fireEvent.click(screen.getByRole("button", { name: "Aide : coller l'URL dans Tally" }));
    expect(await screen.findByText("1 sur 3")).toBeTruthy();
    expect(screen.getAllByRole("button", { name: /^Étape \d : / })).toHaveLength(3);
  });

  it("Aide Correspondance : 1 étape, Fermer seul, ni compteur ni Précédent", async () => {
    open();
    fireEvent.click(screen.getByRole("button", { name: "Aide : choisir les correspondances" }));
    await screen.findByRole("heading", { name: "Vérifier ou changer les champs, puis enregistrer" });
    expect(screen.queryByText(/\d sur \d/)).toBeNull();
    expect(screen.queryByRole("button", { name: "Précédent" })).toBeNull();
    expect(screen.queryByRole("button", { name: "Suivant" })).toBeNull();
    expect(within(dialog()).getAllByRole("button", { name: "Fermer" }).length).toBeGreaterThan(0);
  });

  it("guide complet : 6 étapes, pastilles, Précédent inactif à la première, fin annoncée", async () => {
    open();
    fireEvent.click(screen.getByRole("button", { name: "Aide pas à pas : brancher Tally" }));
    expect(await screen.findByText("1 sur 6")).toBeTruthy();
    expect(screen.getAllByRole("button", { name: /^Étape \d : / })).toHaveLength(6);
    expect(screen.getByRole("button", { name: "Précédent" }).getAttribute("aria-disabled")).toBe("true");
    for (let i = 0; i < 5; i++) fireEvent.click(screen.getByRole("button", { name: "Suivant" }));
    expect(screen.getByText("6 sur 6")).toBeTruthy();
    fireEvent.click(screen.getByRole("button", { name: "Terminer" }));
    await waitFor(() => expect(h.plain).toHaveBeenCalledWith("Aide terminée"));
  });
});
