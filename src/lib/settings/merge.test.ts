import { describe, it, expect } from "vitest";
import {
  isPlainObject,
  mergeDepthForKey,
  mergeSettingValue,
} from "./merge";

describe("isPlainObject", () => {
  it("distingue objet simple, tableau, null et scalaire", () => {
    expect(isPlainObject({ a: 1 })).toBe(true);
    expect(isPlainObject([])).toBe(false);
    expect(isPlainObject(null)).toBe(false);
    expect(isPlainObject("x")).toBe(false);
    expect(isPlainObject(undefined)).toBe(false);
  });
});

describe("mergeSettingValue", () => {
  it("conserve les clés absentes du corps reçu", () => {
    const merged = mergeSettingValue(
      { canCreateSpaces: true, canInviteMembers: false },
      { canCreateSpaces: false }
    );
    expect(merged).toEqual({ canCreateSpaces: false, canInviteMembers: false });
  });

  it("écrase les clés présentes", () => {
    expect(mergeSettingValue({ a: 1, b: 2 }, { a: 9 })).toEqual({ a: 9, b: 2 });
  });

  it("supprime un champ reçu à null", () => {
    expect(mergeSettingValue({ a: 1, b: 2 }, { b: null })).toEqual({ a: 1 });
  });

  it("ne fusionne pas en profondeur : une valeur imbriquée est remplacée en bloc", () => {
    const merged = mergeSettingValue(
      { editor: { canCreateSpaces: true, canInviteMembers: true }, viewer: { canRead: true } },
      { editor: { canCreateSpaces: true } }
    );
    // Le retrait de canInviteMembers doit passer : pas de résurrection depuis la base.
    expect(merged).toEqual({
      editor: { canCreateSpaces: true },
      viewer: { canRead: true },
    });
  });

  it("remplace intégralement quand la valeur reçue n'est pas un objet simple", () => {
    expect(mergeSettingValue({ a: 1 }, true)).toBe(true);
    expect(mergeSettingValue({ a: 1 }, "texte")).toBe("texte");
    expect(mergeSettingValue({ a: 1 }, null)).toBe(null);
  });

  it("remplace intégralement quand la valeur en base n'est pas un objet simple", () => {
    expect(mergeSettingValue(true, { enabled: false })).toEqual({ enabled: false });
    expect(mergeSettingValue(null, { a: 1 })).toEqual({ a: 1 });
    expect(mergeSettingValue(undefined, { a: 1 })).toEqual({ a: 1 });
  });

  it("traite les tableaux comme des valeurs atomiques, des deux côtés", () => {
    expect(mergeSettingValue(["a", "b"], ["c"])).toEqual(["c"]);
    expect(mergeSettingValue({ roles: ["a", "b"] }, { roles: ["c"] })).toEqual({ roles: ["c"] });
    expect(mergeSettingValue({ a: 1 }, ["c"])).toEqual(["c"]);
  });

  it("ne mute pas la valeur déjà en base", () => {
    const existing = { a: 1, b: 2 };
    mergeSettingValue(existing, { a: 9, b: null });
    expect(existing).toEqual({ a: 1, b: 2 });
  });
});

describe("fusion de niveau 2 (rolePermissions)", () => {
  it("rolePermissions est la seule clé fusionnée en profondeur", () => {
    expect(mergeDepthForKey("rolePermissions")).toBe(2);
    expect(mergeDepthForKey("whisper")).toBe(1);
    expect(mergeDepthForKey("ai_global")).toBe(1);
  });

  // Régression : /admin/system gère canCreateSpaces & co, /admin/ai/settings
  // gère canUseAI & co, sur les MEMES rôles et la MEME ligne system_settings.
  // Au niveau 1, enregistrer l'un remplaçait l'objet du rôle en bloc et
  // effaçait les permissions de l'autre écran.
  it("chaque écran n'écrit que ses propres permissions", () => {
    const enBase = {
      viewer: { canCreateSpaces: false, canUseAI: true },
      editor: { canCreateSpaces: true, canUseAI: true },
    };
    const depuisAdminSysteme = {
      viewer: { canCreateSpaces: true },
      editor: { canCreateSpaces: false },
    };

    expect(mergeSettingValue(enBase, depuisAdminSysteme, 2)).toEqual({
      viewer: { canCreateSpaces: true, canUseAI: true },
      editor: { canCreateSpaces: false, canUseAI: true },
    });

    // Au niveau 1, les permissions IA disparaissaient.
    expect(mergeSettingValue(enBase, depuisAdminSysteme, 1)).toEqual({
      viewer: { canCreateSpaces: true },
      editor: { canCreateSpaces: false },
    });
  });

  it("un rôle entier reste supprimable par null, même au niveau 2", () => {
    expect(
      mergeSettingValue({ viewer: { a: true }, editor: { a: true } }, { viewer: null }, 2)
    ).toEqual({ editor: { a: true } });
  });

  it("une permission reste retirable en la passant à null", () => {
    expect(
      mergeSettingValue({ viewer: { canUseAI: true, canViewLogs: true } }, { viewer: { canViewLogs: null } }, 2)
    ).toEqual({ viewer: { canUseAI: true } });
  });

  it("ne descend jamais au delà du niveau 2", () => {
    const existing = { viewer: { quotas: { chat: 10, images: 5 } } };
    expect(mergeSettingValue(existing, { viewer: { quotas: { chat: 99 } } }, 2)).toEqual({
      viewer: { quotas: { chat: 99 } },
    });
  });
});
