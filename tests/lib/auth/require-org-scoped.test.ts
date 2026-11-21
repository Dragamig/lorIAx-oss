import { describe, it, expect, vi, beforeEach } from "vitest";

// ─── Hoisted mocks (vi.hoisted pour rendre les refs accessibles aux factories) ─

const h = vi.hoisted(() => {
  const dbSelectQueue: unknown[][] = [];
  return {
    getSessionUser: vi.fn(),
    getSpacePermission: vi.fn(),
    headers: vi.fn(),
    dbSelectQueue,
    chainCallIndex: { v: 0 },
  };
});

function chain(rows: unknown[]) {
  return {
    from: vi.fn().mockReturnThis(),
    innerJoin: vi.fn().mockReturnThis(),
    where: vi.fn().mockReturnThis(),
    limit: vi.fn().mockResolvedValue(rows),
  };
}

vi.mock("@/lib/auth/get-user", () => ({ getSessionUser: h.getSessionUser }));
vi.mock("@/lib/auth/check-access", () => ({
  getSpacePermission: h.getSpacePermission,
  isGlobalAdmin: (u: { globalRole?: string }) =>
    u?.globalRole === "admin" || u?.globalRole === "super_admin",
}));
vi.mock("@/lib/db", () => ({
  db: {
    select: vi.fn(() => {
      const rows = h.dbSelectQueue[h.chainCallIndex.v] ?? [];
      h.chainCallIndex.v += 1;
      return chain(rows);
    }),
  },
}));
vi.mock("next/headers", () => ({ headers: h.headers }));
// `resolveCurrentOrg` délègue désormais à `resolveRequestOrg`, qui compare
// l'organisation résolue à l'organisation partagée par défaut. Seule cette
// lecture-là est doublée : la règle de résolution, elle, est exercée pour de
// vrai (plus de copie à aligner, cf. revue adversariale du lot 6).
vi.mock("@/lib/org/get-org-id", () => ({
  getDefaultOrgId: async () => "org-default",
}));

import { requireOrgScoped, OrgScopeError } from "@/lib/auth/require-org-scoped";

const USER = { id: "user-1", globalRole: "user" };
const USER_ADMIN = { id: "admin-1", globalRole: "admin" };
const USER_SUPER_ADMIN = { id: "super-1", globalRole: "super_admin" };

function queue(...chains: unknown[][]) {
  h.dbSelectQueue.length = 0;
  for (const c of chains) h.dbSelectQueue.push(c);
  h.chainCallIndex.v = 0;
}

beforeEach(() => {
  vi.clearAllMocks();
  queue();
  h.headers.mockResolvedValue({ get: (k: string) => (k === "x-org-slug" ? "acme" : null) });
});

