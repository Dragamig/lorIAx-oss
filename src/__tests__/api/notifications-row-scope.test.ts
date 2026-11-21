/**
 * Cloisonnement des notifications de ligne (GET /api/notifications).
 * Une notification de ligne a documentId nul : elle ne doit jamais passer pour
 * une notification globale. Visible seulement si la base appartient à l'org
 * courante ET si l'appelant a encore viewer sur l'espace (getSpacePermission).
 */
import { describe, it, expect, vi, beforeEach } from "vitest";
import { NextRequest } from "next/server";

// File de résultats consommée dans l'ordre d'exécution de la route :
// 1 liste (limit), 2 compte SQL des non lues hors lignes (then), 3 non lues de ligne (limit).
let queue: unknown[][] = [];
let limitArgs: number[] = [];
const next = () => Promise.resolve(queue.shift() ?? []);
function setup(opts: { rows?: unknown[]; count?: number; unreadRows?: unknown[] }) {
  queue = [opts.rows ?? [], [{ count: opts.count ?? 0 }], opts.unreadRows ?? []];
}

const makeChainableMock = () => {
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const self: any = {
    then: (resolve: (v: unknown[]) => void, reject?: (e: unknown) => void) =>
      next().then(resolve, reject),
    select: vi.fn().mockReturnThis(),
    from: vi.fn().mockReturnThis(),
    where: vi.fn().mockReturnThis(),
    orderBy: vi.fn().mockReturnThis(),
    leftJoin: vi.fn().mockReturnThis(),
    innerJoin: vi.fn().mockReturnThis(),
    limit: vi.fn((n: number) => {
      limitArgs.push(n);
      return next();
    }),
  };
  return self;
};

vi.mock("@/lib/auth/get-user", () => ({
  getSessionUser: vi.fn().mockResolvedValue({
    id: "user-a", name: "Alice", email: "alice@org-a.com", globalRole: "editor",
  }),
}));
vi.mock("@/lib/org/get-request-org", () => ({
  getRequestOrgId: vi.fn().mockResolvedValue("org-a"),
}));
vi.mock("@/lib/auth/check-access", () => ({
  getSpacePermission: vi.fn(),
}));
vi.mock("@/lib/db", () => ({ db: makeChainableMock() }));

import { getRequestOrgId } from "@/lib/org/get-request-org";
import { getSpacePermission } from "@/lib/auth/check-access";

const mockOrg = vi.mocked(getRequestOrgId);
const mockPerm = vi.mocked(getSpacePermission);

const base = {
  documentId: null,
  organizationId: null,
  documentTitle: null,
  spaceSlug: null,
  read: false,
  databaseId: null,
  rowId: null,
  rowOrganizationId: null,
  rowSpaceId: null,
};
const rowNotif = (id: string, over: Record<string, unknown> = {}) => ({
  ...base,
  id,
  databaseId: "db-1",
  rowId: "row-1",
  rowOrganizationId: "org-a",
  rowSpaceId: "space-1",
  ...over,
});

async function call() {
  const { GET } = await import("@/app/api/notifications/route");
  const res = await GET(new NextRequest("http://localhost/api/notifications") as never);
  expect(res.status).toBe(200);
  return res.json();
}

beforeEach(() => {
  vi.clearAllMocks();
  queue = [];
  limitArgs = [];
  mockOrg.mockResolvedValue("org-a");
  mockPerm.mockResolvedValue("viewer" as never);
});

