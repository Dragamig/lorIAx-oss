import { describe, it, expect, vi, beforeEach } from "vitest";
import type { NextRequest } from "next/server";

const requireOrgScoped = vi.fn();
const dbLimit = vi.fn();
const rowsLimit = vi.fn();
const insertValues = vi.fn().mockResolvedValue(undefined);

vi.mock("@/lib/auth/require-org-scoped", () => {
  class OrgScopeError extends Error {
    constructor(public response: unknown, public reason: string) {
      super(reason);
    }
  }
  return { requireOrgScoped: (...a: unknown[]) => requireOrgScoped(...a), OrgScopeError };
});
vi.mock("@/lib/db", () => ({
  db: {
    insert: () => ({ values: (...a: unknown[]) => insertValues(...a) }),
    select: () => ({
      from: () => ({
        where: () => ({
          limit: () => dbLimit(),
          orderBy: () => ({ limit: () => rowsLimit() }),
        }),
      }),
    }),
  },
}));
vi.mock("@/lib/db/schema", () => ({
  userDatabases: { id: "id", archivedAt: "archivedAt", deletedAt: "deletedAt" },
  userDatabaseRows: { id: "id", cells: "cells", position: "position", databaseId: "databaseId" },
}));
const getDatabaseColumns = vi.fn();
vi.mock("@/lib/db/schema-ai-proposals", () => ({ aiToolCalls: {} }));
vi.mock("@/lib/databases/list-databases", () => ({
  listAccessibleDatabases: vi.fn().mockResolvedValue([]),
  getDatabaseColumns: (...a: unknown[]) => getDatabaseColumns(...a),
  getDatabaseSummary: vi.fn().mockResolvedValue({ id: "d1", name: "Base", rowCount: 2 }),
}));
vi.mock("@/lib/databases/attachment-cell-guard", () => ({
  neutralizeUnreadableMediaCells: async (_t: unknown, rows: unknown[]) => rows,
}));

import { findDuplicateGroups } from "../duplicates";
import { buildReadTools } from "../read-tools";
import type { ChatToolContext } from "../context";

const row = (id: string, cells: Record<string, unknown>, position = 0) => ({ id, cells, position });

describe("findDuplicateGroups", () => {
  it("'Dupont ' et 'dupont' forment un groupe", () => {
    const g = findDuplicateGroups([row("a", { n: "Dupont " }, 0), row("b", { n: "dupont" }, 1)], ["n"]);
    expect(g).toHaveLength(1);
    expect(g[0].rowIds).toEqual(["a", "b"]);
  });

  it("trois lignes identiques : un seul groupe de 3", () => {
    const g = findDuplicateGroups(
      [row("a", { n: "x" }, 0), row("b", { n: "x" }, 1), row("c", { n: "X" }, 2)],
      ["n"],
    );
    expect(g).toHaveLength(1);
    expect(g[0].rowIds).toEqual(["a", "b", "c"]);
  });

  it("clés vides : aucun groupe (vide, espaces, absent, plusieurs colonnes)", () => {
    expect(findDuplicateGroups([row("a", { n: "" }), row("b", { n: "  " })], ["n"])).toEqual([]);
    expect(findDuplicateGroups([row("a", {}), row("b", { n: null })], ["n"])).toEqual([]);
    expect(findDuplicateGroups([row("a", {}), row("b", {})], ["n", "v"])).toEqual([]);
  });

  it("clé multiple : une seule colonne égale ne suffit pas", () => {
    const g = findDuplicateGroups(
      [row("a", { n: "Dupont", v: "Paris" }, 0), row("b", { n: "Dupont", v: "Lyon" }, 1)],
      ["n", "v"],
    );
    expect(g).toEqual([]);
    const g2 = findDuplicateGroups(
      [row("a", { n: "Dupont", v: "Paris" }, 0), row("b", { n: "dupont", v: "paris" }, 1)],
      ["n", "v"],
    );
    expect(g2).toHaveLength(1);
  });

  it("conflictColumnIds : valeurs différentes listées, colonne vide d'un côté ignorée", () => {
    const g = findDuplicateGroups(
      [
        row("a", { n: "x", tel: "1", mail: "", ville: "Paris" }, 0),
        row("b", { n: "x", tel: "2", mail: "a@b.fr", ville: "Paris" }, 1),
      ],
      ["n"],
    );
    expect(g[0].conflictColumnIds).toEqual(["tel"]);
  });

  it("groupId stable entre appels, indépendant de l'ordre et de la casse", () => {
    const a = findDuplicateGroups([row("a", { n: "Dupont " }, 0), row("b", { n: "dupont" }, 1)], ["n"]);
    const b = findDuplicateGroups([row("z", { n: "DUPONT" }, 5), row("y", { n: "dupont" }, 3)], ["n"]);
    expect(a[0].groupId).toMatch(/^[0-9a-f]{12}$/);
    expect(a[0].groupId).toBe(b[0].groupId);
    const c = findDuplicateGroups([row("a", { n: "Martin" }, 0), row("b", { n: "martin" }, 1)], ["n"]);
    expect(c[0].groupId).not.toBe(a[0].groupId);
  });

  it("clés faites d'espaces seuls : jamais groupées, même sans trim", () => {
    const g = findDuplicateGroups([row("a", { n: " " }), row("b", { n: "  " })], ["n"], {
      caseInsensitive: true,
      trim: false,
      collapseSpaces: false,
    });
    expect(g).toEqual([]);
  });

  it("normalisation désactivée : la casse compte", () => {
    const g = findDuplicateGroups([row("a", { n: "A" }), row("b", { n: "a" })], ["n"], {
      caseInsensitive: false,
      trim: true,
      collapseSpaces: true,
    });
    expect(g).toEqual([]);
  });
});

