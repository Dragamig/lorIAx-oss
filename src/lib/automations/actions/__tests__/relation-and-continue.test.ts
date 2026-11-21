/**
 * relationMode "append" (update_row, create_row avec match) et continueOnError
 * par nœud : exécution réelle et simulée, statut « partial ».
 */
import { describe, it, expect, vi, beforeEach } from "vitest";

const h = vi.hoisted(() => ({ runs: [] as Record<string, unknown>[] }));

vi.mock("@/lib/db", () => {
  const self: Record<string, unknown> = {};
  const chain = () => self;
  Object.assign(self, {
    from: chain, where: chain, innerJoin: chain, leftJoin: chain, set: chain,
    limit: () => Promise.resolve([]),
    values: (v: Record<string, unknown>) => { h.runs.push(v); return Promise.resolve(); },
    then: (res: (v: unknown[]) => void) => Promise.resolve([]).then(res),
  });
  return { db: { select: () => self, insert: () => self, update: () => self } };
});
vi.mock("@/lib/settings/system-settings", () => ({ getSetting: vi.fn().mockResolvedValue(null) }));
vi.mock("@/lib/auth/check-access", () => ({ getSpacePermission: vi.fn() }));
vi.mock("@/lib/databases/row-writes", () => ({
  createDatabaseRow: vi.fn(),
  mergeDatabaseRowCells: vi.fn(),
  loadColumnTypes: vi.fn(),
  findRowByCellValue: vi.fn(),
  withMatchLock: vi.fn((_d: string, _c: string, _v: string, fn: (tx?: unknown) => Promise<unknown>) => fn(undefined)),
}));

import { executeAutomation, runAutomationTest } from "../../executor";
import { validateGraph } from "../../automation-graph";
import { appendRelationColumns } from "../../cell-coercion";
import { createDatabaseRow, mergeDatabaseRowCells, loadColumnTypes, findRowByCellValue } from "@/lib/databases/row-writes";
import type { AutomationRow } from "../types";

const DB = "44444444-4444-4444-8444-444444444444";

function auto(graph: AutomationRow["graph"]): AutomationRow {
  return {
    id: "a1", databaseId: DB, spaceId: null, name: "T", triggerType: "webhook_inbound",
    triggerConfig: null, actionType: "find_row", actionConfig: null, enabled: true,
    lastRunAt: null, createdBy: "creator", graph,
  };
}
const payload = () => ({ event: "webhook_inbound" as const, databaseId: DB, cells: { email: "a@b.fr" } });

beforeEach(() => {
  vi.clearAllMocks();
  h.runs = [];
  vi.mocked(loadColumnTypes).mockResolvedValue({ mail: "text", dem: "relation", other: "relation" });
  vi.mocked(mergeDatabaseRowCells).mockResolvedValue({ id: "r1" } as never);
  vi.mocked(createDatabaseRow).mockResolvedValue({ id: "new" } as never);
});

describe("appendRelationColumns", () => {
  const types = { dem: "relation", other: "relation", t: "text" };
  it("mode d'action, surcharge par colonne, texte ignoré", () => {
    const cells = { dem: ["x"], other: ["y"], t: "z" };
    expect(appendRelationColumns({ relationMode: "append" }, cells, types)).toEqual(["dem", "other"]);
    expect(appendRelationColumns({ relationMode: "append", relationModes: { other: "replace" } }, cells, types)).toEqual(["dem"]);
    expect(appendRelationColumns({ relationModes: { dem: "append", t: "append" } }, cells, types)).toEqual(["dem"]);
    expect(appendRelationColumns({}, cells, types)).toEqual([]);
  });
});

