import { describe, it, expect } from "vitest";
import { deriveActionLabel } from "../automation-labels";
import type { AutomationGraph } from "@/lib/automations/automation-graph";

const graph = (types: string[]): AutomationGraph => ({
  nodes: types.map((t, i) => ({ id: `n${i}`, kind: "action", actionType: t })),
  edges: types.slice(1).map((_, i) => ({ from: `n${i}`, to: `n${i + 1}` })),
});

describe("deriveActionLabel", () => {
  it("sans graphe : libellé de actionType", () => {
    expect(deriveActionLabel("webhook", null)).toBe("Webhook");
  });
  it("graphe à une action : le graphe prime sur actionType périmé", () => {
    expect(deriveActionLabel("create_document", graph(["create_task"]))).toBe("Créer une tâche");
  });
  it("graphe à plusieurs actions : première action + nombre d'autres", () => {
    expect(deriveActionLabel("create_document", graph(["create_task", "send_email"]))).toBe(
      "Créer une tâche + 1",
    );
  });
  it("graphe sans action : repli sur actionType", () => {
    expect(deriveActionLabel("webhook", { nodes: [], edges: [] })).toBe("Webhook");
  });
});
