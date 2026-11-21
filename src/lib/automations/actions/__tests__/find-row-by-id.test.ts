/**
 * find_row en mode identifiant de ligne : extraction du premier identifiant,
 * contrôle d'accès de la base cible, régression du mode colonne/valeur.
 */
import { describe, it, expect, vi, beforeEach } from "vitest";
import { spaces, userDatabases } from "@/lib/db/schema";

let spaceRows: { id: string; organizationId: string }[] = [];
let databaseRows: { id: string; spaceId: string }[] = [];
let permissions: Record<string, string | null> = {};
let lastRequestedId: string | null = null;

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
  findRowByCellValue: vi.fn(),
  findRowById: vi.fn(),
}));

import { findRowAction, extractRowId } from "../find-row";
import { validateActionConfig } from "../registry";
import { findRowByCellValue, findRowById } from "@/lib/databases/row-writes";
import type { AutomationRow, ExecutionContext } from "../types";

const SPACE_OWN = "11111111-1111-4111-8111-111111111111";
const SPACE_SAME_ORG = "22222222-2222-4222-8222-222222222222";
const SPACE_OTHER_ORG = "33333333-3333-4333-8333-333333333333";
const DB_OWN = "44444444-4444-4444-8444-444444444444";
const DB_SAME_ORG = "55555555-5555-4555-8555-555555555555";
const DB_OTHER_ORG = "66666666-6666-4666-8666-666666666666";
const DB_UNKNOWN = "99999999-9999-4999-8999-999999999999";
const CREATOR = "77777777-7777-4777-8777-777777777777";
const ROW_ID = "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa";
const ROW_ID_2 = "bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb";

const automation: AutomationRow = {
  id: "auto-1",
  databaseId: DB_OWN,
  spaceId: null,
  name: "Test",
  triggerType: "webhook_inbound",
  triggerConfig: null,
  actionType: "find_row",
  actionConfig: null,
  enabled: true,
  lastRunAt: null,
  createdBy: CREATOR,
};
const ctx: ExecutionContext = {
  event: "webhook_inbound",
  cells: { rel: [ROW_ID, ROW_ID_2], one: ROW_ID, none: [], email: "ada@example.com" },
};

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
  vi.mocked(findRowById).mockResolvedValue(undefined);
  vi.mocked(findRowByCellValue).mockResolvedValue(undefined);
});

describe("extractRowId", () => {
  it("chaîne simple telle quelle, tableau JSON : premier élément", () => {
    expect(extractRowId(ROW_ID)).toBe(ROW_ID);
    expect(extractRowId(` ${ROW_ID} `)).toBe(ROW_ID);
    expect(extractRowId(JSON.stringify([ROW_ID, ROW_ID_2]))).toBe(ROW_ID);
  });
  it("vide, tableau vide ou invalide : chaîne vide", () => {
    expect(extractRowId("")).toBe("");
    expect(extractRowId("[]")).toBe("");
    expect(extractRowId("[1]")).toBe("");
    expect(extractRowId("[oups")).toBe("[oups");
  });
});

describe("find_row par identifiant", () => {
  it("id simple trouvé", async () => {
    vi.mocked(findRowById).mockResolvedValue({ id: ROW_ID, cells: { a: 1 } } as never);
    const out = await findRowAction.execute({ rowId: "{{cells.one}}" }, automation, ctx);
    expect(findRowById).toHaveBeenCalledWith(DB_OWN, ROW_ID);
    expect(out).toEqual({ foundRow: { id: ROW_ID, cells: { a: 1 } }, databaseId: DB_OWN });
    expect(findRowByCellValue).not.toHaveBeenCalled();
  });

  it("tableau JSON : premier identifiant", async () => {
    vi.mocked(findRowById).mockResolvedValue({ id: ROW_ID, cells: {} } as never);
    await findRowAction.execute({ rowId: "{{cells.rel}}" }, automation, ctx);
    expect(findRowById).toHaveBeenCalledWith(DB_OWN, ROW_ID);
    await findRowAction.execute({ rowId: "{{cells.rel.0}}" }, automation, ctx);
    expect(findRowById).toHaveBeenLastCalledWith(DB_OWN, ROW_ID);
  });

  it("vide ou tableau vide : null sans appel base, sans repli colonne", async () => {
    for (const rowId of ["", "{{cells.none}}", "{{cells.absent}}"]) {
      const out = await findRowAction.execute(
        { rowId, columnId: "mail", value: "{{cells.email}}" },
        automation,
        ctx
      );
      expect(out).toEqual({ foundRow: null, databaseId: DB_OWN });
    }
    expect(findRowById).not.toHaveBeenCalled();
    expect(findRowByCellValue).not.toHaveBeenCalled();
  });

  it("id d'une autre base : null", async () => {
    const out = await findRowAction.execute({ rowId: ROW_ID }, automation, ctx);
    expect(out).toMatchObject({ foundRow: null });
  });

  it("autre organisation et base inconnue : même message de refus, aucune lecture", async () => {
    const messages: string[] = [];
    for (const target of [DB_UNKNOWN, DB_OTHER_ORG]) {
      await findRowAction
        .execute({ rowId: ROW_ID, databaseId: target }, automation, ctx)
        .catch((e: Error) => messages.push(e.message));
    }
    expect(messages).toHaveLength(2);
    expect(messages[0]).toBe(messages[1]);
    expect(findRowById).not.toHaveBeenCalled();
  });

  it("même organisation : lecture suffit, absence de droit refusée", async () => {
    permissions[`${CREATOR}:${SPACE_SAME_ORG}`] = "viewer";
    await expect(
      findRowAction.execute({ rowId: ROW_ID, databaseId: DB_SAME_ORG }, automation, ctx)
    ).resolves.toMatchObject({ databaseId: DB_SAME_ORG });
    expect(findRowById).toHaveBeenCalledWith(DB_SAME_ORG, ROW_ID);
    permissions[`${CREATOR}:${SPACE_SAME_ORG}`] = null;
    await expect(
      findRowAction.execute({ rowId: ROW_ID, databaseId: DB_SAME_ORG }, automation, ctx)
    ).rejects.toThrow(/droit de lecture/);
  });

  it("schéma : rowId seul ou columnId + value ; sinon refus", () => {
    expect(validateActionConfig("find_row", { rowId: "{{cells.one}}" })).toBeNull();
    expect(validateActionConfig("find_row", { columnId: "mail", value: "x" })).toBeNull();
    expect(validateActionConfig("find_row", { columnId: "mail" })).toMatch(/find_row/);
    expect(validateActionConfig("find_row", {})).toMatch(/find_row/);
  });
});

describe("find_row mode colonne/valeur (régression)", () => {
  it("inchangé", async () => {
    vi.mocked(findRowByCellValue).mockResolvedValue({ id: "r1", cells: { mail: "x" } } as never);
    const out = await findRowAction.execute(
      { columnId: "mail", value: "{{cells.email}}" },
      automation,
      ctx
    );
    expect(findRowByCellValue).toHaveBeenCalledWith(DB_OWN, "mail", "ada@example.com");
    expect(findRowById).not.toHaveBeenCalled();
    expect(out).toEqual({ foundRow: { id: "r1", cells: { mail: "x" } }, databaseId: DB_OWN });
  });
});
