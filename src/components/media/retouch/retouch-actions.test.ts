import { describe, expect, it } from "vitest";
import { LIBRARY_ACTIONS } from "@/lib/media/actions";
import { RETOUCH_TOOLS, actionForKey, retouchEntryReason, type RetouchActionMap } from "./retouch-actions";

const run = () => {};
const all: RetouchActionMap = Object.fromEntries(
  Object.values(LIBRARY_ACTIONS)
    .filter((a) => a.group === "retouch")
    .map((a) => [a.id, { run }]),
);
const key = (k: string, o: Partial<KeyboardEvent> = {}) => ({ key: k, shiftKey: false, ctrlKey: false, metaKey: false, altKey: false, ...o });

describe("actionForKey", () => {
  it("chaque outil répond à la touche déclarée au registre (C, P, S, A, F, D)", () => {
    for (const { action } of RETOUCH_TOOLS) {
      const shortcut = LIBRARY_ACTIONS[action].shortcut!;
      expect(actionForKey(key(shortcut.toLowerCase()), all)).toBe(action);
    }
    expect(RETOUCH_TOOLS.slice(0, 6).map((x) => LIBRARY_ACTIONS[x.action].shortcut)).toEqual(["C", "P", "S", "A", "F", "D"]);
  });
  it("pivot : R, Maj+R, Maj+H, Maj+V", () => {
    expect(actionForKey(key("r"), all)).toBe("rotateRight");
    expect(actionForKey(key("R", { shiftKey: true }), all)).toBe("rotateLeft");
    expect(actionForKey(key("H", { shiftKey: true }), all)).toBe("flipH");
    expect(actionForKey(key("V", { shiftKey: true }), all)).toBe("flipV");
  });
  it("Ctrl+Z annule, Ctrl+Maj+Z et Ctrl+Y rétablissent, antislash compare", () => {
    expect(actionForKey(key("z", { ctrlKey: true }), all)).toBe("retouchUndo");
    expect(actionForKey(key("Z", { ctrlKey: true, shiftKey: true }), all)).toBe("retouchRedo");
    expect(actionForKey(key("y", { ctrlKey: true }), all)).toBe("retouchRedo");
    expect(actionForKey(key("\\"), all)).toBe("compareBefore");
    expect(actionForKey(key("s", { ctrlKey: true }), all)).toBe("saveRetouch");
  });
  it("ignore Entrée, Échap, Suppr (panneaux) et Alt, et une lettre avec Ctrl sans action", () => {
    expect(actionForKey(key("Enter"), all)).toBeNull();
    expect(actionForKey(key("Escape"), all)).toBeNull();
    expect(actionForKey(key("Delete"), all)).toBeNull();
    expect(actionForKey(key("c", { altKey: true }), all)).toBeNull();
    expect(actionForKey(key("c", { ctrlKey: true }), all)).toBeNull();
  });
  it("une action absente de la table n'est pas déclenchée", () => {
    expect(actionForKey(key("c"), {})).toBeNull();
  });
});

describe("retouchEntryReason", () => {
  const ok = { canWriteSpace: true, canWriteOriginal: false };
  it("image : disponible", () => expect(retouchEntryReason({ kind: "image", mimeType: "image/png" }, ok)).toBeNull());
  it("SVG et non-image refusés", () => {
    expect(retouchEntryReason({ kind: "image", mimeType: "image/svg+xml" }, ok)).toBe("svg");
    expect(retouchEntryReason({ kind: "video", mimeType: "video/mp4" }, ok)).toBe("notImage");
  });
  it("droit manquant : ni copie ni écriture sur l'original", () => {
    expect(retouchEntryReason({ kind: "image", mimeType: "image/png" }, { canWriteSpace: false, canWriteOriginal: false })).toBe("noRight");
    expect(retouchEntryReason({ kind: "image", mimeType: "image/png" }, { canWriteSpace: false, canWriteOriginal: true })).toBeNull();
  });
});
