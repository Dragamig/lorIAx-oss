import { describe, it, expect, beforeEach, vi } from "vitest";

/**
 * Verrouille l'ALIMENTATION de `canViewSpaceContents`, pas la regle elle-meme
 * (couverte par space-access.test.ts). La regle pure peut etre parfaite et la
 * decision fausse quand même : une inversion entre `hasDirectPermission` et
 * `hasTeamPermission` dans la collecte, ou un `mayNeedOrg` mal conditionne, ne se
 * voit pas depuis les tests de la fonction pure.
 *
 * Les lectures Drizzle sont simulees par une file FIFO : chaque appel a
 * `db.select()` consomme le prochain jeu de lignes. `checkSpaceViewAccess` lit
 * toujours, et dans cet ordre : l'espace, les equipes de l'utilisateur, les
 * permissions d'espace.
 */

const rowQueue: unknown[][] = [];

function nextRows(): unknown[] {
  return rowQueue.shift() ?? [];
}

function makeChain(): Record<string, unknown> {
  const chain: Record<string, unknown> = {};
  const passthrough = () => chain;
  chain.from = passthrough;
  chain.where = passthrough;
  chain.limit = passthrough;
  chain.orderBy = passthrough;
  chain.then = (
    resolve: (v: unknown) => unknown,
    reject: (e: unknown) => unknown
  ) => Promise.resolve(nextRows()).then(resolve, reject);
  return chain;
}

vi.mock("@/lib/db", () => ({
  db: { select: () => makeChain() },
}));

/** Compte les resolutions d'organisation, pour verifier le conditionnement de mayNeedOrg. */
let orgLookups = 0;
const REQUEST_ORG_ID = "org-courante";

vi.mock("next/headers", () => ({
  headers: () => new Headers({ "x-org-slug": "acme" }),
}));

vi.mock("@/lib/org/get-org-id", () => ({
  getOrgSlugFromHeaders: async (headersFn: () => Headers | Promise<Headers>) =>
    (await headersFn()).get("x-org-slug") ?? "default",
  getOrgId: async () => {
    orgLookups += 1;
    return REQUEST_ORG_ID;
  },
}));

const { checkSpaceViewAccess, invalidateUserTeamCache } = await import(
  "@/lib/auth/check-access"
);

const USER = {
  id: "user-1",
  email: "u@example.test",
  name: "U",
  globalRole: "editor" as const,
};

interface SpaceRow {
  type: string;
  classification: string;
  ownerUserId: string | null;
  ownerTeamId: string | null;
  organizationId: string;
}

function spaceRow(overrides: Partial<SpaceRow> = {}): SpaceRow {
  return {
    type: "team",
    classification: "internal",
    ownerUserId: null,
    ownerTeamId: null,
    organizationId: REQUEST_ORG_ID,
    ...overrides,
  };
}

/** Enfile les trois lectures dans l'ordre ou la fonction les effectue. */
function queueReads(
  space: SpaceRow | null,
  teamIds: string[],
  perms: { userId: string | null; teamId: string | null }[]
) {
  rowQueue.length = 0;
  rowQueue.push(space ? [space] : []);
  rowQueue.push(teamIds.map((teamId) => ({ teamId })));
  rowQueue.push(perms);
}

beforeEach(() => {
  rowQueue.length = 0;
  orgLookups = 0;
  invalidateUserTeamCache(USER.id);
});

describe("checkSpaceViewAccess — collecte des faits", () => {
  it("un espace introuvable est refuse sans lire quoi que ce soit d'autre", async () => {
    queueReads(null, [], []);
    expect(await checkSpaceViewAccess(USER, "space-1")).toBe(false);
  });

  it("la propriete de l'espace est lue depuis ownerUserId", async () => {
    queueReads(spaceRow({ ownerUserId: USER.id }), [], []);
    expect(await checkSpaceViewAccess(USER, "space-1")).toBe(true);
  });

  it("un espace sans lien avec l'utilisateur est refuse", async () => {
    queueReads(spaceRow(), [], []);
    expect(await checkSpaceViewAccess(USER, "space-1")).toBe(false);
  });
});

/**
 * Ces deux cas sont le filet anti-inversion : le mode `publicApi` accepte la
 * permission directe et refuse la permission d'equipe. Intervertir les deux faits
 * dans l'enveloppe inverse les deux resultats.
 */
describe("checkSpaceViewAccess — permission directe et permission d'equipe", () => {
  it("une ligne portant userId alimente hasDirectPermission", async () => {
    queueReads(spaceRow(), ["team-1"], [{ userId: USER.id, teamId: null }]);
    expect(await checkSpaceViewAccess(USER, "space-1", "publicApi")).toBe(true);
  });

  it("une ligne portant teamId alimente hasTeamPermission, refusee par l'API publique", async () => {
    queueReads(spaceRow(), ["team-1"], [{ userId: null, teamId: "team-1" }]);
    expect(await checkSpaceViewAccess(USER, "space-1", "publicApi")).toBe(false);
  });

  it("la meme permission d'equipe ouvre l'application et le mode member", async () => {
    queueReads(spaceRow(), ["team-1"], [{ userId: null, teamId: "team-1" }]);
    expect(await checkSpaceViewAccess(USER, "space-1", "app")).toBe(true);

    invalidateUserTeamCache(USER.id);
    queueReads(spaceRow(), ["team-1"], [{ userId: null, teamId: "team-1" }]);
    expect(await checkSpaceViewAccess(USER, "space-1", "member")).toBe(true);
  });

  it("une permission accordee a une equipe dont l'utilisateur n'est pas membre ne compte pas", async () => {
    queueReads(spaceRow(), ["team-1"], [{ userId: null, teamId: "team-autre" }]);
    expect(await checkSpaceViewAccess(USER, "space-1", "app")).toBe(false);
  });
});

