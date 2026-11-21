/**
 * Non-régression : unification des calculs de permission d'espace.
 *
 * Trois calculs concurrents coexistaient : `getSpacePermission`
 * (`src/lib/auth/check-access.ts`), une fonction locale `getSpacePermissionLevel`
 * dupliquée dans les deux routes d'étiquettes d'espace, et `checkSpaceBasedAccess`
 * (`src/lib/calendar/permissions.ts`). Ils ne lisaient pas les mêmes lignes :
 *
 * - `getSpacePermission` ignorait les lignes `space_permissions` accordées à une
 *   ÉQUIPE, alors que `getAccessibleSpaceIds` et `GET /api/spaces` les lisent :
 *   l'espace était listé, puis toute route branchée ici répondait 403 ;
 * - la même fonction annulait une permission explicite quand l'espace avait une
 *   équipe propriétaire dont l'utilisateur n'était pas membre, alors qu'aucune
 *   autre référence du produit n'appliquait cette annulation ;
 * - les routes d'étiquettes ne lisaient que la ligne nominative et ignoraient
 *   jusqu'au propriétaire de l'espace, qui ne pouvait donc pas gérer les
 *   étiquettes du sien.
 *
 * Ces tests exercent les VRAIES fonctions (aucun mock de `check-access`), avec
 * un faux client Drizzle qui répond table par table.
 */
import { describe, it, expect, beforeEach, vi } from "vitest";
import type { NextRequest } from "next/server";

interface FausseLignePermission {
  spaceId: string;
  userId: string | null;
  teamId: string | null;
  level: string;
}

const h = vi.hoisted(() => ({
  state: {
    userId: "",
    spaceId: "",
    users: [] as Array<{ id: string; globalRole: string }>,
    spaces: [] as Array<Record<string, unknown>>,
    spacePermissions: [] as Array<{
      spaceId: string;
      userId: string | null;
      teamId: string | null;
      level: string;
    }>,
    teamMembers: [] as Array<{ teamId: string; userId: string; role: string }>,
    organizationMembers: [] as Array<{
      organizationId: string;
      userId: string;
      role: string;
    }>,
    calendars: [] as Array<Record<string, unknown>>,
    calendarSubscriptions: [] as Array<{
      calendarId: string;
      userId: string;
      permission: string;
    }>,
    calendarId: "",
    /**
     * Le faux client ne sait pas lire une clause `where` Drizzle : il distingue
     * les requêtes d'une même table par leur RANG d'appel, qui est déterministe
     * dans `getSpacePermission`.
     * space_permissions : 1 = ligne nominative, 2 = lignes d'équipe.
     * team_members : 1 = toutes les équipes de l'utilisateur, 2 = appartenance
     * à l'équipe propriétaire (repli).
     */
    permQueryCount: 0,
    teamQueryCount: 0,
  },
  inserted: [] as Array<Record<string, unknown>>,
}));

vi.mock("@/lib/db", async () => {
  const schema = await vi.importActual<typeof import("@/lib/db/schema")>(
    "@/lib/db/schema"
  );
  const s = h.state;

  function equipesDeLUtilisateur(): string[] {
    return s.teamMembers
      .filter((m) => m.userId === s.userId)
      .map((m) => m.teamId);
  }

  function rowsFor(table: unknown): unknown[] {
    if (table === schema.users) {
      return s.users.filter((u) => u.id === s.userId);
    }
    if (table === schema.spaces) {
      return s.spaces.filter((sp) => sp.id === s.spaceId);
    }
    if (table === schema.spacePermissions) {
      s.permQueryCount += 1;
      if (s.permQueryCount === 1) {
        return s.spacePermissions.filter(
          (p) => p.spaceId === s.spaceId && p.userId === s.userId
        );
      }
      const teamIds = equipesDeLUtilisateur();
      return s.spacePermissions.filter(
        (p) =>
          p.spaceId === s.spaceId && p.teamId && teamIds.includes(p.teamId)
      );
    }
    if (table === schema.teamMembers) {
      s.teamQueryCount += 1;
      if (s.teamQueryCount === 1) {
        return s.teamMembers.filter((m) => m.userId === s.userId);
      }
      const space = s.spaces.find((sp) => sp.id === s.spaceId);
      return s.teamMembers.filter(
        (m) => m.userId === s.userId && m.teamId === space?.ownerTeamId
      );
    }
    if (table === schema.organizationMembers) {
      const space = s.spaces.find((sp) => sp.id === s.spaceId);
      return s.organizationMembers.filter(
        (m) =>
          m.userId === s.userId && m.organizationId === space?.organizationId
      );
    }
    if (table === schema.calendars) {
      return s.calendars.filter((c) => c.id === s.calendarId);
    }
    if (table === schema.calendarSubscriptions) {
      return s.calendarSubscriptions.filter(
        (sub) => sub.calendarId === s.calendarId && sub.userId === s.userId
      );
    }
    if (table === schema.labels) {
      return [];
    }
    throw new Error("table inattendue dans le faux client Drizzle");
  }

  function chain() {
    let rows: unknown[] = [];
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const self: any = {
      from: (table: unknown) => {
        rows = rowsFor(table);
        return self;
      },
      where: () => self,
      innerJoin: () => self,
      orderBy: () => self,
      limit: () => Promise.resolve(rows),
      then: (resolve: (v: unknown[]) => void, reject?: (e: unknown) => void) =>
        Promise.resolve(rows).then(resolve, reject),
    };
    return self;
  }

  function insertChain() {
    let valeurs: Record<string, unknown> = {};
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const self: any = {
      values: (v: Record<string, unknown>) => {
        valeurs = v;
        return self;
      },
      returning: () => {
        const ligne = { id: "label-cree", ...valeurs };
        h.inserted.push(ligne);
        return Promise.resolve([ligne]);
      },
    };
    return self;
  }

  return { db: { select: () => chain(), insert: () => insertChain() } };
});

