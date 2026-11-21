/**
 * Lot 3 CRM : option `match` de create_row, action find_row, condition sur
 * variable. La recherche SQL (insensible à la casse / aux espaces de bord) vit
 * dans `findRowByCellValue` ; ici on vérifie ce que les actions lui passent.
 */
import { describe, it, expect, vi, beforeEach } from "vitest";
import { spaces, userDatabases } from "@/lib/db/schema";

let spaceRows: { id: string; organizationId: string }[] = [];
let databaseRows: { id: string; spaceId: string }[] = [];
let permissions: Record<string, string | null> = {};
let lastRequestedId: string | null = null;
const FAKE_TX = { tx: true };
const lockTails = new Map<string, Promise<void>>();

function extractId(condition: unknown): string | null {
  const seen = new Set<unknown>();
  const values: string[] = [];
  const walk = (node: unknown): void => {
    if (!node || typeof node !== "object" || seen.has(node)) return;
    seen.add(node);
    const record = node as Record<string, unknown>;
    if (typeof record.value === "string") values.push(record.value);
    for (const child of Object.values(record)) walk(child);
  };
  walk(condition);
  return values[0] ?? null;
}

vi.mock("@/lib/db", () => ({
  db: {
    select: vi.fn(() => {
      let table: unknown = null;
      const builder = {
        from: vi.fn((t: unknown) => {
          table = t;
          return builder;
        }),
        where: vi.fn((cond: unknown) => {
          lastRequestedId = extractId(cond);
          return builder;
        }),
        limit: vi.fn(() => {
          if (table === spaces)
            return Promise.resolve(spaceRows.filter((r) => r.id === lastRequestedId));
          if (table === userDatabases)
            return Promise.resolve(databaseRows.filter((r) => r.id === lastRequestedId));
          return Promise.resolve([]);
        }),
      };
      return builder;
    }),
  },
}));

vi.mock("@/lib/auth/check-access", () => ({
  getSpacePermission: vi.fn((userId: string, spaceId: string) =>
    Promise.resolve(permissions[`${userId}:${spaceId}`] ?? null)
  ),
}));

vi.mock("@/lib/databases/row-writes", () => ({
  createDatabaseRow: vi.fn(),
  mergeDatabaseRowCells: vi.fn(),
  loadColumnTypes: vi.fn(),
  findRowByCellValue: vi.fn(),
  fillEmptyRowCells: vi.fn(),
  // Verrou simulé : exécutions sérialisées par clé (comme pg_advisory_xact_lock).
  withMatchLock: vi.fn(async (databaseId: string, columnId: string, value: string, fn: (tx: unknown) => Promise<unknown>) => {
    const key = `${databaseId}:${columnId}:${value.trim().toLowerCase()}`;
    const previous = lockTails.get(key) ?? Promise.resolve();
    const run = previous.then(() => fn(FAKE_TX));
    lockTails.set(key, run.then(() => undefined, () => undefined));
    return run;
  }),
}));

import { createRowAction } from "../create-row";
import { findRowAction } from "../find-row";
import { AutomationTargetSpaceError } from "../../target-space";
import { validateActionConfig } from "../registry";
import { evaluateCondition, validateGraph } from "../../automation-graph";
import {
  createDatabaseRow,
  mergeDatabaseRowCells,
  loadColumnTypes,
  findRowByCellValue,
  fillEmptyRowCells,
} from "@/lib/databases/row-writes";
import type { AutomationRow, ExecutionContext } from "../types";

const SPACE_OWN = "11111111-1111-4111-8111-111111111111";
const SPACE_SAME_ORG = "22222222-2222-4222-8222-222222222222";
const SPACE_OTHER_ORG = "33333333-3333-4333-8333-333333333333";
const DB_OWN = "44444444-4444-4444-8444-444444444444";
const DB_SAME_ORG = "55555555-5555-4555-8555-555555555555";
const DB_OTHER_ORG = "66666666-6666-4666-8666-666666666666";
const DB_UNKNOWN = "99999999-9999-4999-8999-999999999999";
const CREATOR = "77777777-7777-4777-8777-777777777777";

