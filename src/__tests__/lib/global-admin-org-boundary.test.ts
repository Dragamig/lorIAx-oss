/**
 * Non-régression AZ-06 (audit du 2026-08-19), arbitrage du mainteneur du
 * 2026-08-20 : le franchissement de la frontière d'organisation est réservé à
 * `super_admin`. `admin` devient un rôle borné aux organisations dont
 * l'utilisateur est réellement membre.
 *
 * Avant correctif, `users.globalRole` étant une colonne d'instance, être admin
 * d'un tenant revenait à être admin de tous : `resolveRequestOrg` sautait le
 * contrôle `organization_members`, et `getSpacePermission` rendait "admin" sur
 * n'importe quel espace de n'importe quelle organisation, cache compris.
 *
 * Ces tests exercent les VRAIES fonctions (aucun mock de `check-access` ni de
 * `resolve-request-org`), avec un faux client Drizzle qui répond table par
 * table. Chacun échouerait si le correctif était annulé : les cas « admin non
 * membre » repasseraient à "admin" / org résolue.
 */
import { describe, it, expect, beforeEach, vi } from "vitest";

const ORG_DEFAUT = "org-app";
const ORG_ACME = "org-acme";
const ORG_VICTIME = "org-victime";

const h = vi.hoisted(() => ({
  state: {
    userId: "",
    spaceId: "",
    users: [] as Array<{ id: string; globalRole: string }>,
    spaces: [] as Array<Record<string, unknown>>,
    spacePermissions: [] as Array<{ spaceId: string; userId: string; level: string }>,
    teamMembers: [] as Array<{ teamId: string; userId: string; role: string }>,
    organizationMembers: [] as Array<{ organizationId: string; userId: string; role: string }>,
    organizations: [] as Array<{ id: string; slug: string; isActive: boolean }>,
    /** Org demandée à `resolveRequestOrg` (le faux client n'a pas les clauses). */
    lookupOrgId: "",
    lookupSlug: "",
  },
}));

