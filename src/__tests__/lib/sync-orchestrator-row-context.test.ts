import { describe, it, expect, vi, beforeEach } from "vitest";

const log: string[] = [];

vi.mock("@/lib/databases/row-change-context", () => ({
  SKIP_ROW_HISTORY: { source: "system", skip: true },
  setRowChangeContext: vi.fn(async (_tx: unknown, ctx: { source: string }) => {
    log.push(`ctx:${ctx.source}`);
  }),
}));

vi.mock("@/lib/db", async () => {
  const { getTableName: name } = await import("drizzle-orm");
  const results = (kind: string, table: string): unknown => {
    if (kind === "select") {
      if (table === "external_database_mappings") {
        return [{ id: "m1", provider: "airtable", credentialsEnc: "enc", externalId: "x", userDatabaseId: "d1", columnMapping: [] }];
      }
      if (table === "external_row_tracking") {
        return [
          { id: "t-c", externalRowId: "c", loriaxRowId: "row-c", contentHash: "stale" },
          { id: "t-o", externalRowId: "o", loriaxRowId: "row-o", contentHash: "x" },
        ];
      }
      return [];
    }
    if (kind === "insert" && table === "sync_logs") return [{ id: "log1" }];
    if (kind === "insert" && table === "user_database_rows") return [{ id: "new-row" }];
    return [];
  };
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const make = (): any => {
    let kind = "";
    let table = "";
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const chain: any = new Proxy(function () {}, {
      get(_t, prop) {
        if (prop === "then") {
          return (res: (v: unknown) => void) => {
            log.push(`${kind}:${table}`);
            res(results(kind, table));
          };
        }
        if (prop === "returning") {
          return () => {
            log.push(`${kind}:${table}`);
            return Promise.resolve(results(kind, table));
          };
        }
        return (...args: unknown[]) => {
          if (prop === "select" || prop === "insert" || prop === "update" || prop === "delete") kind = prop as string;
          if ((prop === "from" || ["insert", "update", "delete"].includes(prop as string)) && args[0]) {
            table = name(args[0] as never);
          }
          if (prop === "limit") return Promise.resolve(results(kind, table)).then((r) => { log.push(`${kind}:${table}`); return r; });
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
    transaction: async (fn: (tx: unknown) => Promise<unknown>) => {
      log.push("tx:begin");
      const r = await fn(db);
      log.push("tx:end");
      return r;
    },
  };
  return { db };
});

vi.mock("@/lib/crypto", () => ({ decrypt: () => "creds" }));
vi.mock("@/lib/storage/s3", () => ({ uploadFile: vi.fn() }));
vi.mock("@/lib/security/url-validator", () => ({ validateExternalUrl: vi.fn() }));
vi.mock("@/lib/security/url-validator-server", () => ({ assertPublicHostname: vi.fn() }));
vi.mock("@/lib/integrations/notion/client", () => ({ notionProvider: {} }));
vi.mock("@/lib/integrations/airtable/client", () => ({
  airtableProvider: {
    fetchRows: async () => [
      { externalId: "n", fields: {}, lastModified: null },
      { externalId: "c", fields: {}, lastModified: null },
    ],
  },
}));

import { syncPull } from "@/lib/integrations/sync-orchestrator";

describe("sync-orchestrator : contexte d'historique", () => {
  beforeEach(() => {
    log.length = 0;
  });

  it("création, mise à jour et suppression posent source sync avant l'écriture de la ligne", async () => {
    await syncPull("m1").catch(() => undefined);

    const rowWrites = log
      .map((entry, i) => ({ entry, i }))
      .filter(({ entry }) => /^(insert|update|delete):user_database_rows$/.test(entry));
    expect(rowWrites.map((w) => w.entry)).toEqual([
      "insert:user_database_rows",
      "update:user_database_rows",
      "delete:user_database_rows",
    ]);
    for (const { i } of rowWrites) {
      expect(log[i - 1]).toBe("ctx:sync");
      expect(log.lastIndexOf("tx:begin", i)).toBe(i - 2);
    }
  });
});