describe("GET /api/notifications : notifications de ligne", () => {
  it("une notification de ligne d'une base d'une autre organisation n'est jamais renvoyée, même si le destinataire figure aussi dans l'organisation courante", async () => {
    setup({
      rows: [rowNotif("n-other", { rowOrganizationId: "org-b", rowSpaceId: "space-b" })],
    });
    const body = await call();
    expect(body.notifications).toEqual([]);
    expect(body.unreadCount).toBe(0);
  });

  it("une notification de ligne dont le destinataire n'a plus viewer sur l'espace n'est pas renvoyée ni comptée", async () => {
    mockPerm.mockResolvedValue(null as never);
    setup({
      rows: [rowNotif("n-lost")],
      unreadRows: [{ databaseId: "db-1", rowSpaceId: "space-1" }],
    });
    const body = await call();
    expect(body.notifications).toEqual([]);
    expect(body.unreadCount).toBe(0);
  });

  it("une notification sans document et sans base (système) reste renvoyée", async () => {
    setup({ rows: [{ ...base, id: "n-sys" }], count: 1 });
    const body = await call();
    expect(body.notifications.map((n: { id: string }) => n.id)).toEqual(["n-sys"]);
    expect(body.unreadCount).toBe(1);
    expect(mockPerm).not.toHaveBeenCalled();
  });

  it("une notification de ligne de l'organisation courante avec viewer est renvoyée avec databaseId et rowId", async () => {
    setup({ rows: [rowNotif("n-ok")] });
    const body = await call();
    expect(body.notifications).toHaveLength(1);
    expect(body.notifications[0]).toMatchObject({
      id: "n-ok",
      databaseId: "db-1",
      rowId: "row-1",
    });
    expect(body.notifications[0]).not.toHaveProperty("rowSpaceId");
    expect(body.notifications[0]).not.toHaveProperty("rowOrganizationId");
    expect(mockPerm).toHaveBeenCalledWith("user-a", "space-1");
  });

  it("la branche sans document n'attrape aucune ligne dont database_id n'est pas nul (org non résolue)", async () => {
    mockOrg.mockResolvedValue(null as never);
    setup({ rows: [rowNotif("n-row"), { ...base, id: "n-sys" }], count: 1 });
    const body = await call();
    expect(body.notifications.map((n: { id: string }) => n.id)).toEqual(["n-sys"]);
    expect(body.unreadCount).toBe(1);
  });

  it("la branche sans document n'attrape aucune ligne dont database_id n'est pas nul (base sans espace joint)", async () => {
    setup({ rows: [rowNotif("n-orphan", { rowOrganizationId: null, rowSpaceId: null })] });
    const body = await call();
    expect(body.notifications).toEqual([]);
  });

  it("unreadCount ne compte pas une notification de ligne refusée", async () => {
    mockPerm.mockImplementation((async (_u: string, spaceId: string) =>
      spaceId === "space-1" ? "viewer" : null) as never);
    setup({
      rows: [rowNotif("n-ok"), rowNotif("n-denied", { rowSpaceId: "space-denied" }), { ...base, id: "n-sys" }],
      count: 1,
      unreadRows: [
        { databaseId: "db-1", rowSpaceId: "space-1" },
        { databaseId: "db-1", rowSpaceId: "space-denied" },
      ],
    });
    const body = await call();
    expect(body.notifications.map((n: { id: string }) => n.id)).toEqual(["n-ok", "n-sys"]);
    expect(body.unreadCount).toBe(2);
  });

  it("les non lues globales et de document restent comptées par SQL, sans charger leurs lignes", async () => {
    setup({ rows: [{ ...base, id: "g" }], count: 7 });
    const body = await call();
    expect(body.unreadCount).toBe(7);
    expect(mockPerm).not.toHaveBeenCalled();
  });

  it("une seule vérification de permission par espace distinct", async () => {
    setup({ rows: [rowNotif("a"), rowNotif("b")] });
    await call();
    expect(mockPerm).toHaveBeenCalledTimes(1);
  });

  it("des notifications de ligne masquées en tête de page n'écourtent pas la page", async () => {
    mockPerm.mockImplementation((async (_u: string, spaceId: string) =>
      spaceId === "space-1" ? "viewer" : null) as never);
    const hidden = [1, 2, 3].map((i) => rowNotif(`h${i}`, { rowSpaceId: "space-denied" }));
    const visible = [1, 2, 3].map((i) => rowNotif(`v${i}`));
    setup({ rows: [...hidden, ...visible] });
    const { GET } = await import("@/app/api/notifications/route");
    const res = await GET(new NextRequest("http://localhost/api/notifications?limit=3") as never);
    const body = await res.json();
    expect(body.notifications.map((n: { id: string }) => n.id)).toEqual(["v1", "v2", "v3"]);
    expect(limitArgs[0]).toBe(6);
  });
});