vi.mock("@/lib/db", async () => {
  const schema = await vi.importActual<typeof import("@/lib/db/schema")>("@/lib/db/schema");
  const schemaOrg = await vi.importActual<typeof import("@/lib/db/schema-org")>(
    "@/lib/db/schema-org"
  );
  const s = h.state;

  function rowsFor(table: unknown): unknown[] {
    if (table === schema.users) {
      return s.users.filter((u) => u.id === s.userId);
    }
    if (table === schema.spaces) {
      return s.spaces.filter((sp) => sp.id === s.spaceId);
    }
    if (table === schema.spacePermissions) {
      return s.spacePermissions.filter(
        (p) => p.spaceId === s.spaceId && p.userId === s.userId
      );
    }
    if (table === schema.teamMembers) {
      const space = s.spaces.find((sp) => sp.id === s.spaceId);
      return s.teamMembers.filter(
        (m) => m.userId === s.userId && m.teamId === space?.ownerTeamId
      );
    }
    if (table === schema.organizationMembers || table === schemaOrg.organizationMembers) {
      return s.organizationMembers.filter(
        (m) => m.userId === s.userId && m.organizationId === s.lookupOrgId
      );
    }
    if (table === schema.organizations || table === schemaOrg.organizations) {
      // Volontairement PAS de filtre `isActive` ici : le refus d'une
      // organisation désactivée est une décision de `resolveRequestOrg`, et
      // c'est elle qui est mise à l'épreuve.
      return s.organizations.filter((o) => o.slug === s.lookupSlug);
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

// `getDefaultOrgId` désigne l'organisation partagée par défaut (tenant
// mutualisé `app`). Mocké pour ne pas dépendre de l'ordre de création des
// lignes dans le faux client.
vi.mock("@/lib/org/get-org-id", () => ({
  getDefaultOrgId: async () => "org-app",
}));

import { getSpacePermission } from "@/lib/auth/check-access";
import { resolveRequestOrg } from "@/lib/org/resolve-request-org";
import { canCrossOrgBoundary } from "@/lib/auth/rbac";

/** Espace privé d'un tiers : aucun repli d'appartenance ne peut s'appliquer. */
function espace(id: string, organizationId: string) {
  return {
    id,
    ownerUserId: "quelquun-dautre",
    ownerTeamId: null,
    type: "personal",
    classification: "internal",
    organizationId,
  };
}

async function permission(userId: string, spaceId: string, orgId: string) {
  h.state.userId = userId;
  h.state.spaceId = spaceId;
  h.state.lookupOrgId = orgId;
  h.state.lookupSlug = "";
  return getSpacePermission(userId, spaceId);
}

beforeEach(() => {
  const s = h.state;
  s.users = [
    { id: "admin-acme", globalRole: "admin" },
    { id: "super", globalRole: "super_admin" },
    { id: "membre", globalRole: "editor" },
  ];
  s.spaces = [];
  s.spacePermissions = [];
  s.teamMembers = [];
  s.organizationMembers = [
    { organizationId: ORG_ACME, userId: "admin-acme", role: "admin" },
    { organizationId: ORG_ACME, userId: "membre", role: "member" },
  ];
  // La première org active est l'organisation par défaut (tenant mutualisé).
  s.organizations = [
    { id: ORG_DEFAUT, slug: "app", isActive: true },
    { id: ORG_ACME, slug: "acme", isActive: true },
    { id: ORG_VICTIME, slug: "victime", isActive: true },
  ];
  s.lookupOrgId = "";
  s.lookupSlug = "";
});

describe("canCrossOrgBoundary", () => {
  it("n'accorde le franchissement qu'à super_admin", () => {
    expect(canCrossOrgBoundary("super_admin")).toBe(true);
    expect(canCrossOrgBoundary("admin")).toBe(false);
    expect(canCrossOrgBoundary("editor")).toBe(false);
    expect(canCrossOrgBoundary("viewer")).toBe(false);
  });
});

describe("getSpacePermission — dispense du rôle global bornée à l'organisation", () => {
  it("n'accorde RIEN à un admin global sur un espace d'une organisation dont il n'est pas membre", async () => {
    const id = "space-victime";
    h.state.spaces = [espace(id, ORG_VICTIME)];

    expect(await permission("admin-acme", id, ORG_VICTIME)).toBeNull();
  });

  it("accorde toujours admin à un admin global dans SON organisation", async () => {
    const id = "space-acme";
    h.state.spaces = [espace(id, ORG_ACME)];

    expect(await permission("admin-acme", id, ORG_ACME)).toBe("admin");
  });

  // Revue adversariale du lot 6 (2026-08-20). La dispense était bornée par
  // `isOrgMember`, qui rend TOUJOURS vrai sur l'organisation partagée par
  // défaut : un `admin` d'un tenant isolé y conservait donc l'administration
  // de tous les espaces, classification `secret` comprise, alors que c'est
  // cette organisation qui porte les vraies données de production. La
  // dispense de RÔLE exige désormais une vraie ligne `organization_members`,
  // sans le raccourci d'ouverture du tenant mutualisé.
  it("n'accorde plus la dispense de rôle sur le tenant mutualisé à un admin qui n'y a pas de ligne d'appartenance", async () => {
    const id = "space-mutualise";
    h.state.spaces = [espace(id, ORG_DEFAUT)];

    expect(await permission("admin-acme", id, ORG_DEFAUT)).toBeNull();
  });

  it("accorde la dispense sur le tenant mutualisé à un admin qui y a bien sa ligne d'appartenance", async () => {
    const id = "space-mutualise-2";
    h.state.spaces = [espace(id, ORG_DEFAUT)];
    h.state.organizationMembers.push({
      organizationId: ORG_DEFAUT,
      userId: "admin-acme",
      role: "member",
    });

    expect(await permission("admin-acme", id, ORG_DEFAUT)).toBe("admin");
  });

  it("laisse l'accès ORDINAIRE au tenant mutualisé intact : un espace d'organisation reste ouvert à ses membres", async () => {
    const id = "space-mutualise-3";
    h.state.spaces = [
      {
        id,
        ownerUserId: "quelquun-dautre",
        ownerTeamId: null,
        type: "organization",
        classification: "internal",
        organizationId: ORG_DEFAUT,
      },
    ];
    h.state.organizationMembers.push({
      organizationId: ORG_DEFAUT,
      userId: "membre",
      role: "member",
    });

    expect(await permission("membre", id, ORG_DEFAUT)).toBe("editor");
  });

  it("conserve le franchissement à super_admin, qui administre l'instance", async () => {
    const id = "space-victime-2";
    h.state.spaces = [espace(id, ORG_VICTIME)];

    expect(await permission("super", id, ORG_VICTIME)).toBe("admin");
  });

  it("ne met pas en cache un « admin » usurpé : un second appel refuse toujours", async () => {
    const id = "space-victime-3";
    h.state.spaces = [espace(id, ORG_VICTIME)];

    expect(await permission("admin-acme", id, ORG_VICTIME)).toBeNull();
    // Sans invalidation cette fois : c'est bien la valeur mise en cache qui est relue.
    h.state.userId = "admin-acme";
    h.state.spaceId = id;
    h.state.lookupOrgId = ORG_VICTIME;
    expect(await getSpacePermission("admin-acme", id)).toBeNull();
  });

  it("ne change rien pour un utilisateur ordinaire sans permission", async () => {
    const id = "space-acme-2";
    h.state.spaces = [espace(id, ORG_ACME)];

    expect(await permission("membre", id, ORG_ACME)).toBeNull();
  });
});

describe("resolveRequestOrg — appartenance exigée de l'admin global", () => {
  async function resolve(userId: string, slug: string, canCrossOrg: boolean) {
    h.state.userId = userId;
    h.state.lookupSlug = slug;
    h.state.lookupOrgId = h.state.organizations.find((o) => o.slug === slug)?.id ?? "";
    return resolveRequestOrg(slug, { id: userId, canCrossOrg });
  }

  it("refuse une organisation isolée à un admin global qui n'en est pas membre", async () => {
    expect(await resolve("admin-acme", "victime", canCrossOrgBoundary("admin"))).toBeNull();
  });

  it("résout l'organisation isolée d'un membre", async () => {
    const org = await resolve("membre", "acme", canCrossOrgBoundary("editor"));
    expect(org?.orgId).toBe(ORG_ACME);
  });

  it("résout n'importe quelle organisation isolée pour un super_admin", async () => {
    const org = await resolve("super", "victime", canCrossOrgBoundary("super_admin"));
    expect(org?.orgId).toBe(ORG_VICTIME);
  });

  // Écart n°1 de la revue adversariale du lot 6 : `resolveCurrentOrg`, la
  // copie privée de cette règle dans `requireOrgScoped`, ne lisait pas
  // `is_active`. Les deux chemins de résolution doivent refuser une
  // organisation suspendue, sans quoi la suspension d'un tenant ne vaut que
  // pour la moitié des routes. Le pendant `requireOrgScoped` est couvert par
  // `tests/lib/auth/require-org-scoped.test.ts`.
  it("refuse une organisation désactivée à son propre membre", async () => {
    h.state.organizations = h.state.organizations.map((o) =>
      o.slug === "acme" ? { ...o, isActive: false } : o
    );
    expect(await resolve("membre", "acme", canCrossOrgBoundary("editor"))).toBeNull();
  });

  it("refuse une organisation désactivée même à un super_admin", async () => {
    h.state.organizations = h.state.organizations.map((o) =>
      o.slug === "victime" ? { ...o, isActive: false } : o
    );
    expect(await resolve("super", "victime", canCrossOrgBoundary("super_admin"))).toBeNull();
  });
});