vi.mock("@/lib/auth/get-user", () => ({
  getSessionUser: vi.fn(async () => ({
    id: h.state.userId,
    globalRole:
      h.state.users.find((u) => u.id === h.state.userId)?.globalRole ?? "user",
    email: "test@example.test",
    name: "Test",
  })),
}));

vi.mock("@/lib/org/scoped-space", () => ({
  getSpaceBySlugForRequest: vi.fn(async () =>
    h.state.spaces.find((sp) => sp.id === h.state.spaceId)
  ),
}));

import { getSpacePermission } from "@/lib/auth/check-access";
import { checkCalendarAccess } from "@/lib/calendar/permissions";
import { POST as creerEtiquette } from "@/app/api/spaces/[slug]/labels/route";

const ORG = "org-acme";
const EQUIPE = "team-rh";
const AUTRE_EQUIPE = "team-compta";

function espacePrive(id: string, ownerUserId: string | null = "quelquun-dautre") {
  return {
    id,
    slug: id,
    ownerUserId,
    ownerTeamId: null,
    type: "personal",
    classification: "internal",
    organizationId: ORG,
  };
}

function espaceEquipe(id: string, ownerTeamId = EQUIPE) {
  return {
    id,
    slug: id,
    ownerUserId: null,
    ownerTeamId,
    type: "team",
    classification: "internal",
    organizationId: ORG,
  };
}

function ligneUtilisateur(
  spaceId: string,
  userId: string,
  level: string
): FausseLignePermission {
  return { spaceId, userId, teamId: null, level };
}

function ligneEquipe(
  spaceId: string,
  teamId: string,
  level: string
): FausseLignePermission {
  return { spaceId, userId: null, teamId, level };
}

/** Appelle la vraie fonction en positionnant le contexte du faux client. */
async function permission(userId: string, spaceId: string) {
  h.state.userId = userId;
  h.state.spaceId = spaceId;
  h.state.permQueryCount = 0;
  h.state.teamQueryCount = 0;
  return getSpacePermission(userId, spaceId);
}

beforeEach(() => {
  const s = h.state;
  s.users = [
    { id: "alice", globalRole: "user" },
    { id: "bob", globalRole: "user" },
  ];
  s.spaces = [];
  s.spacePermissions = [];
  s.teamMembers = [];
  s.organizationMembers = [
    { organizationId: ORG, userId: "alice", role: "member" },
    { organizationId: ORG, userId: "bob", role: "member" },
  ];
  s.calendars = [];
  s.calendarSubscriptions = [];
  s.calendarId = "";
  s.permQueryCount = 0;
  s.teamQueryCount = 0;
  h.inserted.length = 0;
});