describe("requireOrgScoped — auth & org resolution", () => {
  it("401 si non authentifié", async () => {
    h.getSessionUser.mockResolvedValue(null);
    await expect(requireOrgScoped()).rejects.toThrowError(OrgScopeError);
    // Chemin nominal : si `requireOrgScoped` cessait de lever, `expect.fail`
    // ferait échouer le test au lieu de le laisser passer silencieusement.
    try {
      await requireOrgScoped();
      expect.fail("requireOrgScoped aurait dû lever une OrgScopeError");
    } catch (e) {
      expect((e as OrgScopeError).reason).toBe("unauthenticated");
      expect((e as OrgScopeError).response.status).toBe(401);
    }
  });

  it("404 si org slug ne correspond à aucune org existante", async () => {
    h.getSessionUser.mockResolvedValue(USER);
    queue([]);
    try {
      await requireOrgScoped();
      expect.fail("requireOrgScoped aurait dû lever une OrgScopeError");
    } catch (e) {
      expect((e as OrgScopeError).reason).toBe("no-org");
      expect((e as OrgScopeError).response.status).toBe(404);
    }
  });

  it("404 si user pas membre de l'org demandée (slug existe pourtant)", async () => {
    h.getSessionUser.mockResolvedValue(USER);
    queue([{ id: "org-1", slug: "acme", isActive: true }], []);
    try {
      await requireOrgScoped();
      expect.fail("requireOrgScoped aurait dû lever une OrgScopeError");
    } catch (e) {
      expect((e as OrgScopeError).reason).toBe("no-org");
      expect((e as OrgScopeError).response.status).toBe(404);
    }
  });

  // Correctif AZ-06 (2026-08-20). Le rôle `admin` ne dispense plus
  // d'appartenance : `users.globalRole` est une colonne d'instance, et tant
  // qu'elle valait dispense, être admin d'une organisation revenait à être
  // admin de toutes. Seul `super_admin`, qui administre l'instance, franchit
  // encore la frontière d'organisation.
  it("un admin global sans membership n'obtient PLUS l'organisation", async () => {
    h.getSessionUser.mockResolvedValue(USER_ADMIN);
    queue([{ id: "org-1", slug: "acme", isActive: true }], []);
    try {
      await requireOrgScoped();
      expect.fail("requireOrgScoped aurait dû lever une OrgScopeError");
    } catch (e) {
      expect((e as OrgScopeError).reason).toBe("no-org");
      expect((e as OrgScopeError).response.status).toBe(404);
    }
  });

  it("un admin global membre de l'organisation la résout normalement", async () => {
    h.getSessionUser.mockResolvedValue(USER_ADMIN);
    queue([{ id: "org-1", slug: "acme", isActive: true }], [{ organizationId: "org-1" }]);
    const ctx = await requireOrgScoped();
    expect(ctx.orgId).toBe("org-1");
    expect(ctx.orgSlug).toBe("acme");
  });

  it("super_admin passe la résolution même sans membership", async () => {
    h.getSessionUser.mockResolvedValue(USER_SUPER_ADMIN);
    queue([{ id: "org-1", slug: "acme", isActive: true }]);
    const ctx = await requireOrgScoped();
    expect(ctx.orgId).toBe("org-1");
    expect(ctx.orgSlug).toBe("acme");
  });

  // Le repli « première organisation dont l'utilisateur est membre » a été
  // retiré avec la copie de la règle (revue adversariale du lot 6) : sans
  // sous-domaine, la requête est servie par l'organisation partagée par
  // défaut, exactement comme sur toutes les routes passées par
  // `getRequestOrgId`. Deux routes de la même requête ne peuvent plus
  // travailler sur deux organisations différentes.
  it("sans sous-domaine, rend l'organisation partagée par défaut (plus de repli divergent)", async () => {
    h.getSessionUser.mockResolvedValue(USER);
    h.headers.mockResolvedValue({ get: () => null });
    queue([{ id: "org-2", slug: "premiere-appartenance", isActive: true }]);
    const ctx = await requireOrgScoped();
    expect(ctx.orgId).toBe("org-default");
    expect(ctx.orgSlug).toBe("default");
  });

  it("idem quand le proxy pose explicitement le slug `default` (apex)", async () => {
    h.getSessionUser.mockResolvedValue(USER);
    h.headers.mockResolvedValue({
      get: (k: string) => (k === "x-org-slug" ? "default" : null),
    });
    queue();
    // Capture plutôt que `await` direct : sous l'ancienne règle, l'absence de
    // repli faisait lever `no-org`, et le test doit rougir sur une ASSERTION,
    // pas sur une exception qui remonte.
    const ctx = await requireOrgScoped().catch((e: unknown) => e);
    expect(ctx).not.toBeInstanceOf(OrgScopeError);
    expect((ctx as { orgId: string }).orgId).toBe("org-default");
  });

  // Écart n°1 trouvé par la revue adversariale : la copie sélectionnait
  // l'organisation par slug SANS lire `is_active`. Une organisation
  // désactivée, geste de suspension d'un tenant, restait donc servie par la
  // trentaine de routes branchées ici, alors que `getRequestOrgId` la
  // refusait déjà.
  it("404 sur une organisation désactivée, même pour un membre", async () => {
    h.getSessionUser.mockResolvedValue(USER);
    queue([{ id: "org-1", slug: "acme", isActive: false }], [{ organizationId: "org-1" }]);
    try {
      await requireOrgScoped();
      expect.fail("requireOrgScoped aurait dû lever une OrgScopeError");
    } catch (e) {
      expect((e as OrgScopeError).reason).toBe("no-org");
      expect((e as OrgScopeError).response.status).toBe(404);
    }
  });

  it("404 sur une organisation désactivée, même pour un super_admin", async () => {
    h.getSessionUser.mockResolvedValue(USER_SUPER_ADMIN);
    queue([{ id: "org-1", slug: "acme", isActive: false }]);
    try {
      await requireOrgScoped();
      expect.fail("requireOrgScoped aurait dû lever une OrgScopeError");
    } catch (e) {
      expect((e as OrgScopeError).reason).toBe("no-org");
    }
  });
});