describe("relationMode append", () => {
  const upd = (cfg: Record<string, unknown>) =>
    auto({ nodes: [{ id: "n1", kind: "action", actionType: "update_row", actionConfig: { rowId: "r1", cells: { dem: "d1", mail: "m" }, ...cfg } }], edges: [] });

  it("update_row : passe les colonnes relation en append", async () => {
    const res = await executeAutomation(upd({ relationModes: { dem: "append" } }), payload(), { skipPerAutomationQuota: true });
    expect(res.status).toBe("success");
    expect(mergeDatabaseRowCells).toHaveBeenCalledWith(DB, "r1", { dem: ["d1"], mail: "m" }, { appendColumns: ["dem"] }, undefined, expect.objectContaining({ source: "automation" }));
  });
  it("update_row : sans option, remplacement (options vides)", async () => {
    await executeAutomation(upd({}), payload(), { skipPerAutomationQuota: true });
    expect(mergeDatabaseRowCells).toHaveBeenCalledWith(DB, "r1", { dem: ["d1"], mail: "m" }, {}, undefined, expect.objectContaining({ source: "automation" }));
  });
  it("create_row avec match : la fusion est en append", async () => {
    vi.mocked(findRowByCellValue).mockResolvedValue({ id: "r9" } as never);
    const g = auto({ nodes: [{ id: "n1", kind: "action", actionType: "create_row", actionConfig: { relationMode: "append", match: { columnId: "mail", value: "m" }, cells: { mail: "m", dem: "d2" } } }], edges: [] });
    await executeAutomation(g, payload(), { skipPerAutomationQuota: true });
    expect(mergeDatabaseRowCells).toHaveBeenCalledWith(DB, "r9", { mail: "m", dem: ["d2"] }, { appendColumns: ["dem"] }, undefined, expect.objectContaining({ source: "automation" }));
  });
  it("simulation : aucune écriture, signale les relations ajoutées", async () => {
    const r = await runAutomationTest({ automation: upd({ relationMode: "append" }), mode: "simulate", sample: { cells: {} } });
    expect(mergeDatabaseRowCells).not.toHaveBeenCalled();
    const step = r.steps.find((s) => s.nodeId === "n1")!;
    expect(step.output).toMatchObject({ appendedRelations: ["dem"], simulated: true });
  });
});

describe("continueOnError", () => {
  // n1 échoue (aucune ligne cible), n2 lit sa variable (null) puis crée une ligne.
  const graph = (continueOnError: boolean | undefined) =>
    auto({
      nodes: [
        { id: "n1", kind: "action", actionType: "update_row", storeAs: "u", continueOnError, actionConfig: { rowId: "{{variables.none}}", cells: { mail: "x" } } },
        { id: "n2", kind: "condition", condition: { source: "variable", path: "u", columnId: "", operator: "is_empty" } },
        { id: "n3", kind: "action", actionType: "create_row", actionConfig: { cells: { mail: "ok" } } },
      ],
      edges: [{ from: "n1", to: "n2" }, { from: "n2", to: "n3", branch: "true" }],
    });

  it("défaut : l'échec arrête tout", async () => {
    const res = await executeAutomation(graph(undefined), payload(), { skipPerAutomationQuota: true });
    expect(res.status).toBe("error");
    expect(createDatabaseRow).not.toHaveBeenCalled();
  });
  it("vrai : trace l'erreur, continue, run « partial »", async () => {
    const res = await executeAutomation(graph(true), payload(), { skipPerAutomationQuota: true });
    expect(res.status).toBe("partial");
    expect(res.error).toMatch(/aucune ligne cible/);
    expect(createDatabaseRow).toHaveBeenCalled();
    expect(res.trace?.find((s) => s.nodeId === "n1")?.status).toBe("error");
    expect(res.trace?.find((s) => s.nodeId === "n3")?.status).toBe("success");
    expect(h.runs.at(-1)?.status).toBe("partial");
  });
  it("simulation : même comportement", async () => {
    const r = await runAutomationTest({ automation: graph(true), mode: "simulate", sample: { cells: {} } });
    expect(r.status).toBe("partial");
    expect(r.steps.find((s) => s.nodeId === "n1")?.status).toBe("error");
    expect(r.steps.find((s) => s.nodeId === "n3")?.status).toBe("simulated");
  });
  it("une erreur sans continueOnError après une erreur tolérée reste fatale", async () => {
    const g = graph(true);
    (g.graph as { nodes: { id: string; actionConfig?: unknown }[] }).nodes[2].actionConfig = { cells: {} };
    const res = await executeAutomation(g, payload(), { skipPerAutomationQuota: true });
    expect(res.status).toBe("error");
  });
});

describe("validateGraph continueOnError", () => {
  const node = (v: unknown) => ({ nodes: [{ id: "a", kind: "action" as const, actionType: "ai", continueOnError: v as boolean }], edges: [] });
  it("accepte booléen et absent, refuse le reste", () => {
    expect(validateGraph(node(true)).ok).toBe(true);
    expect(validateGraph(node(undefined)).ok).toBe(true);
    expect(validateGraph(node("oui")).ok).toBe(false);
  });
});
