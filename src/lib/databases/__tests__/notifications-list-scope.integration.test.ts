/**
 * Filtre SQL de GET /api/notifications contre la vraie base : cloisonnement par organisation et par
 * espace des notifications de ligne, notifications globales conservees. Requiert
 * RELATIONS_TEST_DATABASE_URL ; ignore sinon. getSpacePermission est simule (juge d'acces hors SQL).
 */
import { describe, it, expect, vi, beforeAll, afterAll, beforeEach } from "vitest";
import { NextRequest } from "next/server";
import { randomUUID } from "crypto";
import type { Pool } from "pg";
import { setupRowTasksFixture } from "./row-tasks-fixture";

const h = vi.hoisted(() => ({
  db: undefined as unknown,
  userId: "",
  orgId: "" as string | null,
  deniedSpaces: new Set<string>(),
}));

vi.mock("@/lib/db", () => ({
  db: new Proxy({}, { get: (_t, k) => (h.db as Record<string | symbol, unknown>)[k] }),
}));
vi.mock("@/lib/auth/get-user", () => ({
  getSessionUser: vi.fn(async () => ({ id: h.userId, name: "A", email: "a@x.fr", globalRole: "editor" })),
}));
vi.mock("@/lib/org/get-request-org", () => ({ getRequestOrgId: vi.fn(async () => h.orgId) }));
vi.mock("@/lib/auth/check-access", () => ({
  getSpacePermission: vi.fn(async (_u: string, spaceId: string) =>
    h.deniedSpaces.has(spaceId) ? null : "viewer"
  ),
}));

import { GET } from "@/app/api/notifications/route";

const URL = process.env.RELATIONS_TEST_DATABASE_URL;
const DB_NAME = URL ? new globalThis.URL(URL).pathname.replace(/^\//, "") : "";
if (URL && !DB_NAME.includes("test")) {
  throw new Error(`RELATIONS_TEST_DATABASE_URL doit viser une base de test, reçu "${DB_NAME}"`);
}

describe.skipIf(!URL)("GET /api/notifications : filtre SQL de cloisonnement", () => {
  let pool: Pool;
  let teardown: () => Promise<void>;
  const ORG = randomUUID();
  const OTHER_ORG = randomUUID();
  const SPACE = randomUUID();
  const LOST_SPACE = randomUUID();
  const FOREIGN_SPACE = randomUUID();
  const DB_OK = randomUUID();
  const DB_LOST = randomUUID();
  const DB_FOREIGN = randomUUID();
  const USER = randomUUID();

  beforeAll(async () => {
    const f = await setupRowTasksFixture(URL!, "rh_notif_scope");
    pool = f.pool;
    teardown = f.teardown;
    h.db = f.db;
    await pool.query(`
      ALTER TABLE spaces ADD COLUMN slug varchar(255);
      CREATE TABLE documents (id uuid PRIMARY KEY, space_id uuid, title varchar(500) NOT NULL DEFAULT '');
    `);
  });
  afterAll(async () => {
    await teardown();
  });

  beforeEach(async () => {
    h.userId = USER;
    h.orgId = ORG;
    h.deniedSpaces = new Set([LOST_SPACE]);
    await pool.query("DELETE FROM notifications");
    await pool.query("DELETE FROM user_databases");
    await pool.query("DELETE FROM spaces");
    await pool.query("DELETE FROM users");
    await pool.query("INSERT INTO users (id, name) VALUES ($1, 'U')", [USER]);
    for (const [id, org] of [[SPACE, ORG], [LOST_SPACE, ORG], [FOREIGN_SPACE, OTHER_ORG]]) {
      await pool.query("INSERT INTO spaces (id, organization_id, slug) VALUES ($1, $2, 's')", [id, org]);
    }
    for (const [id, sp] of [[DB_OK, SPACE], [DB_LOST, LOST_SPACE], [DB_FOREIGN, FOREIGN_SPACE]]) {
      await pool.query("INSERT INTO user_databases (id, space_id) VALUES ($1, $2)", [id, sp]);
    }
  });

  const notif = (title: string, databaseId: string | null) =>
    pool.query(
      `INSERT INTO notifications (user_id, type, title, database_id, row_id)
       VALUES ($1, 'mention', $2, $3::uuid, CASE WHEN $3::uuid IS NULL THEN NULL ELSE gen_random_uuid() END)`,
      [USER, title, databaseId]
    );
  const list = async () => {
    const res = await GET(new NextRequest("http://localhost/api/notifications"));
    return (await res.json()) as { notifications: { title: string }[]; unreadCount: number };
  };

  it("notification de ligne d'une autre organisation : masquée de la liste et du compteur", async () => {
    await notif("autre-org", DB_FOREIGN);
    await notif("globale", null);
    const out = await list();
    expect(out.notifications.map((n) => n.title)).toEqual(["globale"]);
    expect(out.unreadCount).toBe(1);
  });

  it("notification de ligne d'un espace dont l'accès est perdu : masquée de la liste et du compteur", async () => {
    await notif("espace-perdu", DB_LOST);
    await notif("espace-ok", DB_OK);
    const out = await list();
    expect(out.notifications.map((n) => n.title)).toEqual(["espace-ok"]);
    expect(out.unreadCount).toBe(1);
  });

  it("notifications globales : toujours listées et comptées, aussi sans organisation résolue", async () => {
    await notif("globale-1", null);
    await notif("globale-2", null);
    await notif("ligne", DB_OK);
    let out = await list();
    expect(out.notifications).toHaveLength(3);
    expect(out.unreadCount).toBe(3);
    h.orgId = null;
    out = await list();
    expect(out.notifications.map((n) => n.title).sort()).toEqual(["globale-1", "globale-2"]);
    expect(out.unreadCount).toBe(2);
  });
});
