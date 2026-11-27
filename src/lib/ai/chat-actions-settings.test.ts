import { describe, it, expect, vi, beforeEach } from "vitest";

const store = vi.hoisted(() => ({ get: vi.fn(), set: vi.fn() }));
vi.mock("@/lib/settings/system-settings", () => ({
  getSetting: (...a: unknown[]) => store.get(...a),
  setSetting: (...a: unknown[]) => store.set(...a),
}));

import {
  DEFAULT_CHAT_ACTIONS,
  ALL_OFF_CHAT_ACTIONS,
  chatActionsKey,
  getChatActionsSettings,
  isProposalTypeAllowed,
  normalizeChatActionsSettings,
  parseChatActionsSettings,
  getStoredChatActionsSettings,
  resolveEffectiveChatActions,
  saveChatActionsSettings,
} from "./chat-actions-settings";

beforeEach(() => {
  store.get.mockReset();
  store.set.mockReset();
});

describe("normalisation du réglage des actions du chat", () => {
  it("défauts : maître, lecture, modification et création activés ; suppression et fusion éteintes", () => {
    expect(DEFAULT_CHAT_ACTIONS).toEqual({
      actionsEnabled: true,
      readDatabases: true,
      proposeUpdates: true,
      proposeDeletes: false,
      proposeMerges: false,
      proposeCreates: true,
      proposeSpreadsheets: true,
      proposeDocuments: true,
      proposePresentations: false,
    });
  });

  it("réglage ancien sans les champs de création : reprend leurs défauts", () => {
    const s = normalizeChatActionsSettings({
      actionsEnabled: true,
      readDatabases: true,
      proposeUpdates: false,
      proposeDeletes: true,
      proposeMerges: true,
      proposeCreates: false,
    });
    expect(s.proposeSpreadsheets).toBe(true);
    expect(s.proposeDocuments).toBe(true);
    expect(s.proposePresentations).toBe(false);
  });

  it("maître éteint : les trois interrupteurs de création sont éteints (fail-closed)", () => {
    const s = normalizeChatActionsSettings({ actionsEnabled: false, proposeSpreadsheets: true, proposePresentations: true });
    expect(s.proposeSpreadsheets).toBe(false);
    expect(s.proposeDocuments).toBe(false);
    expect(s.proposePresentations).toBe(false);
  });

  it("les interrupteurs de création ne dépendent pas de readDatabases", () => {
    const s = normalizeChatActionsSettings({ readDatabases: false, proposePresentations: true });
    expect(s.proposeSpreadsheets).toBe(true);
    expect(s.proposeDocuments).toBe(true);
    expect(s.proposePresentations).toBe(true);
    expect(s.proposeCreates).toBe(false);
  });

  it("rend les défauts prudents (suppression et fusion éteintes) pour une valeur absente ou non objet", () => {
    for (const raw of [null, undefined, "x", 3, [], true]) {
      expect(normalizeChatActionsSettings(raw)).toEqual(DEFAULT_CHAT_ACTIONS);
    }
  });

  it("garde les champs booléens et ignore les autres", () => {
    const s = normalizeChatActionsSettings({ proposeDeletes: true, proposeMerges: "oui", extra: 1 });
    expect(s.proposeDeletes).toBe(true);
    expect(s.proposeMerges).toBe(false);
    expect(s).not.toHaveProperty("extra");
  });

  it("maître éteint : tout éteint", () => {
    expect(normalizeChatActionsSettings({ actionsEnabled: false })).toEqual(ALL_OFF_CHAT_ACTIONS);
  });

  it("lecture éteinte : aucune proposition, maître conservé", () => {
    const s = normalizeChatActionsSettings({ readDatabases: false });
    expect(s).toEqual({
      ...ALL_OFF_CHAT_ACTIONS,
      actionsEnabled: true,
      proposeSpreadsheets: true,
      proposeDocuments: true,
    });
  });

  it("resolveEffective ne modifie pas son entrée", () => {
    const input = { ...DEFAULT_CHAT_ACTIONS, actionsEnabled: false };
    resolveEffectiveChatActions(input);
    expect(input.readDatabases).toBe(true);
  });
});

describe("valeur stockée pour l'écran", () => {
  it("conserve les sous-options quand le maître est éteint", () => {
    expect(parseChatActionsSettings({ actionsEnabled: false, proposeDeletes: false })).toEqual({
      ...DEFAULT_CHAT_ACTIONS,
      actionsEnabled: false,
      proposeDeletes: false,
    });
  });

  it("lit la clé de l'organisation sans appliquer les dépendances", async () => {
    store.get.mockResolvedValue({ actionsEnabled: false });
    expect(await getStoredChatActionsSettings("org-9")).toEqual({ ...DEFAULT_CHAT_ACTIONS, actionsEnabled: false });
    expect(store.get).toHaveBeenCalledWith("chat_actions:org-9");
  });
});

describe("lecture et écriture par organisation", () => {
  it("lit la clé propre à l'organisation", async () => {
    store.get.mockResolvedValue(null);
    expect(await getChatActionsSettings("org-1")).toEqual(DEFAULT_CHAT_ACTIONS);
    expect(store.get).toHaveBeenCalledWith("chat_actions:org-1");
    expect(chatActionsKey("org-2")).toBe("chat_actions:org-2");
  });

  it("erreur de lecture : tout éteint (fail-closed)", async () => {
    store.get.mockRejectedValue(new Error("db"));
    expect(await getChatActionsSettings("org-1")).toEqual(ALL_OFF_CHAT_ACTIONS);
  });

  it("écrit les choix tels quels (sous-options conservées) sous la clé de l'organisation", async () => {
    await saveChatActionsSettings("org-1", { ...DEFAULT_CHAT_ACTIONS, readDatabases: false });
    expect(store.set).toHaveBeenCalledWith("chat_actions:org-1", { ...DEFAULT_CHAT_ACTIONS, readDatabases: false });
  });

  it("autorise un type de proposition selon son interrupteur", async () => {
    store.get.mockResolvedValue({ proposeDeletes: true, proposeUpdates: false });
    expect(await isProposalTypeAllowed("o", "delete_rows")).toBe(true);
    expect(await isProposalTypeAllowed("o", "update_rows")).toBe(false);
    expect(await isProposalTypeAllowed("o", "merge_duplicates")).toBe(false);
    expect(await isProposalTypeAllowed("o", "create_rows")).toBe(true);
  });
});