describe("requireOrgScoped — resource validation (siloing)", () => {
  it("404 si on demande un space d'une autre org (cross-org access)", async () => {
    h.getSessionUser.mockResolvedValue(USER);
    queue(
      [{ id: "org-1", slug: "acme", isActive: true }],
      [{ organizationId: "org-1" }],
      [{ id: "space-X", organizationId: "org-OTHER" }]
    );
    try {
      await requireOrgScoped({ resource: { type: "space", id: "space-X" }, minPermission: "viewer" });
      expect.fail("requireOrgScoped aurait dû lever une OrgScopeError");
    } catch (e) {
      expect((e as OrgScopeError).reason).toBe("resource-not-found");
      expect((e as OrgScopeError).response.status).toBe(404);
    }
  });

  it("404 si on demande un space inexistant", async () => {
    h.getSessionUser.mockResolvedValue(USER);
    queue(
      [{ id: "org-1", slug: "acme", isActive: true }],
      [{ organizationId: "org-1" }],
      []
    );
    try {
      await requireOrgScoped({ resource: { type: "space", id: "nope" }, minPermission: "viewer" });
      expect.fail("requireOrgScoped aurait dû lever une OrgScopeError");
    } catch (e) {
      expect((e as OrgScopeError).reason).toBe("resource-not-found");
      expect((e as OrgScopeError).response.status).toBe(404);
    }
  });

  it("404 si on demande une database d'une autre org", async () => {
    h.getSessionUser.mockResolvedValue(USER);
    queue(
      [{ id: "org-1", slug: "acme", isActive: true }],
      [{ organizationId: "org-1" }],
      [{ spaceId: "space-A", organizationId: "org-OTHER" }]
    );
    try {
      await requireOrgScoped({ resource: { type: "database", id: "db-X" }, minPermission: "viewer" });
      expect.fail("requireOrgScoped aurait dû lever une OrgScopeError");
    } catch (e) {
      expect((e as OrgScopeError).reason).toBe("resource-not-found");
      expect((e as OrgScopeError).response.status).toBe(404);
    }
    // Le mismatch d'organisation est détecté avant toute lecture de la
    // permission d'espace : aucune fuite d'information sur l'existence d'une
    // permission dans une autre organisation.
    expect(h.getSpacePermission).not.toHaveBeenCalled();
  });

  it("OK si la database est bien dans l'org de l'user", async () => {
    h.getSessionUser.mockResolvedValue(USER);
    queue(
      [{ id: "org-1", slug: "acme", isActive: true }],
      [{ organizationId: "org-1" }],
      [{ spaceId: "space-A", organizationId: "org-1" }]
    );
    h.getSpacePermission.mockResolvedValue("editor");
    const ctx = await requireOrgScoped({ resource: { type: "database", id: "db-OK" }, minPermission: "viewer" });
    expect(ctx.spaceId).toBe("space-A");
    expect(ctx.permission).toBe("editor");
    expect(ctx.orgId).toBe("org-1");
  });
});

