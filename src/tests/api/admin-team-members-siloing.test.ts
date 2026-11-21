/**
 * Non-régression : cloisonnement de la composition d'équipe
 * (`/api/admin/teams/[teamId]/members`), constat AZ-06, lot 6.
 *
 * Les quatre verbes n'avaient qu'une garde de rôle `admin` : le `teamId` venait
 * de l'URL, le `userId` du corps, et rien ne confrontait `teams.organizationId`
 * à l'organisation de la requête. Un admin de l'organisation A s'ajoutait donc
 * lui-même, en rôle d'administrateur d'équipe, à une équipe de l'organisation
 * B, ce qui lui ouvrait en prime un abonnement au calendrier de cette équipe.
 * Le correctif 1.99.5, qui a rendu opérantes les lignes de permission
 * d'équipe dans `getSpacePermission`, aggravait le défaut : la ligne
 * `team_members` volée vaut désormais une permission d'espace réelle chez la
 * victime.
 *
 * Motif de vérification : « répond 404 ET ne fait rien ». L'absence d'effet est
 * prouvée par le non-appel de `db.insert` / `db.update` / `db.delete` et des
 * effets externes (abonnement au calendrier d'équipe). 404 et jamais 403 : on
 * ne révèle pas l'existence d'une équipe d'un autre tenant. Chaque refus est
 * doublé d'un chemin passant, pour que la suite ne soit pas vraie par vacuité.
 */
import { describe, it, expect, vi, beforeEach } from "vitest";
import { NextRequest } from "next/server";

const DRIZZLE_NAME = Symbol.for("drizzle:Name");

const h = vi.hoisted(() => ({
  getSessionUser: vi.fn(),
  getRequestOrgId: vi.fn(),
  subscribe: vi.fn(),
  unsubscribe: vi.fn(),
  rowsByTable: {} as Record<string, unknown[]>,
  insertCalls: { count: 0 },
  updateCalls: { count: 0 },
  deleteCalls: { count: 0 },
}));

/** Chaîne Drizzle factice, « thenable » à n'importe quelle profondeur. */
function chain(getRows: () => unknown[]) {
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const self: any = {
    then: (resolve: (v: unknown[]) => void, reject?: (e: unknown) => void) =>
      Promise.resolve(getRows()).then(resolve, reject),
  };
  for (const methode of [
    "innerJoin",
    "leftJoin",
    "where",
    "set",
    "values",
    "orderBy",
    "limit",
    "returning",
  ]) {
    self[methode] = vi.fn(() => self);
  }
  return self;
}

/** Chaîne de lecture qui rend les lignes déclarées pour la table interrogée. */
function selectChain() {
  let table = "";
  const self = chain(() => h.rowsByTable[table] ?? []);
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  self.from = vi.fn((t: any) => {
    table = t?.[DRIZZLE_NAME] ?? "";
    return self;
  });
  return self;
}

vi.mock("@/lib/auth/get-user", () => ({ getSessionUser: h.getSessionUser }));
vi.mock("@/lib/org/get-request-org", () => ({ getRequestOrgId: h.getRequestOrgId }));
vi.mock("@/lib/calendar/auto-provision", () => ({
  subscribeToTeamCalendar: h.subscribe,
  unsubscribeFromTeamCalendar: h.unsubscribe,
}));
vi.mock("@/lib/db", () => ({
  db: {
    select: vi.fn(() => selectChain()),
    insert: vi.fn(() => {
      h.insertCalls.count += 1;
      return chain(() => []);
    }),
    update: vi.fn(() => {
      h.updateCalls.count += 1;
      return chain(() => []);
    }),
    delete: vi.fn(() => {
      h.deleteCalls.count += 1;
      return chain(() => []);
    }),
  },
}));

const TEAM_B = "11111111-1111-4111-8111-111111111111";
const USER_MALLORY = "22222222-2222-4222-8222-222222222222";

function contexte(teamId: string) {
  return { params: Promise.resolve({ teamId }) };
}

const postReq = () =>
  new NextRequest("http://localhost/api/admin/teams/x/members", {
    method: "POST",
    body: JSON.stringify({ userId: USER_MALLORY, role: "admin" }),
    headers: { "content-type": "application/json" },
  });

const patchReq = () =>
  new NextRequest("http://localhost/api/admin/teams/x/members", {
    method: "PATCH",
    body: JSON.stringify({ userId: USER_MALLORY, role: "admin" }),
    headers: { "content-type": "application/json" },
  });

const deleteReq = () =>
  new NextRequest(
    `http://localhost/api/admin/teams/x/members?userId=${USER_MALLORY}`,
    { method: "DELETE" }
  );

const getReq = () => new NextRequest("http://localhost/api/admin/teams/x/members");

function aucunEffet() {
  expect(h.insertCalls.count).toBe(0);
  expect(h.updateCalls.count).toBe(0);
  expect(h.deleteCalls.count).toBe(0);
  expect(h.subscribe).not.toHaveBeenCalled();
  expect(h.unsubscribe).not.toHaveBeenCalled();
}

