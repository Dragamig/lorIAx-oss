import { describe, it, expect } from "vitest";
import { linearizeMainChain, reorderMainChain } from "@/lib/automations/graph-reorder";
import { validateGraph, type AutomationGraph } from "@/lib/automations/automation-graph";

const graph: AutomationGraph = {
  nodes: [
    { id: "a", kind: "action", actionType: "send_email" },
    { id: "b", kind: "action", actionType: "notify_user" },
    { id: "c", kind: "action", actionType: "webhook" },
  ],
  edges: [
    { from: "a", to: "b" },
    { from: "b", to: "c" },
  ],
};

describe("réordonnancement de la chaîne principale", () => {
  it("linéarise la chaîne principale dans l'ordre", () => {
    expect(linearizeMainChain(graph)).toEqual(["a", "b", "c"]);
  });

  it("déplace c avant b (ordre attendu a, c, b)", () => {
    const edges = reorderMainChain(graph.edges, ["a", "b", "c"], "c", "b");
    const moved: AutomationGraph = { nodes: graph.nodes, edges };
    expect(linearizeMainChain(moved)).toEqual(["a", "c", "b"]);
  });

  it("déplace a en fin (ordre attendu b, c, a)", () => {
    const edges = reorderMainChain(graph.edges, ["a", "b", "c"], "a", "c");
    const moved: AutomationGraph = { nodes: graph.nodes, edges };
    expect(linearizeMainChain(moved)).toEqual(["b", "c", "a"]);
  });

  it("ids inconnus ou identiques : renvoie les arêtes inchangées", () => {
    expect(reorderMainChain(graph.edges, ["a", "b", "c"], "a", "a")).toBe(graph.edges);
    expect(reorderMainChain(graph.edges, ["a", "b", "c"], "z", "b")).toBe(graph.edges);
    expect(reorderMainChain(graph.edges, ["a", "b", "c"], "a", "z")).toBe(graph.edges);
  });

  it("le graphe réordonné reste valide (entrée unique, acyclique)", () => {
    const edges = reorderMainChain(graph.edges, ["a", "b", "c"], "b", "a");
    const moved: AutomationGraph = { nodes: graph.nodes, edges };
    expect(validateGraph(moved)).toEqual({ ok: true });
  });

  it("inclut la condition terminale dans la chaîne (arrêt après, arêtes de branche préservées)", () => {
    const g: AutomationGraph = {
      nodes: [
        { id: "a", kind: "action", actionType: "send_email" },
        { id: "b", kind: "action", actionType: "notify_user" },
        { id: "cond", kind: "condition", condition: { columnId: "col", operator: "is_not_empty" } },
        { id: "t", kind: "action", actionType: "webhook" },
        { id: "f", kind: "action", actionType: "create_task" },
      ],
      edges: [
        { from: "a", to: "b" },
        { from: "b", to: "cond" },
        { from: "cond", to: "t", branch: "true" },
        { from: "cond", to: "f", branch: "false" },
      ],
    };
    // La marche s'arrête juste après la condition : ses arêtes sortantes portent
    // toutes un `branch`, donc plus aucune arête "sans branche" à suivre.
    expect(linearizeMainChain(g)).toEqual(["a", "b", "cond"]);

    const edges = reorderMainChain(g.edges, ["a", "b", "cond"], "b", "a");
    const moved: AutomationGraph = { nodes: g.nodes, edges };
    expect(linearizeMainChain(moved)).toEqual(["b", "a", "cond"]);
    // Les arêtes de branche restent intactes.
    expect(edges.some((e) => e.from === "cond" && e.to === "t" && e.branch === "true")).toBe(true);
    expect(edges.some((e) => e.from === "cond" && e.to === "f" && e.branch === "false")).toBe(true);
    expect(validateGraph(moved)).toEqual({ ok: true });
  });

  it("déplacer en tête / queue avec une seule étape ne modifie rien d'anormal", () => {
    const g: AutomationGraph = {
      nodes: [{ id: "a", kind: "action", actionType: "send_email" }],
      edges: [],
    };
    expect(linearizeMainChain(g)).toEqual(["a"]);
    expect(reorderMainChain(g.edges, ["a"], "a", "a")).toEqual([]);
  });
});
