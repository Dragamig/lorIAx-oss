/**
 * Non-régression : replis d'appartenance de `getSpacePermission`.
 *
 * La fonction ne connaissait que trois chemins d'accès (admin global,
 * propriétaire de l'espace, ligne explicite dans `space_permissions`), alors
 * que le produit en accorde quatre (cf. `GET /api/spaces`) : s'y ajoutent
 * l'appartenance à l'équipe propriétaire et les espaces de type
 * `organization`, ouverts à tout membre de l'organisation. Or l'espace
 * « Général » créé par `provisionOrgForUser` est exactement de ce type, sans
 * propriétaire ni ligne de permission : tout contrôle branché sur
 * `getSpacePermission` renvoyait 403 à des utilisateurs parfaitement
 * légitimes, y compris au propriétaire de l'organisation.
 *
 * Ces tests exercent la VRAIE fonction (aucun mock de `check-access`), avec un
 * faux client Drizzle qui répond table par table.
 */
import { describe, it, expect, beforeEach, vi } from "vitest";

const h = vi.hoisted(() => ({
  state: {
    userId: "",
    spaceId: "",
    users: [] as Array<{ id: string; globalRole: string }>,
    spaces: [] as Array<Record<string, unknown>>,
    spacePermissions: [] as Array<{ spaceId: string; userId: string; level: string }>,
    teamMembers: [] as Array<{ teamId: string; userId: string; role: string }>,
    organizationMembers: [] as Array<{ organizationId: string; userId: string; role: string }>,
  },
  queried: [] as string[],
}));

