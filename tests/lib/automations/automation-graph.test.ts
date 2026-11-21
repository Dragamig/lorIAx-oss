import { describe, it, expect } from "vitest";
import {
  validateGraph,
  synthesizeGraphFromAction,
  findEntryNode,
  nextNodeIds,
  evaluateCondition,
  type AutomationGraph,
} from "@/lib/automations/automation-graph";

describe("validateGraph", () => {
  it("accepte un graphe linéaire valide", () => {
    const graph: AutomationGraph = {
      nodes: [
        { id: "a", kind: "action", actionType: "send_email" },
        { id: "b", kind: "action", actionType: "webhook" },
      ],
      edges: [{ from: "a", to: "b" }],
    };
    expect(validateGraph(graph)).toEqual({ ok: true });
  });

  it("accepte un graphe avec branche condition true/false", () => {
    const graph: AutomationGraph = {
      nodes: [
        { id: "c", kind: "condition", condition: { columnId: "col1", operator: "is_not_empty" } },
        { id: "t", kind: "action", actionType: "send_email" },
        { id: "f", kind: "action", actionType: "webhook" },
      ],
      edges: [
        { from: "c", to: "t", branch: "true" },
        { from: "c", to: "f", branch: "false" },
      ],
    };
    expect(validateGraph(graph)).toEqual({ ok: true });
  });

  it("rejette un graphe vide", () => {
    const res = validateGraph({ nodes: [], edges: [] });
    expect(res.ok).toBe(false);
  });

  it("rejette des identifiants de nœud en double", () => {
    const res = validateGraph({
      nodes: [
        { id: "a", kind: "action", actionType: "webhook" },
        { id: "a", kind: "action", actionType: "send_email" },
      ],
      edges: [],
    });
    expect(res.ok).toBe(false);
    if (!res.ok) expect(res.error).toContain("double");
  });

  it("rejette un nœud action sans actionType", () => {
    const res = validateGraph({
      nodes: [{ id: "a", kind: "action" }],
      edges: [],
    });
    expect(res.ok).toBe(false);
  });

  it("rejette un nœud condition incomplet", () => {
    const res = validateGraph({
      nodes: [{ id: "c", kind: "condition" }],
      edges: [],
    });
    expect(res.ok).toBe(false);
  });

  it("rejette une arête vers un nœud inexistant", () => {
    const res = validateGraph({
      nodes: [{ id: "a", kind: "action", actionType: "webhook" }],
      edges: [{ from: "a", to: "zzz" }],
    });
    expect(res.ok).toBe(false);
    if (!res.ok) expect(res.error).toContain("inconnu");
  });

  it("rejette une boucle directe", () => {
    const res = validateGraph({
      nodes: [{ id: "a", kind: "action", actionType: "webhook" }],
      edges: [{ from: "a", to: "a" }],
    });
    expect(res.ok).toBe(false);
  });

  it("rejette plusieurs entrées (deux racines)", () => {
    const res = validateGraph({
      nodes: [
        { id: "a", kind: "action", actionType: "webhook" },
        { id: "b", kind: "action", actionType: "send_email" },
      ],
      edges: [],
    });
    expect(res.ok).toBe(false);
    if (!res.ok) expect(res.error).toContain("seule entrée");
  });

  it("rejette un cycle (aucune entrée)", () => {
    const res = validateGraph({
      nodes: [
        { id: "a", kind: "action", actionType: "webhook" },
        { id: "b", kind: "action", actionType: "send_email" },
      ],
      edges: [
        { from: "a", to: "b" },
        { from: "b", to: "a" },
      ],
    });
    expect(res.ok).toBe(false);
  });

  it("rejette une arête de condition sans branche", () => {
    const res = validateGraph({
      nodes: [
        { id: "c", kind: "condition", condition: { columnId: "x", operator: "is_empty" } },
        { id: "a", kind: "action", actionType: "webhook" },
      ],
      edges: [{ from: "c", to: "a" }],
    });
    expect(res.ok).toBe(false);
    if (!res.ok) expect(res.error).toContain("branche");
  });

  it("rejette une branche dupliquée sur une condition", () => {
    const res = validateGraph({
      nodes: [
        { id: "c", kind: "condition", condition: { columnId: "x", operator: "is_empty" } },
        { id: "a", kind: "action", actionType: "webhook" },
        { id: "b", kind: "action", actionType: "send_email" },
      ],
      edges: [
        { from: "c", to: "a", branch: "true" },
        { from: "c", to: "b", branch: "true" },
      ],
    });
    expect(res.ok).toBe(false);
    if (!res.ok) expect(res.error).toContain("dupliquée");
  });

  it("rejette une arête d'action portant une branche", () => {
    const res = validateGraph({
      nodes: [
        { id: "a", kind: "action", actionType: "webhook" },
        { id: "b", kind: "action", actionType: "send_email" },
      ],
      edges: [{ from: "a", to: "b", branch: "true" }],
    });
    expect(res.ok).toBe(false);
  });
});

describe("synthesizeGraphFromAction", () => {
  it("construit un graphe à un seul nœud action", () => {
    const graph = synthesizeGraphFromAction("send_email", { to: "x@y.fr" });
    expect(graph.nodes).toHaveLength(1);
    expect(graph.edges).toHaveLength(0);
    expect(graph.nodes[0]).toMatchObject({
      kind: "action",
      actionType: "send_email",
      actionConfig: { to: "x@y.fr" },
    });
    expect(validateGraph(graph)).toEqual({ ok: true });
  });

  it("tolère une config null", () => {
    const graph = synthesizeGraphFromAction("webhook", null);
    expect(graph.nodes[0].actionConfig).toEqual({});
  });
});

describe("findEntryNode", () => {
  it("renvoie le nœud sans arête entrante", () => {
    const graph: AutomationGraph = {
      nodes: [
        { id: "a", kind: "action", actionType: "webhook" },
        { id: "b", kind: "action", actionType: "send_email" },
      ],
      edges: [{ from: "a", to: "b" }],
    };
    expect(findEntryNode(graph)?.id).toBe("a");
  });
});

describe("nextNodeIds", () => {
  const graph: AutomationGraph = {
    nodes: [
      { id: "c", kind: "condition", condition: { columnId: "x", operator: "is_empty" } },
      { id: "t", kind: "action", actionType: "send_email" },
      { id: "f", kind: "action", actionType: "webhook" },
    ],
    edges: [
      { from: "c", to: "t", branch: "true" },
      { from: "c", to: "f", branch: "false" },
    ],
  };

  it("suit la branche true", () => {
    expect(nextNodeIds(graph, "c", "true")).toEqual(["t"]);
  });

  it("suit la branche false", () => {
    expect(nextNodeIds(graph, "c", "false")).toEqual(["f"]);
  });

  it("renvoie toutes les sorties sans filtre de branche", () => {
    expect(nextNodeIds(graph, "c")).toEqual(["t", "f"]);
  });
});

describe("evaluateCondition", () => {
  it("évalue is_not_empty contre une cellule présente", () => {
    expect(
      evaluateCondition({ columnId: "nom", operator: "is_not_empty" }, { nom: "Alice" })
    ).toBe(true);
    expect(evaluateCondition({ columnId: "nom", operator: "is_not_empty" }, {})).toBe(false);
  });

  it("évalue contains", () => {
    expect(
      evaluateCondition(
        { columnId: "titre", operator: "contains", value: "jour" },
        { titre: "Bonjour" }
      )
    ).toBe(true);
  });
});