const automation: AutomationRow = {
  id: "auto-1",
  databaseId: DB_OWN,
  spaceId: null,
  name: "Test",
  triggerType: "webhook_inbound",
  triggerConfig: null,
  actionType: "create_row",
  actionConfig: null,
  enabled: true,
  lastRunAt: null,
  createdBy: CREATOR,
};
const ctx: ExecutionContext = { event: "webhook_inbound", cells: { email: "  Ada@Example.COM " } };

beforeEach(() => {
  vi.clearAllMocks();
  spaceRows = [
    { id: SPACE_OWN, organizationId: "org-a" },
    { id: SPACE_SAME_ORG, organizationId: "org-a" },
    { id: SPACE_OTHER_ORG, organizationId: "org-b" },
  ];
  databaseRows = [
    { id: DB_OWN, spaceId: SPACE_OWN },
    { id: DB_SAME_ORG, spaceId: SPACE_SAME_ORG },
    { id: DB_OTHER_ORG, spaceId: SPACE_OTHER_ORG },
  ];
  permissions = {};
  vi.mocked(loadColumnTypes).mockResolvedValue({ name: "text", mail: "email" });
  vi.mocked(createDatabaseRow).mockResolvedValue({ id: "new-row" } as never);
  vi.mocked(mergeDatabaseRowCells).mockResolvedValue({ id: "old-row" } as never);
  vi.mocked(findRowByCellValue).mockResolvedValue(undefined);
});

describe("create_row avec match", () => {
  const cfg = { match: { columnId: "mail", value: "{{cells.email}}" }, cells: { name: "Ada" } };

  it("ligne trouvée : fusion des cellules, pas de création, created=false", async () => {
    vi.mocked(findRowByCellValue).mockResolvedValue({ id: "old-row" } as never);
    const out = await createRowAction.execute(cfg, automation, ctx);
    expect(findRowByCellValue).toHaveBeenCalledWith(DB_OWN, "mail", "Ada@Example.COM", FAKE_TX);
    expect(mergeDatabaseRowCells).toHaveBeenCalledWith(DB_OWN, "old-row", { name: "Ada" }, { appendColumns: [] }, FAKE_TX, expect.objectContaining({ source: "automation" }));
    expect(createDatabaseRow).not.toHaveBeenCalled();
    expect(out).toMatchObject({ row: { id: "old-row", created: false, databaseId: DB_OWN } });
  });

  it("ligne absente : création, created=true", async () => {
    const out = await createRowAction.execute(cfg, automation, ctx);
    expect(createDatabaseRow).toHaveBeenCalledWith(DB_OWN, { name: "Ada" }, FAKE_TX, expect.objectContaining({ source: "automation" }));
    expect(mergeDatabaseRowCells).not.toHaveBeenCalled();
    expect(out).toMatchObject({
      createdRow: { id: "new-row" },
      row: { id: "new-row", created: true, databaseId: DB_OWN },
    });
  });

  it("valeur résolue vide : création simple, aucune recherche", async () => {
    const out = await createRowAction.execute(cfg, automation, { ...ctx, cells: {} });
    expect(findRowByCellValue).not.toHaveBeenCalled();
    expect(createDatabaseRow).toHaveBeenCalled();
    expect(out).toMatchObject({ row: { created: true } });
  });

  it("sans match : comportement inchangé, aucune recherche", async () => {
    const out = await createRowAction.execute({ cells: { name: "Ada" } }, automation, ctx);
    expect(findRowByCellValue).not.toHaveBeenCalled();
    expect(out).toMatchObject({ row: { id: "new-row", created: true } });
  });

  it("recherche dans la base cible autorisée, refus sinon", async () => {
    permissions[`${CREATOR}:${SPACE_SAME_ORG}`] = "editor";
    await createRowAction.execute({ ...cfg, databaseId: DB_SAME_ORG }, automation, ctx);
    expect(findRowByCellValue).toHaveBeenCalledWith(DB_SAME_ORG, "mail", "Ada@Example.COM", FAKE_TX);
    vi.mocked(findRowByCellValue).mockClear();
    await expect(
      createRowAction.execute({ ...cfg, databaseId: DB_OTHER_ORG }, automation, ctx)
    ).rejects.toBeInstanceOf(AutomationTargetSpaceError);
    expect(findRowByCellValue).not.toHaveBeenCalled();
  });

  it("le schéma valide match", () => {
    expect(validateActionConfig("create_row", cfg)).toBeNull();
    expect(
      validateActionConfig("create_row", { ...cfg, match: { columnId: "", value: "x" } })
    ).toMatch(/create_row/);
  });
});

