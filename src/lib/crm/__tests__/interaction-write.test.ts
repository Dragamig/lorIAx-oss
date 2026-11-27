import { describe, it, expect } from "vitest";
import { normalizeAttachments } from "@/lib/media/cell-values";
import type { CrmContext } from "../context";
import { buildInteractionCells, interactionBody } from "../interaction-write";

const COLS: Record<string, string> = {
  date: "c-date",
  type: "c-type",
  dossier: "c-dossier",
  intitule: "c-intitule",
  compte_rendu: "c-cr",
};

function fakeCtx(without: string[] = []): CrmContext {
  return {
    fieldColumn: (role: string, key: string) => (role === "interactions" && COLS[key] && !without.includes(key) ? COLS[key] : null),
  } as unknown as CrmContext;
}

describe("interactionBody", () => {
  it("accepte un corps minimal", () => {
    expect(interactionBody.safeParse({ type: "Appel" }).success).toBe(true);
  });
  it("refuse une clé inconnue, un type vide, un titre ou une note trop longs", () => {
    expect(interactionBody.safeParse({ type: "Appel", x: 1 }).success).toBe(false);
    expect(interactionBody.safeParse({ type: "" }).success).toBe(false);
    expect(interactionBody.safeParse({ type: "Appel", title: "a".repeat(201) }).success).toBe(false);
    expect(interactionBody.safeParse({ type: "Appel", note: "a".repeat(5001) }).success).toBe(false);
  });
  it("refuse les pièces : format {kind,id,name} non résolvable en Bases", () => {
    const att = [{ kind: "document", id: "d1", name: "Devis" }];
    expect(interactionBody.safeParse({ type: "Appel", attachments: att }).success).toBe(false);
    // Preuve du verdict F8 : la cellule serait un hérité sans clé, donc non affichable.
    const n = normalizeAttachments(att);
    expect(n.items[0]).toMatchObject({ kind: "legacy", resolvable: false });
  });
});

describe("buildInteractionCells", () => {
  it("écrit date, type, relation, titre et note", () => {
    const cells = buildInteractionCells(
      fakeCtx(),
      "deal-1",
      { type: "Appel", title: "Premier appel", date: "2026-11-10", note: "RAS" },
      "2026-11-18",
    );
    expect(cells).toEqual({
      "c-date": "2026-11-10",
      "c-type": "Appel",
      "c-dossier": ["deal-1"],
      "c-intitule": "Premier appel",
      "c-cr": "RAS",
    });
  });
  it("date absente : aujourd'hui", () => {
    expect(buildInteractionCells(fakeCtx(), "d", { type: "Appel" }, "2026-11-18")["c-date"]).toBe("2026-11-18");
  });
  it("titre et note vides ou blancs : aucune cellule écrite", () => {
    const cells = buildInteractionCells(fakeCtx(), "d", { type: "Appel", title: "", note: "   " }, "2026-11-18");
    expect(cells).not.toHaveProperty("c-intitule");
    expect(cells).not.toHaveProperty("c-cr");
  });
  it("sans colonne compte rendu raccordée : note ignorée, sans erreur", () => {
    const cells = buildInteractionCells(fakeCtx(["compte_rendu"]), "d", { type: "Appel", note: "x" }, "2026-11-18");
    expect(Object.values(cells)).not.toContain("x");
    expect(Object.keys(cells)).toHaveLength(3);
  });
  it("sans colonne intitulé raccordée : titre ignoré", () => {
    const cells = buildInteractionCells(fakeCtx(["intitule"]), "d", { type: "Appel", title: "t" }, "2026-11-18");
    expect(Object.values(cells)).not.toContain("t");
  });
});
