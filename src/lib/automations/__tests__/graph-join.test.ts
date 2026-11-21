import { describe, it, expect } from "vitest";
import { findJoinNode, validateGraph, type AutomationGraph } from "../automation-graph";

const graph: AutomationGraph = {
  nodes: [
    { id: "n1", kind: "action", actionType: "create_row", actionConfig: {} },
    { id: "c1", kind: "condition", condition: { columnId: "a", operator: "is_not_empty" } },
    { id: "n2", kind: "action", actionType: "create_row", actionConfig: {} },
    { id: "n3", kind: "action", actionType: "create_task", actionConfig: {} },
  ],
  edges: [
    { from: "n1", to: "c1" },
    { from: "c1", to: "n2", branch: "true" },
    { from: "n2", to: "n3" },
    { from: "c1", to: "n3", branch: "false" },
  ],
};

describe("jonction de branches", () => {
  it("trouve le noeud de jonction", () => {
    expect(findJoinNode(graph, "c1")).toBe("n3");
  });
  it("sans convergence : null", () => {
    const g = { ...graph, edges: graph.edges.filter((e) => e.branch !== "false") };
    expect(findJoinNode(g, "c1")).toBeNull();
  });
  it("l'enregistrement (aller-retour JSON du PATCH) conserve toutes les aretes", () => {
    expect(validateGraph(graph).ok).toBe(true);
    const sent = JSON.parse(JSON.stringify({ nodes: graph.nodes, edges: graph.edges }));
    expect(sent.edges).toEqual(graph.edges);
    expect(sent.edges.filter((e: { to: string }) => e.to === "n3")).toHaveLength(2);
  });
});