describe("create_row : dédoublonnage exact / incomplet", () => {
  const cfg = { match: { columnId: "mail", value: "{{cells.email}}" }, cells: { name: "Ada", mail: "ada@example.com" } };
  const fill = { ...cfg, onMatch: "fill_empty" };

  it("doublon exact (casse et espaces ignorés) : aucune écriture, outcome ignored", async () => {
    vi.mocked(findRowByCellValue).mockResolvedValue({ id: "old-row", cells: { name: " ADA ", mail: "Ada@Example.com" } } as never);
    for (const config of [cfg, fill]) {
      const out = await createRowAction.execute(config, automation, ctx);
      expect(out).toMatchObject({ row: { id: "old-row", created: false, outcome: "ignored", databaseId: DB_OWN } });
    }
    expect(mergeDatabaseRowCells).not.toHaveBeenCalled();
    expect(fillEmptyRowCells).not.toHaveBeenCalled();
  });

  it("incomplet en fill_empty : complété, filledColumns", async () => {
    vi.mocked(findRowByCellValue).mockResolvedValue({ id: "old-row", cells: { name: "", mail: "ada@example.com" } } as never);
    vi.mocked(fillEmptyRowCells).mockResolvedValue({ row: { id: "old-row" }, filledColumns: ["name"] } as never);
    const out = await createRowAction.execute(fill, automation, ctx);
    expect(fillEmptyRowCells).toHaveBeenCalledWith(DB_OWN, "old-row", cfg.cells, { appendColumns: [] }, FAKE_TX, expect.objectContaining({ source: "automation" }));
    expect(mergeDatabaseRowCells).not.toHaveBeenCalled();
    expect(out).toMatchObject({ row: { created: false, outcome: "completed", filledColumns: ["name"] } });
  });

  it("fill_empty sans rien à remplir (valeur existante différente) : ignored", async () => {
    vi.mocked(findRowByCellValue).mockResolvedValue({ id: "old-row", cells: { name: "Grace", mail: "ada@example.com" } } as never);
    const out = await createRowAction.execute(fill, automation, ctx);
    expect(fillEmptyRowCells).not.toHaveBeenCalled();
    expect(out).toMatchObject({ row: { outcome: "ignored" } });
  });

  it("overwrite (défaut) inchangé : fusion, outcome updated", async () => {
    vi.mocked(findRowByCellValue).mockResolvedValue({ id: "old-row", cells: { name: "Grace", mail: "ada@example.com" } } as never);
    const out = await createRowAction.execute(cfg, automation, ctx);
    expect(mergeDatabaseRowCells).toHaveBeenCalledWith(DB_OWN, "old-row", cfg.cells, { appendColumns: [] }, FAKE_TX, expect.objectContaining({ source: "automation" }));
    expect(out).toMatchObject({ row: { created: false, outcome: "updated" } });
  });

  it("création : outcome created", async () => {
    const out = await createRowAction.execute(cfg, automation, ctx);
    expect(out).toMatchObject({ row: { created: true, outcome: "created" } });
  });

  it("relation append + fill_empty : unie via appendColumns", async () => {
    vi.mocked(loadColumnTypes).mockResolvedValue({ name: "text", mail: "email", rel: "relation" });
    vi.mocked(findRowByCellValue).mockResolvedValue({ id: "old-row", cells: { name: "Ada", mail: "ada@example.com", rel: ["a"] } } as never);
    vi.mocked(fillEmptyRowCells).mockResolvedValue({ row: { id: "old-row" }, filledColumns: ["rel"] } as never);
    const config = { ...fill, cells: { ...cfg.cells, rel: ["b"] }, relationModes: { rel: "append" } };
    const out = await createRowAction.execute(config, automation, ctx);
    expect(fillEmptyRowCells).toHaveBeenCalledWith(DB_OWN, "old-row", expect.objectContaining({ rel: ["b"] }), { appendColumns: ["rel"] }, FAKE_TX, expect.objectContaining({ source: "automation" }));
    expect(out).toMatchObject({ row: { outcome: "completed", filledColumns: ["rel"] } });
  });

  it("relation identique (ensemble) : doublon exact", async () => {
    vi.mocked(loadColumnTypes).mockResolvedValue({ name: "text", mail: "email", rel: "relation" });
    vi.mocked(findRowByCellValue).mockResolvedValue({ id: "old-row", cells: { name: "Ada", mail: "ada@example.com", rel: ["b", "a"] } } as never);
    const out = await createRowAction.execute({ ...cfg, cells: { ...cfg.cells, rel: ["a", "b"] } }, automation, ctx);
    expect(out).toMatchObject({ row: { outcome: "ignored" } });
  });

  it("simulé : mêmes outcome et filledColumns que le réel, sans écriture", async () => {
    const cases: Array<[unknown, Record<string, unknown>]> = [
      [{ name: "Ada", mail: "ada@example.com" }, fill],
      [{ name: "", mail: "ada@example.com" }, fill],
      [{ name: "Grace", mail: "ada@example.com" }, cfg],
    ];
    for (const [existingCells, config] of cases) {
      vi.mocked(findRowByCellValue).mockResolvedValue({ id: "old-row", cells: existingCells } as never);
      vi.mocked(fillEmptyRowCells).mockResolvedValue({ row: { id: "old-row" }, filledColumns: ["name"] } as never);
      const real = (await createRowAction.execute(config, automation, ctx)) as { row: Record<string, unknown> };
      const sim = (await createRowAction.simulate!(config, automation, ctx)) as { row: Record<string, unknown> };
      expect(sim.row.outcome).toBe(real.row.outcome);
      expect(sim.row.filledColumns).toEqual(real.row.filledColumns);
    }
    vi.clearAllMocks();
    vi.mocked(loadColumnTypes).mockResolvedValue({ name: "text", mail: "email" });
    vi.mocked(findRowByCellValue).mockResolvedValue({ id: "old-row", cells: { name: "" } } as never);
    await createRowAction.simulate!(fill, automation, ctx);
    expect(fillEmptyRowCells).not.toHaveBeenCalled();
    expect(mergeDatabaseRowCells).not.toHaveBeenCalled();
    expect(createDatabaseRow).not.toHaveBeenCalled();
  });
});