vi.mock("@/lib/db", async () => {
  const schema = await vi.importActual<typeof import("@/lib/db/schema")>("@/lib/db/schema");
  const s = h.state;

  function rowsFor(table: unknown): unknown[] {
    if (table === schema.users) {
      h.queried.push("users");
      return s.users.filter((u) => u.id === s.userId);
    }
    if (table === schema.spaces) {
      h.queried.push("spaces");
      return s.spaces.filter((sp) => sp.id === s.spaceId);
    }
    if (table === schema.spacePermissions) {
      h.queried.push("space_permissions");
      return s.spacePermissions.filter(
        (p) => p.spaceId === s.spaceId && p.userId === s.userId
      );
    }
    if (table === schema.teamMembers) {
      h.queried.push("team_members");
      const space = s.spaces.find((sp) => sp.id === s.spaceId);
      return s.teamMembers.filter(
        (m) => m.userId === s.userId && m.teamId === space?.ownerTeamId
      );
    }
    if (table === schema.organizationMembers) {
      h.queried.push("organization_members");
      const space = s.spaces.find((sp) => sp.id === s.spaceId);
      return s.organizationMembers.filter(
        (m) => m.userId === s.userId && m.organizationId === space?.organizationId
      );
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

  return { db: { select: () => chain() } };
});

import { getSpacePermission } from "@/lib/auth/check-access";

const ORG = "org-acme";
const AUTRE_ORG = "org-rivale";
const EQUIPE = "team-rh";

/** Espace « Général » type : organisation, sans propriétaire ni permission. */
function espaceOrganisation(id: string, organizationId = ORG) {
  return {
    id,
    ownerUserId: null,
    ownerTeamId: null,
    type: "organization",
    classification: "internal",
    organizationId,
  };
}

function espaceEquipe(id: string, ownerTeamId = EQUIPE) {
  return {
    id,
    ownerUserId: null,
    ownerTeamId,
    type: "team",
    classification: "internal",
    organizationId: ORG,
  };
}

function espacePrive(id: string) {
  return {
    id,
    ownerUserId: "quelquun-dautre",
    ownerTeamId: null,
    type: "personal",
    classification: "internal",
    organizationId: ORG,
  };
}

/** Appelle la vraie fonction en positionnant le contexte du faux client. */
async function permission(userId: string, spaceId: string) {
  h.state.userId = userId;
  h.state.spaceId = spaceId;
  return getSpacePermission(userId, spaceId);
}

beforeEach(() => {
  const s = h.state;
  s.users = [
    { id: "alice", globalRole: "user" },
    { id: "bob", globalRole: "user" },
    { id: "patronne", globalRole: "user" },
    { id: "etrangere", globalRole: "user" },
  ];
  s.spaces = [];
  s.spacePermissions = [];
  s.teamMembers = [];
  s.organizationMembers = [
    { organizationId: ORG, userId: "alice", role: "member" },
    { organizationId: ORG, userId: "bob", role: "member" },
    { organizationId: ORG, userId: "patronne", role: "owner" },
    { organizationId: AUTRE_ORG, userId: "etrangere", role: "owner" },
  ];
  h.queried.length = 0;
});

describe("repli espace d'organisation", () => {
  it("accorde editor à un membre de l'organisation propriétaire de l'espace", async () => {
    const id = "space-general-1";
    h.state.spaces = [espaceOrganisation(id)];

    expect(await permission("alice", id)).toBe("editor");
  });

  it("accorde admin au propriétaire de l'organisation, qui n'est pas admin global", async () => {
    const id = "space-general-2";
    h.state.spaces = [espaceOrganisation(id)];

    expect(await permission("patronne", id)).toBe("admin");
  });

  it("n'accorde rien à un membre d'une AUTRE organisation", async () => {
    const id = "space-general-3";
    h.state.spaces = [espaceOrganisation(id)];

    expect(await permission("etrangere", id)).toBeNull();
  });

  it("n'accorde rien sur un espace d'organisation classé secret", async () => {
    const id = "space-general-secret";
    h.state.spaces = [{ ...espaceOrganisation(id), classification: "secret" }];

    expect(await permission("alice", id)).toBeNull();
    // Le repli est court-circuité avant toute requête d'appartenance.
    expect(h.queried).not.toContain("organization_members");
  });

  it("laisse la ligne explicite primer sur le repli", async () => {
    const id = "space-general-4";
    h.state.spaces = [espaceOrganisation(id)];
    h.state.spacePermissions = [{ spaceId: id, userId: "alice", level: "admin" }];

    expect(await permission("alice", id)).toBe("admin");
    // Chemin nominal : aucune requête de repli supplémentaire.
    expect(h.queried).not.toContain("organization_members");
  });
});

describe("repli espace d'équipe", () => {
  it("accorde editor à un membre de l'équipe propriétaire, sans ligne explicite", async () => {
    const id = "space-team-1";
    h.state.spaces = [espaceEquipe(id)];
    h.state.teamMembers = [{ teamId: EQUIPE, userId: "alice", role: "member" }];

    expect(await permission("alice", id)).toBe("editor");
  });

  it("accorde admin au responsable de l'équipe", async () => {
    const id = "space-team-2";
    h.state.spaces = [espaceEquipe(id)];
    h.state.teamMembers = [{ teamId: EQUIPE, userId: "bob", role: "admin" }];

    expect(await permission("bob", id)).toBe("admin");
  });

  it("n'accorde rien à un non-membre de l'équipe", async () => {
    const id = "space-team-3";
    h.state.spaces = [espaceEquipe(id)];
    h.state.teamMembers = [{ teamId: EQUIPE, userId: "bob", role: "member" }];

    expect(await permission("alice", id)).toBeNull();
  });

  it("n'accorde rien sur un espace d'équipe classé secret", async () => {
    const id = "space-team-secret";
    h.state.spaces = [{ ...espaceEquipe(id), classification: "secret" }];
    h.state.teamMembers = [{ teamId: EQUIPE, userId: "alice", role: "member" }];

    expect(await permission("alice", id)).toBeNull();
  });
});

describe("ce que les replis n'ouvrent pas", () => {
  it("laisse un espace personnel d'autrui inaccessible", async () => {
    const id = "space-prive-1";
    h.state.spaces = [espacePrive(id)];

    expect(await permission("alice", id)).toBeNull();
  });

  it("renvoie null pour un espace inexistant", async () => {
    const id = "space-fantome";

    expect(await permission("alice", id)).toBeNull();
  });
});

describe("absence de cache de permissions", () => {
  it("ne mélange pas deux utilisateurs sur le même espace", async () => {
    const id = "space-cache-1";
    h.state.spaces = [espaceOrganisation(id)];

    expect(await permission("patronne", id)).toBe("admin");
    // Deuxième utilisateur, même espace : chaque utilisateur est évalué séparément.
    expect(await permission("alice", id)).toBe("editor");
    expect(await permission("etrangere", id)).toBeNull();
    // Et la valeur de la patronne n'a pas été écrasée.
    expect(await permission("patronne", id)).toBe("admin");
  });

  it("un retrait d'espace est effectif à l'appel suivant", async () => {
    const id = "space-retrait-1";
    h.state.spaces = [espacePrive(id)];
    h.state.spacePermissions = [{ spaceId: id, userId: "alice", level: "editor" }];
    expect(await permission("alice", id)).toBe("editor");

    h.state.spacePermissions = [];
    expect(await permission("alice", id)).toBeNull();
  });

  it("un retrait d'équipe est effectif à l'appel suivant", async () => {
    const id = "space-retrait-2";
    h.state.spaces = [espaceEquipe(id)];
    h.state.teamMembers = [{ teamId: EQUIPE, userId: "alice", role: "member" }];
    expect(await permission("alice", id)).not.toBeNull();

    h.state.teamMembers = [];
    expect(await permission("alice", id)).toBeNull();
  });

  it("un retrait d'organisation est effectif à l'appel suivant", async () => {
    const id = "space-retrait-3";
    h.state.spaces = [espaceOrganisation(id)];
    expect(await permission("alice", id)).toBe("editor");

    h.state.organizationMembers = h.state.organizationMembers.filter(
      (m: { userId: string }) => m.userId !== "alice"
    );
    expect(await permission("alice", id)).toBeNull();
  });
});
