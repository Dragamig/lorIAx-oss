// @vitest-environment jsdom
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react";
import { NextIntlClientProvider } from "next-intl";
import fr from "../../../../messages/fr.json";
import { todayIn } from "@/lib/crm/dates";
import type { DealSheetDto } from "@/lib/crm/deals";
import { DealActivity } from "./deal-activity";
import { makeDealSheetDto } from "./deal-sheet-fixture";

const toastApi = vi.hoisted(() => Object.assign(vi.fn(), { success: vi.fn(), error: vi.fn(), info: vi.fn() }));
vi.mock("sonner", () => ({ toast: toastApi }));
vi.mock("./activity/activity-feed", () => ({
  ActivityFeed: ({ header, children }: { header?: React.ReactNode; children?: React.ReactNode }) => (
    <div>
      {header}
      {children}
    </div>
  ),
}));

const today = todayIn(new Date(), Intl.DateTimeFormat().resolvedOptions().timeZone);
let posts: { url: string; body: Record<string, unknown> }[];
let postOk: boolean;

beforeEach(() => {
  posts = [];
  postOk = true;
  for (const f of [toastApi.success, toastApi.error]) f.mockClear();
  vi.stubGlobal(
    "fetch",
    vi.fn(async (url: string, init?: RequestInit) => {
      posts.push({ url, body: JSON.parse(String(init?.body)) });
      return postOk ? { ok: true, status: 201, json: async () => ({}) } : { ok: false, status: 500, json: async () => ({}) };
    }),
  );
});
afterEach(() => {
  cleanup();
  vi.unstubAllGlobals();
});

function setup(over: Partial<DealSheetDto> = {}) {
  const onCreated = vi.fn();
  const onOuterKey = vi.fn();
  render(
    <NextIntlClientProvider locale="fr" messages={fr}>
      <div onKeyDown={onOuterKey}>
        <DealActivity dto={makeDealSheetDto(over)} onCreated={onCreated} />
      </div>
    </NextIntlClientProvider>,
  );
  return { onCreated, onOuterKey };
}
const openForm = () => fireEvent.click(screen.getByRole("button", { name: /Ajouter une interaction au dossier/ }));