describe("create_row : concurrence sur la même valeur de correspondance", () => {
  it("deux exécutions simultanées : une création, une correspondance", async () => {
    const store: { id: string; cells: Record<string, unknown> }[] = [];
    vi.mocked(findRowByCellValue).mockImplementation((async () => {
      await new Promise((r) => setTimeout(r, 5)); // fenêtre de course entre lecture et écriture
      return store[0];
    }) as never);
    vi.mocked(createDatabaseRow).mockImplementation((async (_db: string, cells: Record<string, unknown>) => {
      await new Promise((r) => setTimeout(r, 5));
      const row = { id: `row-${store.length + 1}`, cells };
      store.push(row);
      return row;
    }) as never);
    vi.mocked(mergeDatabaseRowCells).mockResolvedValue({ id: "row-1" } as never);
    const config = { match: { columnId: "mail", value: "{{cells.email}}" }, cells: { name: "Ada" } };
    const results = (await Promise.all([
      createRowAction.execute(config, automation, ctx),
      createRowAction.execute(config, automation, { ...ctx, cells: { email: "ADA@example.com " } }),
    ])) as { row: { outcome: string } }[];
    expect(store).toHaveLength(1);
    expect(createDatabaseRow).toHaveBeenCalledTimes(1);
    expect(results.map((r) => r.row.outcome).sort()).toEqual(["created", "ignored"]);
  });
});

