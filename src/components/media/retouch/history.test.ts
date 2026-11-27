import { describe, it, expect } from "vitest";
import { createHistory } from "./history";

describe("createHistory", () => {
  it("push, undo, redo", () => {
    const h = createHistory(0);
    expect(h.canUndo).toBe(false);
    h.push(1);
    h.push(2);
    expect(h.present).toBe(2);
    expect(h.undo()).toBe(1);
    expect(h.canRedo).toBe(true);
    expect(h.redo()).toBe(2);
    expect(h.canRedo).toBe(false);
  });
  it("undo à vide et redo à vide ne font rien", () => {
    const h = createHistory("a");
    expect(h.undo()).toBe("a");
    expect(h.redo()).toBe("a");
  });
  it("un push après undo coupe la branche rétablissable", () => {
    const h = createHistory(0);
    h.push(1);
    h.push(2);
    h.undo();
    h.push(9);
    expect(h.canRedo).toBe(false);
    expect(h.undo()).toBe(1);
  });
  it("50 états au plus : le plus ancien est supprimé", () => {
    const h = createHistory(0);
    for (let i = 1; i <= 60; i++) h.push(i);
    let steps = 0;
    while (h.canUndo) {
      h.undo();
      steps++;
    }
    expect(steps).toBe(49);
    expect(h.present).toBe(11);
  });
  it("même curseur dans les 500 ms : une seule entrée", () => {
    let t = 1000;
    const h = createHistory(0, () => t);
    h.push(1, "brightness");
    t += 100;
    h.push(2, "brightness");
    t += 100;
    h.push(3, "brightness");
    expect(h.present).toBe(3);
    expect(h.undo()).toBe(0);
    expect(h.canUndo).toBe(false);
  });
  it("même curseur après 500 ms, ou autre curseur : entrées séparées", () => {
    let t = 1000;
    const h = createHistory(0, () => t);
    h.push(1, "brightness");
    t += 600;
    h.push(2, "brightness");
    t += 10;
    h.push(3, "contrast");
    expect(h.undo()).toBe(2);
    expect(h.undo()).toBe(1);
    expect(h.undo()).toBe(0);
  });
  it("annuler interrompt la fusion", () => {
    const t = 0;
    const h = createHistory(0, () => t);
    h.push(1, "k");
    h.push(2, "k");
    h.undo();
    h.push(5, "k");
    expect(h.undo()).toBe(0);
  });
  it("50 étapes mélangées : annuler tout puis rétablir tout redonne l'état final", () => {
    const h = createHistory<number[]>([]);
    for (let i = 0; i < 49; i++) h.push([...h.present, i]);
    const final = h.present;
    while (h.canUndo) h.undo();
    expect(h.present).toEqual([]);
    while (h.canRedo) h.redo();
    expect(h.present).toEqual(final);
  });
});