beforeEach(() => {
  vi.clearAllMocks();
  h.rowsByTable = {};
  h.insertCalls.count = 0;
  h.updateCalls.count = 0;
  h.deleteCalls.count = 0;
  h.getSessionUser.mockResolvedValue({
    id: "admin-a",
    name: "Admin A",
    email: "admin@org-a.test",
    globalRole: "admin",
  });
  // L'organisation de la requête est résolue avec contrôle d'appartenance.
  h.getRequestOrgId.mockResolvedValue("org-a");
  h.subscribe.mockResolvedValue(undefined);
  h.unsubscribe.mockResolvedValue(undefined);
});

describe("POST /api/admin/teams/[teamId]/members : cloisonnement", () => {
  it("404 muet et aucun ajout pour une équipe d'un autre tenant", async () => {
    // La requête filtrée par organisation ne ramène rien : l'équipe existe,
    // mais pas dans l'organisation de l'admin.
    h.rowsByTable.teams = [];

    const { POST } = await import("@/app/api/admin/teams/[teamId]/members/route");
    const res = await POST(postReq(), contexte(TEAM_B));

    expect(res.status).toBe(404);
    expect((await res.json()).error).toBe("Équipe introuvable");
    aucunEffet();
  });

  it("404 quand aucune organisation n'est résolue (fail-closed)", async () => {
    h.rowsByTable.teams = [{ id: TEAM_B }];
    h.getRequestOrgId.mockResolvedValue(null);

    const { POST } = await import("@/app/api/admin/teams/[teamId]/members/route");
    const res = await POST(postReq(), contexte(TEAM_B));

    expect(res.status).toBe(404);
    aucunEffet();
  });

  it("404 et aucun ajout quand l'utilisateur visé n'appartient pas à l'organisation", async () => {
    h.rowsByTable.teams = [{ id: TEAM_B }];
    h.rowsByTable.organization_members = [];

    const { POST } = await import("@/app/api/admin/teams/[teamId]/members/route");
    const res = await POST(postReq(), contexte(TEAM_B));

    expect(res.status).toBe(404);
    expect((await res.json()).error).toBe("Utilisateur introuvable");
    aucunEffet();
  });

  it("ajoute bien un membre de l'organisation à une équipe de l'organisation", async () => {
    h.rowsByTable.teams = [{ id: TEAM_B }];
    h.rowsByTable.organization_members = [{ userId: USER_MALLORY }];
    h.rowsByTable.team_members = [];

    const { POST } = await import("@/app/api/admin/teams/[teamId]/members/route");
    const res = await POST(postReq(), contexte(TEAM_B));

    expect(res.status).toBe(201);
    expect(h.insertCalls.count).toBe(1);
    expect(h.subscribe).toHaveBeenCalledOnce();
  });
});

describe("GET /api/admin/teams/[teamId]/members : cloisonnement", () => {
  it("404 muet pour une équipe d'un autre tenant", async () => {
    h.rowsByTable.teams = [];

    const { GET } = await import("@/app/api/admin/teams/[teamId]/members/route");
    const res = await GET(getReq(), contexte(TEAM_B));

    expect(res.status).toBe(404);
    aucunEffet();
  });

  it("rend la composition d'une équipe de l'organisation", async () => {
    h.rowsByTable.teams = [{ id: TEAM_B }];
    h.rowsByTable.team_members = [{ userId: USER_MALLORY, role: "member" }];

    const { GET } = await import("@/app/api/admin/teams/[teamId]/members/route");
    const res = await GET(getReq(), contexte(TEAM_B));

    expect(res.status).toBe(200);
    expect(await res.json()).toHaveLength(1);
  });
});

describe("PATCH /api/admin/teams/[teamId]/members : cloisonnement", () => {
  it("404 muet et aucune promotion pour une équipe d'un autre tenant", async () => {
    h.rowsByTable.teams = [];

    const { PATCH } = await import("@/app/api/admin/teams/[teamId]/members/route");
    const res = await PATCH(patchReq(), contexte(TEAM_B));

    expect(res.status).toBe(404);
    aucunEffet();
  });

  it("promeut bien un membre d'une équipe de l'organisation", async () => {
    h.rowsByTable.teams = [{ id: TEAM_B }];

    const { PATCH } = await import("@/app/api/admin/teams/[teamId]/members/route");
    const res = await PATCH(patchReq(), contexte(TEAM_B));

    expect(res.status).toBe(200);
    expect(h.updateCalls.count).toBe(1);
  });
});

describe("DELETE /api/admin/teams/[teamId]/members : cloisonnement", () => {
  it("404 muet, aucune suppression ni désabonnement pour une équipe d'un autre tenant", async () => {
    h.rowsByTable.teams = [];

    const { DELETE } = await import("@/app/api/admin/teams/[teamId]/members/route");
    const res = await DELETE(deleteReq(), contexte(TEAM_B));

    expect(res.status).toBe(404);
    aucunEffet();
  });

  it("retire bien un membre d'une équipe de l'organisation", async () => {
    h.rowsByTable.teams = [{ id: TEAM_B }];

    const { DELETE } = await import("@/app/api/admin/teams/[teamId]/members/route");
    const res = await DELETE(deleteReq(), contexte(TEAM_B));

    expect(res.status).toBe(200);
    expect(h.deleteCalls.count).toBe(1);
    expect(h.unsubscribe).toHaveBeenCalledOnce();
  });
});
