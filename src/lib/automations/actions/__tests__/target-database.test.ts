/**
 * Cloisonnement de la base cible de `create_row` / `update_row`.
 * Motif : « refuse ET n'écrit rien », même message pour base absente et
 * base d'une autre organisation (pas d'oracle d'existence).
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
  createDatabaseRow: vi.fn(),
  mergeDatabaseRowCells: vi.fn(),
  loadColumnTypes: vi.fn(),
}));

import { resolveTargetDatabaseId } from "../../target-database";
import { AutomationTargetSpaceError } from "../../target-space";
import { createRowAction } from "../create-row";
import { updateRowAction } from "../update-row";
import {
  createDatabaseRow,
  mergeDatabaseRowCells,
  loadColumnTypes,
} from "@/lib/databases/row-writes";
import type { AutomationRow, ExecutionContext } from "../types";

const ORG_A = "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa";
const ORG_B = "bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb";
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
  triggerType: "row_created",
  triggerConfig: null,
  actionType: "create_row",
  actionConfig: null,
  enabled: true,
  lastRunAt: null,
  createdBy: CREATOR,
};
const ctx: ExecutionContext = { event: "row_created", rowId: "row-1" };

beforeEach(() => {
  vi.clearAllMocks();
  lastRequestedId = null;
  spaceRows = [
    { id: SPACE_OWN, organizationId: ORG_A },
    { id: SPACE_SAME_ORG, organizationId: ORG_A },
    { id: SPACE_OTHER_ORG, organizationId: ORG_B },
  ];
  databaseRows = [
    { id: DB_OWN, spaceId: SPACE_OWN },
    { id: DB_SAME_ORG, spaceId: SPACE_SAME_ORG },
    { id: DB_OTHER_ORG, spaceId: SPACE_OTHER_ORG },
  ];
  permissions = {};
  vi.mocked(loadColumnTypes).mockResolvedValue({ c1: "number" });
  vi.mocked(createDatabaseRow).mockResolvedValue({ id: "new-row" } as never);
  vi.mocked(mergeDatabaseRowCells).mockResolvedValue({ id: "row-1" } as never);
});

const resolve = (configDatabaseId?: string, a: AutomationRow = automation, c = ctx) =>
  resolveTargetDatabaseId({ actionType: "create_row", configDatabaseId, automation: a, ctx: c });

describe("resolveTargetDatabaseId", () => {
  it("défaut : la base de l'automatisation, sans contrôle de permission", async () => {
    await expect(resolve()).resolves.toBe(DB_OWN);
    await expect(resolve(DB_OWN)).resolves.toBe(DB_OWN);
  });

  it("autre base, même organisation, droit d'écriture de l'auteur : accepté", async () => {
    permissions[`${CREATOR}:${SPACE_SAME_ORG}`] = "editor";
    await expect(resolve(DB_SAME_ORG)).resolves.toBe(DB_SAME_ORG);
  });

  it("autre base, même organisation, lecteur seulement : refusé", async () => {
    permissions[`${CREATOR}:${SPACE_SAME_ORG}`] = "viewer";
    await expect(resolve(DB_SAME_ORG)).rejects.toThrow(/droit d'écriture/);
  });

  it("ignore l'utilisateur déclencheur : seul l'auteur compte", async () => {
    permissions[`${CREATOR}:${SPACE_SAME_ORG}`] = "viewer";
    permissions[`trig:${SPACE_SAME_ORG}`] = "admin";
    await expect(
      resolve(DB_SAME_ORG, automation, { ...ctx, user: { id: "trig" } })
    ).rejects.toThrow(/droit d'écriture/);
  });

  it("autre organisation : refusé, même message qu'une base inexistante", async () => {
    const messages: string[] = [];
    for (const target of [DB_UNKNOWN, DB_OTHER_ORG]) {
      await resolve(target).catch((e: Error) => {
        expect(e).toBeInstanceOf(AutomationTargetSpaceError);
        messages.push(e.message);
      });
    }
    expect(messages).toHaveLength(2);
    expect(messages[0]).toBe(messages[1]);
  });

  it("refuse sans auteur identifiable", async () => {
    await expect(resolve(DB_SAME_ORG, { ...automation, createdBy: null })).rejects.toThrow(/auteur/);
  });

  it("interpole le databaseId de config", async () => {
    permissions[`${CREATOR}:${SPACE_SAME_ORG}`] = "admin";
    await expect(
      resolve("{{cells.target}}", automation, { ...ctx, cells: { target: DB_SAME_ORG } })
    ).resolves.toBe(DB_SAME_ORG);
  });
});

describe("create_row / update_row : base cible", () => {
  it("create_row écrit dans la base courante par défaut et expose databaseId", async () => {
    const out = await createRowAction.execute({ cells: { c1: "5" } }, automation, ctx);
    expect(loadColumnTypes).toHaveBeenCalledWith(DB_OWN);
    expect(createDatabaseRow).toHaveBeenCalledWith(DB_OWN, { c1: 5 }, undefined, expect.objectContaining({ source: "automation" }));
    expect(out).toEqual({
      createdRow: { id: "new-row" },
      row: { id: "new-row", created: true, outcome: "created", databaseId: DB_OWN },
      databaseId: DB_OWN,
    });
  });

  it("create_row coerce avec les colonnes de la base cible", async () => {
    permissions[`${CREATOR}:${SPACE_SAME_ORG}`] = "editor";
    const out = await createRowAction.execute(
      { databaseId: DB_SAME_ORG, cells: { c1: "5" } },
      automation,
      ctx
    );
    expect(loadColumnTypes).toHaveBeenCalledWith(DB_SAME_ORG);
    expect(createDatabaseRow).toHaveBeenCalledWith(DB_SAME_ORG, { c1: 5 }, undefined, expect.objectContaining({ source: "automation" }));
    expect(out).toMatchObject({ databaseId: DB_SAME_ORG });
  });

  it("create_row refuse une base d'une autre organisation sans écrire", async () => {
    await expect(
      createRowAction.execute({ databaseId: DB_OTHER_ORG, cells: { c1: "5" } }, automation, ctx)
    ).rejects.toBeInstanceOf(AutomationTargetSpaceError);
    expect(createDatabaseRow).not.toHaveBeenCalled();
  });

  it("update_row cible une autre base autorisée et refuse sinon sans écrire", async () => {
    permissions[`${CREATOR}:${SPACE_SAME_ORG}`] = "editor";
    const out = await updateRowAction.execute(
      { databaseId: DB_SAME_ORG, rowId: "r9", cells: { c1: "7" } },
      automation,
      ctx
    );
    expect(mergeDatabaseRowCells).toHaveBeenCalledWith(DB_SAME_ORG, "r9", { c1: 7 }, {}, undefined, expect.objectContaining({ source: "automation" }));
    expect(out).toEqual({ updatedRow: { id: "row-1" }, databaseId: DB_SAME_ORG });

    vi.mocked(mergeDatabaseRowCells).mockClear();
    await expect(
      updateRowAction.execute({ databaseId: DB_OTHER_ORG, cells: { c1: "7" } }, automation, ctx)
    ).rejects.toBeInstanceOf(AutomationTargetSpaceError);
    expect(mergeDatabaseRowCells).not.toHaveBeenCalled();
  });
});