describe("InteractionForm", () => {
  it("soumission sans type refusée avec message, aucun appel", () => {
    setup();
    openForm();
    fireEvent.click(screen.getByRole("button", { name: "Enregistrer" }));
    expect(screen.getByRole("alert").textContent).toBe("Choisissez un type");
    expect(posts).toHaveLength(0);
  });

  it("envoie type, intitulé, date et commentaire, puis toast sans Annuler et formulaire refermé", async () => {
    const { onCreated } = setup();
    openForm();
    fireEvent.change(screen.getByLabelText("Type d'interaction"), { target: { value: "Appel" } });
    fireEvent.change(screen.getByLabelText("Intitulé de l'interaction"), { target: { value: " Suivi " } });
    fireEvent.change(screen.getByLabelText("Commentaire"), { target: { value: "Tout va bien" } });
    fireEvent.click(screen.getByRole("button", { name: "Enregistrer" }));
    await waitFor(() => expect(posts).toHaveLength(1));
    expect(posts[0].url).toContain("/api/crm/deals/1/interactions");
    expect(posts[0].body).toEqual({ type: "Appel", title: "Suivi", date: today, note: "Tout va bien" });
    await waitFor(() => expect(toastApi.success).toHaveBeenCalledTimes(1));
    expect(toastApi.success.mock.calls[0][1]).toBeUndefined();
    expect(onCreated).toHaveBeenCalledTimes(1);
    expect(screen.queryByTestId("fiche-interaction-form")).toBeNull();
  });

  it("Entrée dans l'intitulé envoie", async () => {
    setup();
    openForm();
    fireEvent.change(screen.getByLabelText("Type d'interaction"), { target: { value: "Mail" } });
    fireEvent.keyDown(screen.getByLabelText("Intitulé de l'interaction"), { key: "Enter" });
    await waitFor(() => expect(posts).toHaveLength(1));
  });

  it("Commentaire absent quand compte_rendu n'est pas raccordé", () => {
    setup({ canNote: false });
    openForm();
    expect(screen.queryByLabelText("Commentaire")).toBeNull();
  });

  it("Escape annule sans remonter (la fiche reste ouverte)", () => {
    const { onOuterKey } = setup();
    openForm();
    fireEvent.keyDown(screen.getByLabelText("Intitulé de l'interaction"), { key: "Escape" });
    expect(screen.queryByTestId("fiche-interaction-form")).toBeNull();
    expect(onOuterKey).not.toHaveBeenCalled();
  });

  it("échec : toast d'erreur avec Réessayer, formulaire conservé, Réessayer renvoie", async () => {
    postOk = false;
    const { onCreated } = setup();
    openForm();
    fireEvent.change(screen.getByLabelText("Type d'interaction"), { target: { value: "Appel" } });
    fireEvent.click(screen.getByRole("button", { name: "Enregistrer" }));
    await waitFor(() => expect(toastApi.error).toHaveBeenCalledTimes(1));
    const opts = toastApi.error.mock.calls[0][1] as { action: { label: string; onClick: () => void } };
    expect(opts.action.label).toBe("Réessayer");
    expect(screen.getByTestId("fiche-interaction-form")).toBeTruthy();
    expect(onCreated).not.toHaveBeenCalled();
    postOk = true;
    opts.action.onClick();
    await waitFor(() => expect(posts).toHaveLength(2));
    expect(posts[1].body).toEqual(posts[0].body);
    await waitFor(() => expect(onCreated).toHaveBeenCalledTimes(1));
  });

  it("raccordement incomplet (éditeur) : la raison n'est pas Lecture seule", async () => {
    setup({ canLog: false, canEditInteractions: true });
    const add = screen.getByRole("button", { name: /Ajouter une interaction au dossier/ });
    expect(add.getAttribute("aria-disabled")).toBe("true");
    fireEvent.focus(add);
    expect(await screen.findByText(fr.crm.fiche.interactions.addUnavailable)).toBeTruthy();
    expect(screen.queryByText(fr.crm.fiche.interactions.addReadOnly)).toBeNull();
  });

  it("lecteur : la raison est Lecture seule", async () => {
    setup({ canLog: false, canEditInteractions: false });
    fireEvent.focus(screen.getByRole("button", { name: /Ajouter une interaction au dossier/ }));
    expect(await screen.findByText(fr.crm.fiche.interactions.addReadOnly)).toBeTruthy();
  });

  it("le focus revient sur Ajouter après Échap et après Annuler", () => {
    setup();
    for (const close of [
      () => fireEvent.keyDown(screen.getByLabelText("Intitulé de l'interaction"), { key: "Escape" }),
      () => fireEvent.click(screen.getByRole("button", { name: "Annuler" })),
    ]) {
      openForm();
      close();
      expect(document.activeElement).toBe(screen.getByRole("button", { name: /Ajouter une interaction au dossier/ }));
    }
  });

  it("Entrée pendant une composition IME n'envoie pas", () => {
    setup();
    openForm();
    fireEvent.change(screen.getByLabelText("Type d'interaction"), { target: { value: "Mail" } });
    fireEvent.keyDown(screen.getByLabelText("Intitulé de l'interaction"), { key: "Enter", isComposing: true });
    expect(posts).toHaveLength(0);
  });

  it("canLog faux : Ajouter désactivé avec raison, formulaire absent", () => {
    setup({ canLog: false });
    const add = screen.getByRole("button", { name: /Ajouter une interaction au dossier/ });
    expect(add.getAttribute("aria-disabled")).toBe("true");
    fireEvent.click(add);
    expect(screen.queryByTestId("fiche-interaction-form")).toBeNull();
  });
});
