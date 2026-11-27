import { describe, expect, it } from "vitest";
import type { PipelineDeal, PipelineDto } from "@/lib/crm/pipeline";
import { resolveTotalsConfig, type KanbanRowLike } from "@/lib/bases/kanban";
import { buildBoard, moveCard, statusPatchFor } from "./pipeline-model";

const ST = "c-statut";
const AM = "c-montant";
const deal = (id: string, status: string | null, amount: number | null, over: Partial<PipelineDeal> = {}): PipelineDeal => ({
  id,
  title: `D${id}`,
  status,
  amount,
  relance: null,
  closeDate: null,
  ownerIds: [],
  contactId: null,
  contactName: null,
  cells: { [ST]: status, [AM]: amount },
  ...over,
});

function dto(deals: PipelineDeal[], over: Partial<PipelineDto> = {}): PipelineDto {
  return {
    spaceId: "s",
    databaseId: "d",
    columns: [
      { id: ST, name: "Statut", type: "select", config: { options: ["Nouveau", "Gagné"] } },
      { id: AM, name: "Montant", type: "number", config: {} },
    ],
    statusColumnId: ST,
    amountColumnId: AM,
    lanes: [
      { key: "Nouveau", label: "Nouveau" },
      { key: "Gagné", label: "Gagné" },
      { key: "", label: "Sans valeur" },
    ],
    deals,
    totals: { amountColumnId: AM, closedLanes: ["Gagné"], weights: { Nouveau: 50, Mort: 90 }, showWeighted: true },
    totalsViewId: "v",
    mineAvailable: true,
    lateAvailable: true,
    missing: [],
    canEdit: true,
    owners: [{ id: "u1", name: "Anne Martin" }],
    ...over,
  };
}
const L = { mine: false, late: false, ownerId: null, weighted: false };
const lane = (b: ReturnType<typeof buildBoard>, k: string) => b.lanes.find((l) => l.key === k)!;

