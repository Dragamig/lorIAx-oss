/**
 * Exécution de graphe de bout en bout (registre réel, base mockée) :
 * webhook entrant -> find_row (storeAs) -> condition sur variable -> create_row
 * avec match, ou update_row de la ligne trouvée.
 */
import { describe, it, expect, vi, beforeEach } from "vitest";

const h = vi.hoisted(() => ({ runs: [] as Record<string, unknown>[] }));

vi.mock("@/lib/db", () => {
  const self: Record<string, unknown> = {};
  const chain = () => self;
  Object.assign(self, {
    from: chain,
    where: chain,
    innerJoin: chain,
    leftJoin: chain,
    limit: () => Promise.resolve([]),
    set: chain,
    values: (v: Record<string, unknown>) => {
      h.runs.push(v);
      return Promise.resolve();
    },
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

import { executeAutomation } from "../../executor";
import {
  createDatabaseRow,
  mergeDatabaseRowCells,
  loadColumnTypes,
  findRowByCellValue,
} from "@/lib/databases/row-writes";
import type { AutomationRow } from "../types";

const DB = "44444444-4444-4444-8444-444444444444";

const automation: AutomationRow = {
  id: "auto-1",
  databaseId: DB,
  spaceId: null,
  name: "Lead entrant",
  triggerType: "webhook_inbound",
  triggerConfig: null,
  actionType: "find_row",
  actionConfig: null,
  enabled: true,
  lastRunAt: null,
  createdBy: "creator",
  graph: {
    nodes: [
      { id: "n1", kind: "action", actionType: "find_row", storeAs: "crm", actionConfig: { columnId: "mail", value: "{{cells.email}}" } },
      { id: "n2", kind: "condition", condition: { source: "variable", path: "crm.foundRow", columnId: "", operator: "is_empty" } },
      { id: "n3", kind: "action", actionType: "create_row", actionConfig: { match: { columnId: "mail", value: "{{cells.email}}" }, cells: { mail: "{{cells.email}}", name: "{{cells.name}}" } } },
      { id: "n4", kind: "action", actionType: "update_row", actionConfig: { rowId: "{{variables.crm.foundRow.id}}", cells: { name: "{{cells.name}}" } } },
    ],
    edges: [
      { from: "n1", to: "n2" },
      { from: "n2", to: "n3", branch: "true" },
      { from: "n2", to: "n4", branch: "false" },
    ],
  },
};
const payload = () => ({ event: "webhook_inbound" as const, databaseId: DB, cells: { email: "ada@example.com", name: "Ada" } });

beforeEach(() => {
  vi.clearAllMocks();
  h.runs = [];
  vi.mocked(loadColumnTypes).mockResolvedValue({ mail: "text", name: "text" });
  vi.mocked(createDatabaseRow).mockResolvedValue({ id: "new-row" } as never);
  vi.mocked(mergeDatabaseRowCells).mockResolvedValue({ id: "r1" } as never);
});

describe("graphe webhook -> find_row -> condition -> create_row", () => {
  it("contact inconnu : branche vraie, create_row crée la ligne", async () => {
    vi.mocked(findRowByCellValue).mockResolvedValue(undefined);
    const res = await executeAutomation(automation, payload(), { skipPerAutomationQuota: true });
    expect(res.status).toBe("success");
    expect(createDatabaseRow).toHaveBeenCalledWith(DB, { mail: "ada@example.com", name: "Ada" }, undefined, expect.objectContaining({ source: "automation" }));
    expect(mergeDatabaseRowCells).not.toHaveBeenCalled();
    expect(res.steps).toMatchObject([
      { id: "n1", status: "success" },
      { id: "n2", branch: "true" },
      { id: "n3", status: "success" },
    ]);
  });

  it("contact connu : branche fausse, update_row via la variable stockée", async () => {
    vi.mocked(findRowByCellValue).mockResolvedValue({ id: "r1", cells: { mail: "ada@example.com" } } as never);
    const res = await executeAutomation(automation, payload(), { skipPerAutomationQuota: true });
    expect(res.status).toBe("success");
    expect(createDatabaseRow).not.toHaveBeenCalled();
    expect(mergeDatabaseRowCells).toHaveBeenCalledWith(DB, "r1", { name: "Ada" }, {}, undefined, expect.objectContaining({ source: "automation" }));
    expect(res.steps).toMatchObject([{ id: "n1" }, { id: "n2", branch: "false" }, { id: "n4" }]);
  });
});
