import { describe, it, expect } from "vitest";
import { hashCells, computeFingerprint, isFresh } from "../freshness";
import { summarizeProposal } from "../types";

describe("hashCells", () => {
  it("est identique pour des clés dans un ordre différent, y compris imbriquées", () => {
    expect(hashCells({ a: 1, b: { x: 1, y: [1, 2] } })).toBe(hashCells({ b: { y: [1, 2], x: 1 }, a: 1 }));
  });
  it("change si une valeur change", () => {
    expect(hashCells({ a: 1 })).not.toBe(hashCells({ a: 2 }));
  });
  it("ignore une clé non définie", () => {
    expect(hashCells({ a: 1, b: undefined })).toBe(hashCells({ a: 1 }));
  });
});

describe("isFresh", () => {
  const rows = computeFingerprint([
    { id: "r2", cells: { a: 1 } },
    { id: "r1", cells: { a: 2 } },
  ]);
  it("vrai pour un ensemble identique, quel que soit l'ordre d'entrée", () => {
    const again = computeFingerprint([
      { id: "r1", cells: { a: 2 } },
      { id: "r2", cells: { a: 1 } },
    ]);
    expect(isFresh({ rows }, { rows: again })).toBe(true);
  });
  it("faux si une ligne a disparu", () => {
    expect(isFresh({ rows }, { rows: rows.slice(1) })).toBe(false);
  });
  it("faux si une ligne s'ajoute à l'ensemble", () => {
    const more = computeFingerprint([
      { id: "r1", cells: { a: 2 } },
      { id: "r2", cells: { a: 1 } },
      { id: "r3", cells: {} },
    ]);
    expect(isFresh({ rows }, { rows: more })).toBe(false);
  });
  it("faux si une ligne est modifiée", () => {
    const changed = computeFingerprint([
      { id: "r1", cells: { a: 3 } },
      { id: "r2", cells: { a: 1 } },
    ]);
    expect(isFresh({ rows }, { rows: changed })).toBe(false);
  });
  it("une ligne qui rejoint le groupe (databaseRowCountForKey) rend la proposition périmée", () => {
    expect(isFresh({ rows, databaseRowCountForKey: 2 }, { rows, databaseRowCountForKey: 3 })).toBe(false);
    expect(isFresh({ rows, databaseRowCountForKey: 2 }, { rows, databaseRowCountForKey: 2 })).toBe(true);
    expect(isFresh({ rows, databaseRowCountForKey: 2 }, { rows })).toBe(false);
  });
});

describe("summarizeProposal", () => {
  it("dérive résumé, lignes et conflits sans formulation d'action faite", () => {
    const s = summarizeProposal({
      payload: {
        type: "merge_duplicates",
        keyColumnIds: ["k"],
        relationColumnIds: [],
        groups: [
          {
            groupId: "g1",
            keepRowId: "a",
            removeRowIds: ["b", "c"],
            mergedCells: {},
            conflicts: [{ columnId: "x", chosenFrom: "a", candidates: [] }],
            keepBefore: {},
            keepRow: { id: "x", cells: {}, position: 0 },
            removedRows: [],
            repatriation: { relationCells: 0, attachments: 0, repointed: [] },
          },
          {
            groupId: "g2",
            keepRowId: "d",
            removeRowIds: ["e"],
            mergedCells: {},
            conflicts: [],
            keepBefore: {},
            keepRow: { id: "x", cells: {}, position: 0 },
            removedRows: [],
            repatriation: { relationCells: 0, attachments: 0, repointed: [] },
            excluded: true,
          },
        ],
      },
    });
    expect(s).toMatchObject({ rowCount: 2, conflictCount: 1 });
    expect(s.summary).toMatch(/1 groupe de doublons/);
    expect(s.summary).not.toMatch(/supprimé|fusionné|appliqué/);
  });
  it("accorde le singulier et le pluriel", () => {
    expect(summarizeProposal({ payload: { type: "create_rows", rows: [{ cells: {} }] } }).summary).toBe("Créer 1 ligne");
    expect(summarizeProposal({ payload: { type: "update_rows", changes: [] } }).summary).toBe("Mettre à jour 0 lignes");
  });
});