describe("getSpacePermission : lignes de permission accordées à une équipe", () => {
  it("reconnaît une ligne d'équipe seule, sans aucune ligne nominative", async () => {
    const id = "space-perm-equipe-1";
    h.state.spaces = [espacePrive(id)];
    h.state.teamMembers = [{ teamId: EQUIPE, userId: "alice", role: "member" }];
    h.state.spacePermissions = [ligneEquipe(id, EQUIPE, "editor")];

    expect(await permission("alice", id)).toBe("editor");
  });

  it("ignore une ligne accordée à une équipe dont l'utilisateur n'est pas membre", async () => {
    const id = "space-perm-equipe-2";
    h.state.spaces = [espacePrive(id)];
    h.state.teamMembers = [{ teamId: AUTRE_EQUIPE, userId: "alice", role: "member" }];
    h.state.spacePermissions = [ligneEquipe(id, EQUIPE, "admin")];

    expect(await permission("alice", id)).toBeNull();
  });

  it("retient le meilleur niveau quand la ligne d'équipe est plus forte", async () => {
    const id = "space-perm-equipe-3";
    h.state.spaces = [espacePrive(id)];
    h.state.teamMembers = [{ teamId: EQUIPE, userId: "alice", role: "member" }];
    h.state.spacePermissions = [
      ligneUtilisateur(id, "alice", "viewer"),
      ligneEquipe(id, EQUIPE, "admin"),
    ];

    expect(await permission("alice", id)).toBe("admin");
  });

  it("retient le meilleur niveau quand la ligne nominative est plus forte", async () => {
    const id = "space-perm-equipe-4";
    h.state.spaces = [espacePrive(id)];
    h.state.teamMembers = [{ teamId: EQUIPE, userId: "alice", role: "member" }];
    h.state.spacePermissions = [
      ligneUtilisateur(id, "alice", "admin"),
      ligneEquipe(id, EQUIPE, "viewer"),
    ];

    expect(await permission("alice", id)).toBe("admin");
  });

  it("retient le meilleur niveau entre plusieurs lignes d'équipe", async () => {
    const id = "space-perm-equipe-5";
    h.state.spaces = [espacePrive(id)];
    h.state.teamMembers = [
      { teamId: EQUIPE, userId: "alice", role: "member" },
      { teamId: AUTRE_EQUIPE, userId: "alice", role: "member" },
    ];
    h.state.spacePermissions = [
      ligneEquipe(id, EQUIPE, "viewer"),
      ligneEquipe(id, AUTRE_EQUIPE, "editor"),
    ];

    expect(await permission("alice", id)).toBe("editor");
  });
});

describe("getSpacePermission : la ligne explicite n'est plus annulée", () => {
  it("honore un partage nominatif malgré une équipe propriétaire dont l'utilisateur n'est pas membre", async () => {
    const id = "space-explicite-1";
    h.state.spaces = [espaceEquipe(id)];
    h.state.teamMembers = [{ teamId: EQUIPE, userId: "bob", role: "member" }];
    h.state.spacePermissions = [ligneUtilisateur(id, "alice", "editor")];

    expect(await permission("alice", id)).toBe("editor");
  });

  it("honore une ligne d'équipe sur un espace possédé par une AUTRE équipe", async () => {
    const id = "space-explicite-2";
    h.state.spaces = [espaceEquipe(id, AUTRE_EQUIPE)];
    h.state.teamMembers = [{ teamId: EQUIPE, userId: "alice", role: "member" }];
    h.state.spacePermissions = [ligneEquipe(id, EQUIPE, "admin")];

    expect(await permission("alice", id)).toBe("admin");
  });
});

describe("getSpacePermission : l'espace secret reste sans repli", () => {
  it("n'accorde rien à un membre de l'équipe propriétaire sans ligne explicite", async () => {
    const id = "space-secret-1";
    h.state.spaces = [{ ...espaceEquipe(id), classification: "secret" }];
    h.state.teamMembers = [{ teamId: EQUIPE, userId: "alice", role: "admin" }];

    expect(await permission("alice", id)).toBeNull();
  });

  it("honore en revanche une ligne d'équipe explicite sur un espace secret", async () => {
    const id = "space-secret-2";
    h.state.spaces = [
      { ...espacePrive(id), classification: "secret" },
    ];
    h.state.teamMembers = [{ teamId: EQUIPE, userId: "alice", role: "member" }];
    h.state.spacePermissions = [ligneEquipe(id, EQUIPE, "viewer")];

    expect(await permission("alice", id)).toBe("viewer");
  });
});

