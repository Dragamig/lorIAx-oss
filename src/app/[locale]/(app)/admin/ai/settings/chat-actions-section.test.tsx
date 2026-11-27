// @vitest-environment jsdom
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { cleanup, fireEvent, render, screen } from "@testing-library/react";

const toastApi = vi.hoisted(() => ({ success: vi.fn(), error: vi.fn(), warning: vi.fn() }));
vi.mock("sonner", () => ({ toast: toastApi }));

import { NextIntlClientProvider } from "next-intl";
import fr from "../../../../../../../messages/fr.json";
import { ALL_ON_CHAT_ACTIONS, type ChatActionsSettings } from "@/lib/ai/chat-actions-settings";
import { ChatActionsSection, toggleChatAction } from "./chat-actions-section";

const OFF_WRITES = { proposeUpdates: false, proposeDeletes: false, proposeMerges: false, proposeCreates: false, proposeSpreadsheets: false, proposeDocuments: false, proposePresentations: false };
const ids = ["readDatabases", "proposeUpdates", "proposeDeletes", "proposeMerges", "proposeCreates"] as const;
const sw = (k: string) => screen.getByTestId(`chat-actions-${k}`) as HTMLButtonElement;

function renderReady(value: ChatActionsSettings) {
  const onChange = vi.fn();
  render(
    <NextIntlClientProvider locale="fr" messages={fr}>
      <ChatActionsSection status="ready" value={value} onChange={onChange} />
    </NextIntlClientProvider>,
  );
  return onChange;
}

beforeEach(() => {
  toastApi.success.mockReset();
});
afterEach(cleanup);

describe("section Actions de l'assistant IA, états", () => {
  it("tout activé : maître actif, 5 interrupteurs actifs, badge Actions activées, 5 puces", () => {
    renderReady(ALL_ON_CHAT_ACTIONS);
    expect(screen.getByTestId("chat-actions-master").getAttribute("aria-checked")).toBe("true");
    expect(screen.getByTestId("chat-actions-state").textContent).toBe("Activé");
    for (const k of ids) {
      expect(sw(k).getAttribute("aria-checked")).toBe("true");
      expect(sw(k).disabled).toBe(false);
    }
    expect(screen.getByTestId("chat-actions-badge").textContent).toBe("Actions activées");
    expect(screen.getByTestId("chat-actions-chips").children).toHaveLength(5);
  });

  it("maître éteint : sous-options désactivées et décochées, badge FAQ, puces Documents et Aide", () => {
    renderReady({ ...ALL_ON_CHAT_ACTIONS, actionsEnabled: false });
    expect(screen.getByTestId("chat-actions-state").textContent).toBe("Désactivé");
    for (const k of ids) {
      expect(sw(k).disabled).toBe(true);
      expect(sw(k).getAttribute("aria-checked")).toBe("false");
      expect(sw(k).getAttribute("aria-label")).toBe("Activez d'abord les actions de l'assistant IA.");
    }
    expect(screen.getByTestId("chat-actions-badge").textContent).toBe("FAQ");
    expect(screen.getByTestId("chat-actions-preview").textContent).toMatch(/Aucun outil de base de données/);
    expect(screen.getByTestId("chat-actions-chips").textContent).toBe("DocumentsAide");
  });

  it("lecture seule : badge Lecture seule, une seule puce", () => {
    renderReady({ ...ALL_ON_CHAT_ACTIONS, ...OFF_WRITES });
    expect(screen.getByTestId("chat-actions-badge").textContent).toBe("Lecture seule");
    expect(screen.getByTestId("chat-actions-chips").textContent).toBe("Lecture");
  });

  it("lecture éteinte : les 4 propositions sont désactivées avec la raison affichée, aucun outil actif", () => {
    renderReady({ ...ALL_ON_CHAT_ACTIONS, readDatabases: false });
    expect(sw("readDatabases").disabled).toBe(false);
    for (const k of ["proposeUpdates", "proposeDeletes", "proposeMerges", "proposeCreates"]) {
      expect(sw(k).disabled).toBe(true);
      expect(sw(k).getAttribute("aria-checked")).toBe("false");
      expect(screen.getByTestId(`chat-actions-why-${k}`).textContent).toBe("Nécessite « Lire les bases », désactivé.");
    }
    expect(screen.getByTestId("chat-actions-badge").textContent).toBe("Aucun outil actif");
    expect(screen.getByTestId("chat-actions-preview").textContent).toBe("Aucun outil actif.");
  });

  it("l'info-bulle d'un interrupteur désactivé explique pourquoi (survol)", () => {
    renderReady({ ...ALL_ON_CHAT_ACTIONS, readDatabases: false });
    const wrapper = sw("proposeDeletes").parentElement as HTMLElement;
    fireEvent.mouseEnter(wrapper);
    expect(screen.getByRole("tooltip").textContent).toBe("Nécessite « Lire les bases », désactivé.");
  });

  it("état d'erreur : alerte, aucun interrupteur, bouton Réessayer branché", () => {
    const onRetry = vi.fn();
    render(
      <NextIntlClientProvider locale="fr" messages={fr}>
        <ChatActionsSection status="error" message="Lecture impossible" onRetry={onRetry} />
      </NextIntlClientProvider>,
    );
    expect(screen.getByRole("alert").textContent).toMatch(/Lecture impossible/);
    expect(screen.queryByTestId("chat-actions-master")).toBeNull();
    fireEvent.click(screen.getByRole("button", { name: "Réessayer le chargement" }));
    expect(onRetry).toHaveBeenCalledTimes(1);
  });
});