describe("checkSpaceViewAccess — appartenance a l'equipe proprietaire", () => {
  it("le membre de l'equipe proprietaire lit l'espace, sans aucune permission", async () => {
    queueReads(spaceRow({ ownerTeamId: "team-1" }), ["team-1"], []);
    expect(await checkSpaceViewAccess(USER, "space-1", "app")).toBe(true);
  });

  it("un non-membre de l'equipe proprietaire est refuse", async () => {
    queueReads(spaceRow({ ownerTeamId: "team-1" }), ["team-2"], []);
    expect(await checkSpaceViewAccess(USER, "space-1", "app")).toBe(false);
  });
});

describe("checkSpaceViewAccess — borne d'organisation", () => {
  it("un espace d'organisation de la meme organisation est lisible", async () => {
    queueReads(spaceRow({ type: "organization" }), [], []);
    expect(await checkSpaceViewAccess(USER, "space-1", "app")).toBe(true);
    expect(orgLookups).toBe(1);
  });

  it("un espace d'organisation d'un autre locataire est refuse", async () => {
    queueReads(spaceRow({ type: "organization", organizationId: "org-b" }), [], []);
    expect(await checkSpaceViewAccess(USER, "space-1", "app")).toBe(false);
  });

  it("la borne ne penalise pas le proprietaire d'un espace d'un autre locataire", async () => {
    queueReads(
      spaceRow({ type: "organization", organizationId: "org-b", ownerUserId: USER.id }),
      [],
      []
    );
    expect(await checkSpaceViewAccess(USER, "space-1", "app")).toBe(true);
  });

  it("la borne s'applique aussi a l'equipe proprietaire", async () => {
    queueReads(
      spaceRow({ ownerTeamId: "team-1", organizationId: "org-b" }),
      ["team-1"],
      []
    );
    expect(await checkSpaceViewAccess(USER, "space-1", "app")).toBe(false);
  });
});

/**
 * `mayNeedOrg` code en dur `mode === "app"`. Le couplage est correct aujourd'hui,
 * puisque `member` et `publicApi` n'atteignent aucune branche implicite, mais il est
 * implicite : ces cas le rendent visible et feront echouer toute ouverture d'une
 * branche implicite hors du mode `app` sans revision de la condition.
 */
describe("checkSpaceViewAccess — couplage mayNeedOrg / mode", () => {
  it("l'organisation n'est resolue que pour les espaces ou une branche implicite peut servir", async () => {
    queueReads(spaceRow({ type: "personal", ownerUserId: "autre" }), [], []);
    expect(await checkSpaceViewAccess(USER, "space-1", "app")).toBe(false);
    expect(orgLookups).toBe(0);
  });

  it("le mode member ne resout jamais l'organisation, et refuse la branche organisation", async () => {
    queueReads(spaceRow({ type: "organization" }), [], []);
    expect(await checkSpaceViewAccess(USER, "space-1", "member")).toBe(false);
    expect(orgLookups).toBe(0);
  });

  it("le mode publicApi ne resout jamais l'organisation non plus", async () => {
    queueReads(spaceRow({ type: "organization" }), [], []);
    expect(await checkSpaceViewAccess(USER, "space-1", "publicApi")).toBe(false);
    expect(orgLookups).toBe(0);
  });
});

describe("checkSpaceViewAccess — classification de l'espace", () => {
  it("un espace secret d'organisation reste ferme a l'appartenance implicite", async () => {
    queueReads(
      spaceRow({ type: "organization", classification: "secret" }),
      [],
      []
    );
    expect(await checkSpaceViewAccess(USER, "space-1", "app")).toBe(false);
    // L'organisation est tout de meme resolue : `mayNeedOrg` ne depend que de la FORME
    // de l'espace, jamais de l'issue de la regle. C'est deliberé, l'enveloppe ne doit
    // pas rejouer la decision pour savoir quoi lire, sans quoi la regle vivrait a deux
    // endroits. Le cout est une resolution mise en cache, la decision reste `false`.
    expect(orgLookups).toBe(1);
  });

  it("un membre nomme d'un espace secret le voit encore", async () => {
    queueReads(
      spaceRow({ type: "organization", classification: "secret" }),
      [],
      [{ userId: USER.id, teamId: null }]
    );
    expect(await checkSpaceViewAccess(USER, "space-1", "app")).toBe(true);
  });
});

describe("checkSpaceViewAccess — admin global", () => {
  it("un admin global lit l'espace sans permission ni borne d'organisation", async () => {
    queueReads(spaceRow({ type: "organization", organizationId: "org-b" }), [], []);
    const admin = { ...USER, globalRole: "admin" as const };
    expect(await checkSpaceViewAccess(admin, "space-1", "app")).toBe(true);
  });
});
