import { describe, it, expect } from "vitest";
import {
  groupRowsIntoLanes,
  resolveGroupColumn,
  valueForMove,
  cellsForNewCard,
  groupableColumns,
} from "@/lib/bases/kanban";

const status = {
  id: "s",
  name: "Statut",
  type: "select",
  config: { options: ["Nouveau", { label: "En cours", color: "x" }, "Gagné"] },
};
const tags = { id: "t", name: "Tags", type: "select", config: { options: ["a", "b"], multiple: true } };
const text = { id: "x", name: "Nom", type: "text", config: {} };

describe("resolveGroupColumn", () => {
  it("lit la colonne dans la config de la vue", () => {
    expect(resolveGroupColumn([text, status], { groupByColumnId: "s" })).toBe(status);
  });
  it("retourne null sans config, id inconnu ou colonne non select", () => {
    expect(resolveGroupColumn([text, status], {})).toBeNull();
    expect(resolveGroupColumn([text, status], { groupByColumnId: "zz" })).toBeNull();
    expect(resolveGroupColumn([text, status], { groupByColumnId: "x" })).toBeNull();
  });
  it("groupableColumns ne garde que les select", () => {
    expect(groupableColumns([text, status])).toEqual([status]);
  });
});

describe("groupRowsIntoLanes", () => {
  it("crée une voie par option (objets normalisés) et une voie vide finale", () => {
    const lanes = groupRowsIntoLanes(status, [
      { id: "1", cells: { s: "Nouveau" } },
      { id: "2", cells: { s: "En cours" } },
      { id: "3", cells: {} },
      { id: "4", cells: { s: "Inconnu" } },
    ]);
    expect(lanes.map((l) => l.key)).toEqual(["Nouveau", "En cours", "Gagné", "Inconnu", ""]);
    expect(lanes.find((l) => l.key === "Nouveau")!.rows.map((r) => r.id)).toEqual(["1"]);
    expect(lanes.find((l) => l.key === "")!.rows.map((r) => r.id)).toEqual(["3"]);
    expect(lanes.find((l) => l.key === "Inconnu")!.rows.map((r) => r.id)).toEqual(["4"]);
  });
  it("multi-select : une ligne dans chaque voie concernée", () => {
    const lanes = groupRowsIntoLanes(tags, [{ id: "1", cells: { t: ["a", "b"] } }]);
    expect(lanes.filter((l) => l.rows.length).map((l) => l.key)).toEqual(["a", "b"]);
  });
});

describe("valueForMove", () => {
  it("select simple : valeur cible, null vers « sans valeur », undefined si inchangé", () => {
    expect(valueForMove(status, "Nouveau", "Nouveau", "Gagné")).toBe("Gagné");
    expect(valueForMove(status, "Nouveau", "Nouveau", "")).toBeNull();
    expect(valueForMove(status, "Nouveau", "Nouveau", "Nouveau")).toBeUndefined();
  });
  it("multi-select : retire la voie source, ajoute la cible", () => {
    expect(valueForMove(tags, ["a", "b"], "a", "")).toEqual(["b"]);
    expect(valueForMove(tags, ["a"], "a", "b")).toEqual(["b"]);
    expect(valueForMove(tags, ["a", "b"], "a", "b")).toEqual(["b"]);
  });
});

describe("cellsForNewCard", () => {
  it("préremplit la colonne de regroupement", () => {
    expect(cellsForNewCard(status, "Gagné")).toEqual({ s: "Gagné" });
    expect(cellsForNewCard(tags, "a")).toEqual({ t: ["a"] });
    expect(cellsForNewCard(status, "")).toEqual({});
  });
});
