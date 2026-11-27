import { describe, expect, it } from "vitest";
import { moveItem } from "@/lib/dashboards/widget-order";
import { classifyDashboardApiFailure } from "@/lib/dashboards/api-error";

describe("moveItem", () => {
  it("déplace avant et après", () => {
    expect(moveItem(["a", "b", "c"], 1, -1)).toEqual(["b", "a", "c"]);
    expect(moveItem(["a", "b", "c"], 1, 1)).toEqual(["a", "c", "b"]);
  });
  it("rend null hors bornes, sans muter l'entrée", () => {
    const list = ["a", "b"];
    expect(moveItem(list, 0, -1)).toBeNull();
    expect(moveItem(list, 1, 1)).toBeNull();
    expect(moveItem(list, 5, -1)).toBeNull();
    expect(moveItem(list, 0, 0)).toBeNull();
    expect(list).toEqual(["a", "b"]);
  });
});

describe("classifyDashboardApiFailure", () => {
  it("traduit les refus par statut", () => {
    expect(classifyDashboardApiFailure(401, null)).toEqual({ kind: "unauthenticated" });
    expect(classifyDashboardApiFailure(403, { error: "Accès refusé" })).toEqual({ kind: "forbidden" });
    expect(classifyDashboardApiFailure(404, { error: "Introuvable" })).toEqual({ kind: "notFound" });
  });
  it("remonte le message de validation d'un 400", () => {
    expect(classifyDashboardApiFailure(400, { error: "Filtre invalide" })).toEqual({
      kind: "message",
      message: "Filtre invalide",
    });
  });
  it("retombe sur le générique sans message exploitable", () => {
    expect(classifyDashboardApiFailure(400, { error: "" })).toEqual({ kind: "generic" });
    expect(classifyDashboardApiFailure(500, { error: "Erreur accès bases" })).toEqual({ kind: "generic" });
    expect(classifyDashboardApiFailure(502, "html")).toEqual({ kind: "generic" });
  });
});