describe("requireOrgScoped — minPermission gate", () => {
  it("403 si permission insuffisante (viewer alors qu'on demande editor)", async () => {
    h.getSessionUser.mockResolvedValue(USER);
    queue(
      [{ id: "org-1", slug: "acme", isActive: true }],
      [{ organizationId: "org-1" }],
      [{ spaceId: "space-A", organizationId: "org-1" }]
    );
    h.getSpacePermission.mockResolvedValue("viewer");
    try {
      await requireOrgScoped({
        resource: { type: "database", id: "db-OK" },
        minPermission: "editor",
      });
      expect.fail("requireOrgScoped aurait dû lever une OrgScopeError");
    } catch (e) {
      expect((e as OrgScopeError).reason).toBe("permission-denied");
      expect((e as OrgScopeError).response.status).toBe(403);
    }
  });

  it("403 si pas de permission du tout sur le space (null)", async () => {
    h.getSessionUser.mockResolvedValue(USER);
    queue(
      [{ id: "org-1", slug: "acme", isActive: true }],
      [{ organizationId: "org-1" }],
      [{ spaceId: "space-A", organizationId: "org-1" }]
    );
    h.getSpacePermission.mockResolvedValue(null);
    try {
      await requireOrgScoped({
        resource: { type: "database", id: "db-OK" },
        minPermission: "viewer",
      });
      expect.fail("requireOrgScoped aurait dû lever une OrgScopeError");
    } catch (e) {
      expect((e as OrgScopeError).reason).toBe("permission-denied");
    }
  });

  it("OK admin > editor (rang supérieur)", async () => {
    h.getSessionUser.mockResolvedValue(USER);
    queue(
      [{ id: "org-1", slug: "acme", isActive: true }],
      [{ organizationId: "org-1" }],
      [{ spaceId: "space-A", organizationId: "org-1" }]
    );
    h.getSpacePermission.mockResolvedValue("admin");
    const ctx = await requireOrgScoped({
      resource: { type: "database", id: "db-OK" },
      minPermission: "editor",
    });
    expect(ctx.permission).toBe("admin");
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// Non-régression P0-4 / AZ-01 (audit 2026-08-19) : `minPermission` était
// optionnel, et 17 routes vérifiaient l'organisation sans jamais vérifier le
// droit d'accès à l'espace. Le type l'interdit désormais ; ces tests couvrent
// le garde-fou d'exécution, seul rempart pour un appelant non typé.
// ─────────────────────────────────────────────────────────────────────────────

/** Appel volontairement non typé, tel qu'il aurait été écrit avant le correctif. */
type UntypedCall = (options: Record<string, unknown>) => Promise<unknown>;
const callUntyped = requireOrgScoped as unknown as UntypedCall;

describe("requireOrgScoped — fail-closed sans minPermission", () => {
  it("403 sur une ressource de l'org quand l'appelant omet minPermission et que l'user n'a aucune permission", async () => {
    h.getSessionUser.mockResolvedValue(USER);
    queue(
      [{ id: "org-1", slug: "acme", isActive: true }],
      [{ organizationId: "org-1" }],
      [{ spaceId: "space-A", organizationId: "org-1" }]
    );
    h.getSpacePermission.mockResolvedValue(null);

    const err = await callUntyped({
      resource: { type: "database", id: "db-RH" },
    }).then(
      () => null,
      (e: unknown) => e
    );

    expect(err).toBeInstanceOf(OrgScopeError);
    expect((err as OrgScopeError).reason).toBe("permission-denied");
    expect((err as OrgScopeError).response.status).toBe(403);
    // La permission a bien été interrogée : le seuil implicite `viewer` s'applique.
    expect(h.getSpacePermission).toHaveBeenCalledWith("user-1", "space-A");
  });

  it("laisse passer un viewer légitime quand minPermission est omis", async () => {
    h.getSessionUser.mockResolvedValue(USER);
    queue(
      [{ id: "org-1", slug: "acme", isActive: true }],
      [{ organizationId: "org-1" }],
      [{ id: "space-A", organizationId: "org-1" }]
    );
    h.getSpacePermission.mockResolvedValue("viewer");

    const ctx = (await callUntyped({
      resource: { type: "space", id: "space-A" },
    })) as { spaceId?: string; permission?: string | null };

    expect(ctx.spaceId).toBe("space-A");
    expect(ctx.permission).toBe("viewer");
  });

  // Le cas « 404 avant tout contrôle de permission sur une ressource d'une
  // autre org » est déjà couvert plus haut par « 404 si on demande une
  // database d'une autre org » (résolution de la ressource, même sans
  // `minPermission` explicite : le mismatch d'organisation est détecté avant
  // toute lecture de permission, que l'appel soit typé ou non). Un doublon
  // littéral vivait ici avant ce lot ; il a été retiré au profit de celui
  // d'en-haut, enrichi de l'assertion `getSpacePermission` non appelée.

  it("un admin global ne contourne pas le seuil de permission d'espace", async () => {
    h.getSessionUser.mockResolvedValue(USER_ADMIN);
    queue(
      [{ id: "org-1", slug: "acme", isActive: true }],
      [{ organizationId: "org-1" }],
      [{ spaceId: "space-A", organizationId: "org-1" }]
    );
    h.getSpacePermission.mockResolvedValue(null);

    const err = await callUntyped({
      resource: { type: "database", id: "db-RH" },
    }).then(
      () => null,
      (e: unknown) => e
    );

    expect(err).toBeInstanceOf(OrgScopeError);
    expect((err as OrgScopeError).response.status).toBe(403);
  });
});
