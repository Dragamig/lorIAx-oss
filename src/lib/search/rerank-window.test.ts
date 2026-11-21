import { describe, expect, it } from "vitest";
import {
  MIN_RERANK_CANDIDATE_WINDOW,
  completeWithFusionTail,
  rerankWindowSize,
} from "./rerank-window";

const id = (x: { id: string }) => x.id;
const make = (n: number, prefix = "d") =>
  Array.from({ length: n }, (_, i) => ({ id: `${prefix}${i}` }));

describe("rerankWindowSize", () => {
  it("garde la fenetre minimale pour les petites limites", () => {
    expect(rerankWindowSize(8)).toBe(MIN_RERANK_CANDIDATE_WINDOW);
    expect(rerankWindowSize(20)).toBe(MIN_RERANK_CANDIDATE_WINDOW);
  });

  it("elargit la fenetre quand l'appelant demande plus que le minimum", () => {
    expect(rerankWindowSize(60)).toBe(60);
    expect(rerankWindowSize(100)).toBe(100);
  });
});

describe("completeWithFusionTail", () => {
  it("rend autant de resultats que demande quand le reclassement en rend moins", () => {
    const fused = make(100);
    // Le fournisseur ne reclasse qu'une partie des candidats (plafond interne).
    const reranked = [fused[42], fused[7], fused[3]];

    const out = completeWithFusionTail(reranked, fused, 100, id);

    expect(out).toHaveLength(100);
    expect(new Set(out.map(id)).size).toBe(100);
  });

  it("place les reclasses en tete puis la queue dans l'ordre de la fusion", () => {
    const fused = make(6);
    const reranked = [fused[4], fused[1]];

    expect(completeWithFusionTail(reranked, fused, 5, id).map(id)).toEqual([
      "d4",
      "d1",
      "d0",
      "d2",
      "d3",
    ]);
  });

  it("ne produit aucun doublon", () => {
    const fused = make(10);
    const out = completeWithFusionTail([fused[2], fused[0]], fused, 10, id);
    expect(new Set(out.map(id)).size).toBe(out.length);
  });

  it("ne depasse jamais la limite demandee", () => {
    const fused = make(10);
    expect(completeWithFusionTail(fused, fused, 4, id)).toHaveLength(4);
    expect(completeWithFusionTail(fused, fused, 0, id)).toEqual([]);
  });

  it("rend la liste reclassee telle quelle si elle couvre deja la limite", () => {
    const fused = make(10);
    const reranked = [fused[9], fused[8], fused[7]];
    expect(completeWithFusionTail(reranked, fused, 3, id).map(id)).toEqual([
      "d9",
      "d8",
      "d7",
    ]);
  });
});
