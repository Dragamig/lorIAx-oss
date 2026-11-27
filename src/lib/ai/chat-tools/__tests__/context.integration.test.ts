/**
 * Garde d'accès des outils contre la vraie base, SANS simuler requireOrgScoped : la session et les en-têtes de la
 * requête sont indisponibles (getSessionUser lève, comme pendant le streaming), l'identité vient de ctx.
 * Requiert RELATIONS_TEST_DATABASE_URL ; ignore sinon.
 */
import { describe, it, expect, vi, beforeAll, afterAll, beforeEach } from "vitest";
import { randomUUID } from "crypto";
import type { Pool } from "pg";
import { setupRowHistoryFixture } from "../../../databases/__tests__/row-history-fixture";

const h = vi.hoisted(() => ({
  db: undefined as unknown,
  permission: "viewer" as "viewer" | "editor" | null,
  sessionCalls: 0,
}));

vi.mock("@/lib/db", () => ({
  db: new Proxy({}, { get: (_t, k) => (h.db as Record<string | symbol, unknown>)[k] }),
}));
vi.mock("@/lib/auth/get-user", () => ({
  getSessionUser: async () => {
    h.sessionCalls++;
    throw new Error("headers() indisponible pendant le streaming");
  },
}));
vi.mock("next/headers", () => ({
  headers: async () => {
    throw new Error("headers() indisponible pendant le streaming");
  },
}));
vi.mock("@/lib/auth/check-access", () => ({ getSpacePermission: async () => h.permission }));

import { requireDatabaseAccess, ToolAccessError, type ChatToolContext } from "../context";
import type { SessionUser } from "@/types";

const URL = process.env.RELATIONS_TEST_DATABASE_URL;
const DB_NAME = URL ? new globalThis.URL(URL).pathname.replace(/^\//, "") : "";
if (URL && !DB_NAME.includes("test")) {
  throw new Error(`RELATIONS_TEST_DATABASE_URL doit viser une base de test, reçu "${DB_NAME}"`);
}

describe.skipIf(!URL)("requireDatabaseAccess sans contexte de requête", () => {
  let pool: Pool;
  let teardown: () => Promise<void>;
  const ORG = randomUUID();
  const OTHER_ORG = randomUUID();
  const SPACE = randomUUID();
  const OTHER_SPACE = randomUUID();
  const DB_OK = randomUUID();
  const DB_OTHER = randomUUID();
  const ctx = { user: { id: randomUUID() } as unknown as SessionUser, orgId: ORG, spaceIds: [], admin: false } as ChatToolContext;

  beforeAll(async () => {
    const f = await setupRowHistoryFixture(URL!, "rh_ai_ctx_guard");
    pool = f.pool;
    teardown = f.teardown;
    h.db = f.db;
    await pool.query("ALTER TABLE user_databases ADD COLUMN archived_at timestamptz, ADD COLUMN deleted_at timestamptz");
    await pool.query("INSERT INTO spaces (id, organization_id) VALUES ($1,$2),($3,$4)", [SPACE, ORG, OTHER_SPACE, OTHER_ORG]);
    await pool.query("INSERT INTO user_databases (id, space_id) VALUES ($1,$2),($3,$4)", [DB_OK, SPACE, DB_OTHER, OTHER_SPACE]);
  });
  afterAll(async () => {
    await teardown();
  });
  beforeEach(() => {
    h.permission = "viewer";
    h.sessionCalls = 0;
  });

  const code = async (p: Promise<unknown>) => {
    try {
      await p;
    } catch (e) {
      expect(e).toBeInstanceOf(ToolAccessError);
      return (e as ToolAccessError).code;
    }
    return "ok";
  };

  it("viewer : lecture acceptée sans relire la session", async () => {
    await expect(requireDatabaseAccess(ctx, DB_OK, "viewer")).resolves.toEqual({ databaseId: DB_OK, spaceId: SPACE });
    expect(h.sessionCalls).toBe(0);
  });

  it("viewer sur un seuil editor : forbidden", async () => {
    expect(await code(requireDatabaseAccess(ctx, DB_OK, "editor"))).toBe("forbidden");
  });

  it("editor : écriture acceptée", async () => {
    h.permission = "editor";
    await expect(requireDatabaseAccess(ctx, DB_OK, "editor")).resolves.toMatchObject({ databaseId: DB_OK });
  });

  it("aucun droit sur l'espace : not_found", async () => {
    h.permission = null;
    expect(await code(requireDatabaseAccess(ctx, DB_OK, "viewer"))).toBe("not_found");
  });

  it("base d'une autre organisation : not_found", async () => {
    h.permission = "editor";
    expect(await code(requireDatabaseAccess(ctx, DB_OTHER, "viewer"))).toBe("not_found");
  });

  it("base inexistante : not_found", async () => {
    expect(await code(requireDatabaseAccess(ctx, randomUUID(), "viewer"))).toBe("not_found");
  });
});