describe("étiquettes d'espace : permissions unifiées", () => {
  async function creer(userId: string, spaceId: string) {
    h.state.userId = userId;
    h.state.spaceId = spaceId;
    h.state.permQueryCount = 0;
    h.state.teamQueryCount = 0;

    const request = {
      json: async () => ({ name: "Urgent", color: "#ff0000" }),
    } as unknown as NextRequest;

    return creerEtiquette(request, { params: Promise.resolve({ slug: spaceId }) });
  }

  it("laisse le propriétaire de l'espace créer une étiquette", async () => {
    const id = "space-labels-1";
    h.state.spaces = [espacePrive(id, "alice")];

    const res = await creer("alice", id);
    expect(res.status).toBe(201);
    expect(h.inserted).toHaveLength(1);
  });

  it("laisse le responsable de l'équipe propriétaire créer une étiquette", async () => {
    const id = "space-labels-2";
    h.state.spaces = [espaceEquipe(id)];
    h.state.teamMembers = [{ teamId: EQUIPE, userId: "alice", role: "admin" }];

    const res = await creer("alice", id);
    expect(res.status).toBe(201);
  });

  it("refuse un simple membre de l'équipe propriétaire", async () => {
    const id = "space-labels-3";
    h.state.spaces = [espaceEquipe(id)];
    h.state.teamMembers = [{ teamId: EQUIPE, userId: "alice", role: "member" }];

    const res = await creer("alice", id);
    expect(res.status).toBe(403);
    expect(h.inserted).toHaveLength(0);
  });

  it("laisse une ligne d'équipe de niveau admin créer une étiquette", async () => {
    const id = "space-labels-4";
    h.state.spaces = [espacePrive(id)];
    h.state.teamMembers = [{ teamId: EQUIPE, userId: "alice", role: "member" }];
    h.state.spacePermissions = [ligneEquipe(id, EQUIPE, "admin")];

    const res = await creer("alice", id);
    expect(res.status).toBe(201);
  });
});

describe("calendrier rattaché à un espace : accès conservé", () => {
  function calendrierDEspace(id: string, spaceId: string) {
    return {
      id,
      ownerUserId: "quelquun-dautre",
      ownerTeamId: null,
      spaceId,
      type: "personal",
      organizationId: ORG,
    };
  }

  async function acces(
    userId: string,
    calendarId: string,
    spaceId: string,
    action: "read" | "write" | "admin"
  ) {
    h.state.userId = userId;
    h.state.spaceId = spaceId;
    h.state.calendarId = calendarId;
    h.state.permQueryCount = 0;
    h.state.teamQueryCount = 0;
    // L'organisation de la requête est désormais un paramètre obligatoire :
    // ces calendriers sont ceux d'ORG, on interroge donc depuis ORG.
    return checkCalendarAccess(userId, calendarId, action, ORG);
  }

  it("conserve l'accès d'un utilisateur dont le droit passe par une ligne d'équipe", async () => {
    const spaceId = "space-cal-1";
    const calId = "cal-1";
    h.state.spaces = [espacePrive(spaceId)];
    h.state.calendars = [calendrierDEspace(calId, spaceId)];
    h.state.teamMembers = [{ teamId: EQUIPE, userId: "alice", role: "member" }];
    h.state.spacePermissions = [ligneEquipe(spaceId, EQUIPE, "editor")];

    expect(await acces("alice", calId, spaceId, "read")).toBe(true);
    expect(await acces("alice", calId, spaceId, "write")).toBe(true);
    expect(await acces("alice", calId, spaceId, "admin")).toBe(false);
  });

  it("accorde l'écriture via le repli d'équipe propriétaire de l'espace", async () => {
    const spaceId = "space-cal-2";
    const calId = "cal-2";
    h.state.spaces = [espaceEquipe(spaceId)];
    h.state.calendars = [calendrierDEspace(calId, spaceId)];
    h.state.teamMembers = [{ teamId: EQUIPE, userId: "alice", role: "member" }];

    expect(await acces("alice", calId, spaceId, "write")).toBe(true);
    expect(await acces("alice", calId, spaceId, "admin")).toBe(false);
  });

  it("refuse un utilisateur sans aucun droit sur l'espace", async () => {
    const spaceId = "space-cal-3";
    const calId = "cal-3";
    h.state.spaces = [espacePrive(spaceId)];
    h.state.calendars = [calendrierDEspace(calId, spaceId)];

    expect(await acces("bob", calId, spaceId, "read")).toBe(false);
  });
});