describe("section Actions de l'assistant IA, interactions", () => {
  it("bascule d'une sous-option : onChange + toast avec Annuler qui rétablit l'ancien état", () => {
    const onChange = renderReady(ALL_ON_CHAT_ACTIONS);
    fireEvent.click(sw("proposeDeletes"));
    expect(onChange).toHaveBeenCalledWith({ ...ALL_ON_CHAT_ACTIONS, proposeDeletes: false });
    const [message, opts] = toastApi.success.mock.calls[0];
    expect(message).toBe("Proposer des suppressions désactivé");
    expect(opts.action.label).toBe("Annuler");
    onChange.mockClear();
    opts.action.onClick();
    expect(onChange).toHaveBeenCalledWith(ALL_ON_CHAT_ACTIONS);
  });

  it("un interrupteur désactivé ne déclenche rien", () => {
    const onChange = renderReady({ ...ALL_ON_CHAT_ACTIONS, actionsEnabled: false });
    fireEvent.click(sw("proposeUpdates"));
    expect(onChange).not.toHaveBeenCalled();
    expect(toastApi.success).not.toHaveBeenCalled();
  });
});

describe("toggleChatAction", () => {
  it("couper la lecture annonce les actions suspendues", () => {
    const { next, message } = toggleChatAction(ALL_ON_CHAT_ACTIONS, "readDatabases");
    expect(next.readDatabases).toBe(false);
    expect(message).toBe("Lire les bases désactivé, 4 autres actions suspendues");
  });

  it("activer le maître sans aucune sous-option active la lecture", () => {
    const { next, message } = toggleChatAction(
      { actionsEnabled: false, readDatabases: false, ...OFF_WRITES },
      "actionsEnabled",
    );
    expect(next.actionsEnabled).toBe(true);
    expect(next.readDatabases).toBe(true);
    expect(message).toBe("Actions de l'assistant IA activé, lecture activée");
  });

  it("activer le maître conserve les sous-options déjà réglées", () => {
    const { next } = toggleChatAction({ ...ALL_ON_CHAT_ACTIONS, actionsEnabled: false, proposeDeletes: false }, "actionsEnabled");
    expect(next).toEqual({ ...ALL_ON_CHAT_ACTIONS, proposeDeletes: false });
  });
});

describe("liste Création de fichiers", () => {
  const files = ["proposeSpreadsheets", "proposeDocuments", "proposePresentations"] as const;

  it("maître éteint : les trois interrupteurs sont désactivés avec info-bulle explicative", () => {
    renderReady({ ...ALL_ON_CHAT_ACTIONS, actionsEnabled: false });
    for (const k of files) {
      expect(sw(k).disabled).toBe(true);
      expect(sw(k).getAttribute("aria-label")).toBe("Activez d'abord les actions de l'assistant IA.");
    }
    fireEvent.mouseEnter(sw("proposeDocuments").parentElement as HTMLElement);
    expect(screen.getByRole("tooltip").textContent).toBe("Activez d'abord les actions de l'assistant IA.");
  });

  it("indépendants de la lecture des bases", () => {
    renderReady({ ...ALL_ON_CHAT_ACTIONS, readDatabases: false });
    for (const k of files) {
      expect(sw(k).disabled).toBe(false);
      expect(sw(k).getAttribute("aria-checked")).toBe("true");
    }
  });

  it("présentation : affiche la dépendance au module Présentations", () => {
    renderReady(ALL_ON_CHAT_ACTIONS);
    expect(screen.getByTestId("chat-actions-dep-proposePresentations").textContent).toMatch(/module Présentations/);
  });

  it("un clic bascule l'interrupteur et propose Annuler", () => {
    const onChange = renderReady({ ...ALL_ON_CHAT_ACTIONS, proposeDocuments: false });
    fireEvent.click(sw("proposeDocuments"));
    expect(onChange).toHaveBeenCalledWith(expect.objectContaining({ proposeDocuments: true }));
    expect(toastApi.success.mock.calls[0][1].action.label).toBe("Annuler");
  });
});