describe("pipeline-model", () => {
  it("recalcule les totaux source et destination après moveCard", () => {
    const d = dto([deal("1", "Nouveau", 100), deal("2", "Nouveau", 50)]);
    const next = moveCard(d, "1", "Gagné");
    const b = buildBoard(next, L, "u", "2026-11-18");
    expect(lane(b, "Nouveau").totals?.sum).toBe(50);
    expect(lane(b, "Gagné").totals?.sum).toBe(100);
    expect(d.deals[0].status).toBe("Nouveau");
  });
  it("filtre mine avant les totaux", () => {
    const d = dto([deal("1", "Nouveau", 100, { ownerIds: ["u"] }), deal("2", "Nouveau", 50)]);
    const b = buildBoard(d, { ...L, mine: true }, "u", "2026-11-18");
    expect(b.banner?.count).toBe(1);
    expect(lane(b, "Nouveau").totals?.sum).toBe(100);
    expect(b.visibleIds).toEqual(["1"]);
  });
  it("carte sans montant : null et non chiffré", () => {
    const b = buildBoard(dto([deal("1", "Nouveau", null)]), L, "u", "2026-11-18");
    expect(lane(b, "Nouveau").cards[0].amount).toBeNull();
    expect(lane(b, "Nouveau").totals?.unpriced).toBe(1);
  });
  it("voie Sans valeur jamais close, libellé client", () => {
    const d = dto([], { totals: { amountColumnId: AM, closedLanes: ["", "Gagné"], weights: {}, showWeighted: true } });
    const b = buildBoard(d, L, "u", "2026-11-18", "Sans valeur (i18n)");
    expect(lane(b, "").closed).toBe(false);
    expect(lane(b, "Gagné").closed).toBe(true);
    expect(lane(b, "").label).toBe("Sans valeur (i18n)");
  });
  it("statut hors options : rabattu sur la voie vide", () => {
    const b = buildBoard(dto([deal("1", "Perdu", 10), deal("2", null, 5)]), L, "u", "2026-11-18");
    expect(lane(b, "").cards.map((c) => c.id).sort()).toEqual(["1", "2"]);
    expect(b.visibleIds.sort()).toEqual(["1", "2"]);
    expect(b.lanes).toHaveLength(3);
  });
  it("clé de poids morte ignorée", () => {
    const b = buildBoard(dto([deal("1", "Nouveau", 100)]), { ...L, weighted: true }, "u", "2026-11-18");
    expect(b.lanes.map((l) => l.key)).not.toContain("Mort");
    expect(b.banner?.weightedSum).toBe(50);
    expect(lane(b, "Nouveau").weight).toBe(50);
  });
  it("moveCard vers Sans valeur écrit null", () => {
    const d = dto([deal("1", "Nouveau", 100)]);
    const next = moveCard(d, "1", "");
    expect(next.deals[0].cells[ST]).toBeNull();
    expect(next.deals[0].status).toBeNull();
    expect(statusPatchFor(d, "")).toEqual({ columnId: ST, value: null });
    expect(statusPatchFor(d, "Gagné")).toEqual({ columnId: ST, value: "Gagné" });
  });
  it("totaux inactifs : null partout, compteur conservé", () => {
    const b = buildBoard(dto([deal("1", "Nouveau", 100)], { totals: null }), L, "u", "2026-11-18");
    expect(b.banner).toBeNull();
    expect(lane(b, "Nouveau").totals).toBeNull();
    expect(lane(b, "Nouveau").cards).toHaveLength(1);
    expect(lane(b, "Nouveau").weight).toBeNull();
    expect(lane(b, "Gagné").closed).toBe(false);
  });
  it("initiales : responsable inconnu = chaîne vide", () => {
    const b = buildBoard(
      dto([deal("1", "Nouveau", 1, { ownerIds: ["u1"] }), deal("2", "Nouveau", 1, { ownerIds: ["zz"] })]),
      L, "u", "2026-11-18",
    );
    const cards = lane(b, "Nouveau").cards;
    expect(cards[0].ownerInitials).toBe("AM");
    expect(cards[1].ownerInitials).toBe("");
  });
  it("relance en retard sur dossier ouvert", () => {
    const b = buildBoard(dto([deal("1", "Nouveau", 1, { relance: "2026-11-01" }), deal("2", "Gagné", 1, { relance: "2026-11-01" })]), L, "u", "2026-11-18");
    expect(lane(b, "Nouveau").cards[0].late).toBe(true);
    expect(lane(b, "Gagné").cards[0].late).toBe(false);
  });
  it("PipelineDeal est compatible avec KanbanRowLike (amountOf formule)", () => {
    const cols = [{ id: AM, name: "M", type: "formula", config: { formula: "1+1" } }];
    const r = resolveTotalsConfig(cols, { kanbanTotals: { amountColumnId: AM, closedLanes: [], weights: {}, showWeighted: false } });
    const row: KanbanRowLike = deal("1", "Nouveau", null);
    expect(r.active?.amountOf?.(row)).toBe(2);
  });
  it("filtre late : seuls les dossiers ouverts en retard, totaux et bandeau suivent", () => {
    const d = dto([
      deal("1", "Nouveau", 100, { relance: "2026-11-01" }),
      deal("2", "Nouveau", 40, { relance: null }),
      deal("3", "Gagné", 500, { relance: "2026-11-01" }),
    ]);
    const b = buildBoard(d, { ...L, late: true }, "u", "2026-11-18");
    expect(b.visibleIds).toEqual(["1"]);
    expect(b.banner?.count).toBe(1);
    expect(b.banner?.openSum).toBe(100);
    expect(lane(b, "Nouveau").cards.map((c) => c.id)).toEqual(["1"]);
    expect(lane(b, "Nouveau").totals).toMatchObject({ count: 1, sum: 100 });
    expect(lane(b, "Gagné").cards).toHaveLength(0);
    expect(lane(b, "Gagné").totals).toMatchObject({ count: 0, sum: 0 });
  });
  it("filtre ownerId : seuls les dossiers de ce responsable, totaux et bandeau suivent", () => {
    const d = dto([
      deal("1", "Nouveau", 100, { ownerIds: ["u1"] }),
      deal("2", "Nouveau", 50, { ownerIds: ["u2"] }),
      deal("3", "Gagné", 25, { ownerIds: ["u1", "u2"] }),
    ]);
    const b = buildBoard(d, { ...L, ownerId: "u1" }, "u", "2026-11-18");
    expect(b.visibleIds.sort()).toEqual(["1", "3"]);
    expect(b.banner?.count).toBe(2);
    expect(b.banner?.openSum).toBe(100);
    expect(lane(b, "Nouveau").totals).toMatchObject({ count: 1, sum: 100 });
    expect(lane(b, "Gagné").totals).toMatchObject({ count: 1, sum: 25 });
  });
  it("bandeau openSum = somme des voies ouvertes visibles", () => {
    const d = dto([
      deal("1", "Nouveau", 100),
      deal("2", "Nouveau", 30),
      deal("3", "", 7),
      deal("4", "Gagné", 999),
      deal("5", "Nouveau", null),
    ]);
    const b = buildBoard(d, L, "u", "2026-11-18");
    const openLanes = b.lanes.filter((l) => !l.closed);
    const expected = openLanes.reduce((acc, l) => acc + (l.totals?.sum ?? 0), 0);
    expect(openLanes.map((l) => l.key).sort()).toEqual(["", "Nouveau"]);
    expect(b.banner?.openSum).toBe(expected);
    expect(b.banner?.openSum).toBe(137);
    expect(b.banner?.open).toBe(4);
  });
  it("moveCard est pur : entrée inchangée, seule la cellule Statut du dossier change", () => {
    const d = dto([
      deal("1", "Nouveau", 100, { ownerIds: ["u1"], contactId: "c1", contactName: "Contact", relance: "2026-11-30" }),
      deal("2", "Nouveau", 50),
      deal("3", "Gagné", 20),
    ]);
    const clone = structuredClone(d);
    const next = moveCard(d, "1", "Gagné");
    expect(d).toEqual(clone);
    expect(next).not.toBe(d);

    const { status: sIn, cells: cellsIn, ...restIn } = d.deals[0];
    const { status: sOut, cells: cellsOut, ...restOut } = next.deals[0];
    expect(restOut).toEqual(restIn);
    expect(sOut).toBe("Gagné");
    expect(cellsOut).toEqual({ ...cellsIn, [ST]: "Gagné" });
    expect(cellsOut[AM]).toBe(cellsIn[AM]);

    expect(next.deals.slice(1)).toEqual(d.deals.slice(1));
    expect({ ...next, deals: undefined }).toEqual({ ...d, deals: undefined });
  });
});