describe("find_duplicates", () => {
  const ctx = {
    user: { id: "u1" },
    orgId: "org1",
    spaceIds: ["s1"],
    admin: false,
    req: {} as NextRequest,
  } as unknown as ChatToolContext;
  const opts = { toolCallId: "t", messages: [] } as never;

  beforeEach(() => {
    vi.clearAllMocks();
    requireOrgScoped.mockResolvedValue({ orgId: "org1", spaceId: "s1", permission: "viewer" });
    dbLimit.mockResolvedValue([{ id: "d1" }]);
    getDatabaseColumns.mockResolvedValue([
      { id: "c1", name: "Nom", type: "text" },
      { id: "c2", name: "Tel", type: "text" },
    ]);
  });

  it("refuse au-delà de 20 000 lignes, sans résultat partiel", async () => {
    rowsLimit.mockResolvedValue(
      Array.from({ length: 20001 }, (_, i) => ({ id: `r${i}`, cells: { c1: "a" }, position: i })),
    );
    const { find_duplicates } = buildReadTools(ctx);
    const r = (await find_duplicates.execute!({ databaseId: "d1", keyColumnIds: ["c1"] }, opts)) as {
      error?: string;
      groups?: unknown;
    };
    expect(r.error).toMatch(/volumineuse/);
    expect(r.groups).toBeUndefined();
  });

  it("renvoie les groupes avec keyColumns", async () => {
    rowsLimit.mockResolvedValue([
      { id: "r1", cells: { c1: "Dupont", c2: "1" }, position: 0 },
      { id: "r2", cells: { c1: "dupont ", c2: "2" }, position: 1 },
    ]);
    const { find_duplicates } = buildReadTools(ctx);
    const r = (await find_duplicates.execute!({ databaseId: "d1", keyColumnIds: ["c1"] }, opts)) as {
      keyColumns: { id: string }[];
      groups: { rowIds: string[]; conflictColumnIds: string[]; groupId: string }[];
      truncated: boolean;
    };
    expect(r.keyColumns.map((c) => c.id)).toEqual(["c1"]);
    expect(r.groups[0].rowIds).toEqual(["r1", "r2"]);
    expect(r.groups[0].conflictColumnIds).toEqual(["c2"]);
    expect(r.truncated).toBe(false);
  });

  it("conflits : mêmes règles de colonnes que la fusion (ni autonumber, formule, relation, pièce jointe, ni colonne supprimée)", async () => {
    getDatabaseColumns.mockResolvedValue([
      { id: "c1", name: "Nom", type: "text" },
      { id: "c2", name: "Tel", type: "text" },
      { id: "n", name: "N°", type: "autonumber" },
      { id: "f", name: "Calcul", type: "formula" },
      { id: "r", name: "Lien", type: "relation" },
      { id: "p", name: "Pièces", type: "attachment" },
    ]);
    rowsLimit.mockResolvedValue([
      { id: "r1", cells: { c1: "Dupont", c2: "1", n: 1, f: "a", r: ["x"], p: [{ mediaId: "m1" }], gone: "u" }, position: 0 },
      { id: "r2", cells: { c1: "dupont", c2: "2", n: 2, f: "b", r: ["y"], p: [{ mediaId: "m2" }], gone: "v" }, position: 1 },
    ]);
    const { find_duplicates } = buildReadTools(ctx);
    const r = (await find_duplicates.execute!({ databaseId: "d1", keyColumnIds: ["c1"] }, opts)) as {
      groups: { conflictColumnIds: string[] }[];
    };
    expect(r.groups[0].conflictColumnIds).toEqual(["c2"]);
  });

  it("colonne de clé inconnue : erreur claire", async () => {
    rowsLimit.mockResolvedValue([]);
    const { find_duplicates } = buildReadTools(ctx);
    const r = (await find_duplicates.execute!({ databaseId: "d1", keyColumnIds: ["zz"] }, opts)) as {
      error?: string;
    };
    expect(r.error).toMatch(/zz/);
  });
});
