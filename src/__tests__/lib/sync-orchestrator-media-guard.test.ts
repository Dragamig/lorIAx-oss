import { beforeEach, describe, expect, it, vi } from "vitest";

const h = vi.hoisted(() => ({
  inserted: [] as unknown[],
  extCells: {} as Record<string, unknown>,
}));

vi.mock("@/lib/databases/row-change-context", () => ({
  SKIP_ROW_HISTORY: { source: "system", skip: true },
  setRowChangeContext: vi.fn(async () => undefined),
}));
vi.mock("@/lib/crypto", () => ({ decrypt: () => "creds" }));
vi.mock("@/lib/storage/s3", () => ({ uploadFile: vi.fn() }));
vi.mock("@/lib/security/url-validator", () => ({ validateExternalUrl: vi.fn(() => "refus") }));
vi.mock("@/lib/security/url-validator-server", () => ({ assertPublicHostname: vi.fn() }));
vi.mock("@/lib/integrations/notion/client", () => ({ notionProvider: {} }));
vi.mock("@/lib/integrations/airtable/client", () => ({
  airtableProvider: { fetchRows: async () => [{ externalId: "e1", cells: h.extCells, lastModified: null }] },
}));
vi.mock("@/lib/media/access", () => ({
  getMediaForAccess: vi.fn(async () => ({ id: "m" })),
  resolveMediaAccess: vi.fn(async () => ({ allowed: true })),
}));

vi.mock("@/lib/db", async () => {
  const { getTableName } = await import("drizzle-orm");
  const columns = [
    { id: "img", type: "image", name: "Image" },
    { id: "txt", type: "text", name: "Texte" },
  ];
  const mapping = {
    id: "m1",
    provider: "airtable",
    credentialsEnc: "enc",
    externalId: "x",
    userDatabaseId: "d1",
    columnMapping: [
      { loriaxColumnId: "img", externalColumnId: "ei", direction: "both" },
      { loriaxColumnId: "txt", externalColumnId: "et", direction: "both" },
    ],
  };
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const make = (): any => {
    let kind = "";
    let table = "";
    let values: unknown;
    const res = () => {
      if (kind === "select") {
        if (table === "external_database_mappings") return [mapping];
        if (table === "user_database_columns") return columns;
        return [];
      }
      if (kind === "insert" && table === "sync_logs") return [{ id: "log1" }];
      if (kind === "insert" && table === "user_database_rows") {
        h.inserted.push(values);
        return [{ id: "new-row" }];
      }
      return [];
    };
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const chain: any = new Proxy(function () {}, {
      get(_t, prop) {
        if (prop === "then") return (r: (v: unknown) => void) => r(res());
        if (prop === "returning") return () => Promise.resolve(res());
        return (...args: unknown[]) => {
          if (["select", "insert", "update", "delete"].includes(prop as string)) kind = prop as string;
          if ((prop === "from" || ["insert", "update", "delete"].includes(prop as string)) && args[0]) {
            table = getTableName(args[0] as never);
          }
          if (prop === "values") values = args[0];
          if (prop === "limit") return Promise.resolve(res());
          return chain;
        };
      },
    });
    return chain;
  };
  const db = {
    select: (...a: unknown[]) => make().select(...a),
    insert: (...a: unknown[]) => make().insert(...a),
    update: (...a: unknown[]) => make().update(...a),
    delete: (...a: unknown[]) => make().delete(...a),
    transaction: async (fn: (tx: unknown) => Promise<unknown>) => fn(db),
  };
  return { db };
});

import { syncPull } from "@/lib/integrations/sync-orchestrator";

const M = "11111111-1111-4111-8111-111111111111";

beforeEach(() => {
  h.inserted.length = 0;
});

describe("synchronisation externe : garde des cellules médias", () => {
  it("refuse une ligne dont la colonne image référence un média interne", async () => {
    h.extCells = { ei: `/api/media/${M}`, et: "a" };
    const r = await syncPull("m1");
    expect(h.inserted).toHaveLength(0);
    expect(r.rowsCreated).toBe(0);
    expect(r.errors[0]).toContain("Média introuvable");
  });

  it("accepte une image externe et un texte", async () => {
    h.extCells = { ei: "https://cdn.example.com/a.png", et: "/api/media/texte-libre" };
    const r = await syncPull("m1");
    expect(r.errors).toEqual([]);
    expect(h.inserted).toHaveLength(1);
  });
});