describe("find_row", () => {
  const cfg = { columnId: "mail", value: "{{cells.email}}" };

  it("ligne trouvée : id et cellules", async () => {
    vi.mocked(findRowByCellValue).mockResolvedValue({ id: "r1", cells: { mail: "ada@example.com" } } as never);
    const out = await findRowAction.execute(cfg, automation, ctx);
    expect(findRowByCellValue).toHaveBeenCalledWith(DB_OWN, "mail", "Ada@Example.COM");
    expect(out).toEqual({
      foundRow: { id: "r1", cells: { mail: "ada@example.com" } },
      databaseId: DB_OWN,
    });
  });

  it("ligne absente ou valeur vide : foundRow null", async () => {
    await expect(findRowAction.execute(cfg, automation, ctx)).resolves.toEqual({
      foundRow: null,
      databaseId: DB_OWN,
    });
    await expect(findRowAction.execute(cfg, automation, { ...ctx, cells: {} })).resolves.toMatchObject({
      foundRow: null,
    });
  });

  it("autre base : lecture suffit, absence de droit refusée", async () => {
    permissions[`${CREATOR}:${SPACE_SAME_ORG}`] = "viewer";
    await expect(
      findRowAction.execute({ ...cfg, databaseId: DB_SAME_ORG }, automation, ctx)
    ).resolves.toMatchObject({ databaseId: DB_SAME_ORG });
    permissions[`${CREATOR}:${SPACE_SAME_ORG}`] = null;
    await expect(
      findRowAction.execute({ ...cfg, databaseId: DB_SAME_ORG }, automation, ctx)
    ).rejects.toThrow(/droit de lecture/);
  });

  it("autre organisation et base inconnue : même message de refus", async () => {
    const messages: string[] = [];
    for (const target of [DB_UNKNOWN, DB_OTHER_ORG]) {
      await findRowAction
        .execute({ ...cfg, databaseId: target }, automation, ctx)
        .catch((e: Error) => messages.push(e.message));
    }
    expect(messages).toHaveLength(2);
    expect(messages[0]).toBe(messages[1]);
    expect(findRowByCellValue).not.toHaveBeenCalled();
  });

  it("schéma : colonne requise", () => {
    expect(validateActionConfig("find_row", cfg)).toBeNull();
    expect(validateActionConfig("find_row", { value: "x" })).toMatch(/find_row/);
  });
});

describe("condition sur variable", () => {
  const vars = { crm: { foundRow: { id: "r1", cells: {} }, empty: "" } };
  const cond = (operator: string, path: string, value?: string) =>
    ({ source: "variable", path, columnId: "", operator, value }) as never;

  it("présente / absente", () => {
    expect(evaluateCondition(cond("is_not_empty", "crm.foundRow"), {}, vars)).toBe(true);
    expect(evaluateCondition(cond("is_empty", "crm.foundRow"), {}, vars)).toBe(false);
    expect(evaluateCondition(cond("is_empty", "crm.foundRow"), {}, { crm: { foundRow: null } })).toBe(true);
    expect(evaluateCondition(cond("is_empty", "crm.nope.deep"), {}, vars)).toBe(true);
    expect(evaluateCondition(cond("is_empty", "crm.empty"), {}, vars)).toBe(true);
    expect(evaluateCondition(cond("is_not_empty", "x"), {}, undefined)).toBe(false);
  });

  it("is / is_not sur une valeur", () => {
    expect(evaluateCondition(cond("is", "crm.foundRow.id", "R1"), {}, vars)).toBe(true);
    expect(evaluateCondition(cond("is_not", "crm.foundRow.id", "r2"), {}, vars)).toBe(true);
  });

  it("rétrocompatible : condition de cellule historique inchangée", () => {
    expect(
      evaluateCondition({ columnId: "a", operator: "is", value: "x" }, { a: "X" }, vars)
    ).toBe(true);
  });

  it("validateGraph : accepte une variable, refuse chemin vide ou opérateur non supporté", () => {
    const g = (condition: unknown) => ({
      nodes: [{ id: "c", kind: "condition", condition }],
      edges: [],
    });
    expect(validateGraph(g(cond("is_empty", "crm.foundRow")) as never).ok).toBe(true);
    expect(validateGraph(g(cond("is_empty", " ")) as never).ok).toBe(false);
    expect(validateGraph(g(cond("contains", "crm", "x")) as never).ok).toBe(false);
    expect(validateGraph(g({ columnId: "a", operator: "is" }) as never).ok).toBe(true);
  });
});
