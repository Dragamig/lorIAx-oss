import { describe, expect, it } from "vitest";
import { normalizeRerankSettings } from "./rerank-settings";

describe("normalizeRerankSettings", () => {
  it("rend tout eteint quand le reglage est absent", () => {
    expect(normalizeRerankSettings(undefined)).toEqual({
      enabled: false,
      chat: false,
      help: false,
      search: false,
    });
  });

  it("rend tout eteint quand le reglage n'est pas un objet", () => {
    expect(normalizeRerankSettings("oui")).toEqual({
      enabled: false,
      chat: false,
      help: false,
      search: false,
    });
  });

  it("lit les quatre booleens", () => {
    expect(
      normalizeRerankSettings({
        enabled: true,
        chat: true,
        help: false,
        search: true,
      })
    ).toEqual({ enabled: true, chat: true, help: false, search: true });
  });

  it("traite les champs manquants comme eteints", () => {
    expect(normalizeRerankSettings({ enabled: true })).toEqual({
      enabled: true,
      chat: false,
      help: false,
      search: false,
    });
  });

  it("ignore les valeurs non booleennes", () => {
    expect(
      normalizeRerankSettings({ enabled: "1", chat: 1, help: null, search: [] })
    ).toEqual({ enabled: false, chat: false, help: false, search: false });
  });
});
