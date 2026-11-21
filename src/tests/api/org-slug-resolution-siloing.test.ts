/**
 * Non-régression : classe de défauts « `getOrgId` en contexte authentifié »
 * (constat du lot 2 de la remédiation, absent du rapport d'audit).
 *
 * `getOrgId` traduit le slug d'organisation porté par le sous-domaine en
 * identifiant, sans le moindre contrôle d'appartenance. Le cookie de session
 * étant valide sur tous les sous-domaines, Mallory, membre du seul tenant
 * `acme`, rejouait ses requêtes sur `https://victime.example.com` et agissait
 * sur les données du tenant `victime`. Le cas le plus grave est
 * `POST /api/spaces` : Mallory créait un espace dans l'organisation du client
 * victime, s'en déclarait propriétaire et consommait son quota de licence.
 *
 * Les routes visées résolvent désormais l'organisation par `getRequestOrgId`,
 * qui exige l'appartenance (seul `super_admin` franchit la frontière
 * d'organisation depuis AZ-06) et rend `null` en fail-closed. `null` est
 * traduit en 404, jamais en 403 : l'existence d'une organisation tierce ne
 * doit pas être révélée.
 *
 * Motif de vérification, repris de `studio-images-siloing.test.ts` : « répond
 * 404 ET ne fait rien ». Le faux client Drizzle compte les accès, et l'absence
 * d'effet de bord est prouvée par le non-appel de `db.insert`, `db.update`,
 * `db.delete` et `db.execute`. Chaque bloc de refus est doublé d'un chemin
 * passant, pour que la suite ne soit pas vraie par vacuité.
 */
import { describe, it, expect, vi, beforeEach } from "vitest";
import { NextRequest } from "next/server";

const h = vi.hoisted(() => ({
  getSessionUser: vi.fn(),
  getAccessibleSpaceIds: vi.fn(),
  getOrgMemberIds: vi.fn(),
  isEmbeddingConfiguredAsync: vi.fn(),
  initRepository: vi.fn(),
  createSpaceChannel: vi.fn(),
  createTeamChannel: vi.fn(),
  ensureTeamCalendar: vi.fn(),
  checkSpacesLimit: vi.fn(),
  orgSlug: "victime",
  selectQueue: [] as unknown[][],
  insertQueue: [] as unknown[][],
  executeQueue: [] as unknown[][],
  selectCalls: { count: 0 },
  insertCalls: { count: 0 },
  updateCalls: { count: 0 },
  deleteCalls: { count: 0 },
  executeCalls: { count: 0 },
}));

/**
 * Chaîne Drizzle factice : chaque méthode se renvoie elle-même et l'objet est
 * « thenable », donc un `await` fonctionne à n'importe quelle profondeur
 * (`.from().where().limit()`, `.from().where().orderBy()`, `.values().returning()`).
 */
function chain(rows: unknown[]) {
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const self: any = {
    then: (resolve: (v: unknown[]) => void, reject?: (e: unknown) => void) =>
      Promise.resolve(rows).then(resolve, reject),
  };
  for (const methode of [
    "from",
    "innerJoin",
    "leftJoin",
    "where",
    "set",
    "values",
    "orderBy",
    "groupBy",
    "limit",
    "offset",
    "returning",
    "onConflictDoNothing",
  ]) {
    self[methode] = vi.fn(() => self);
  }
  return self;
}

vi.mock("@/lib/auth/get-user", () => ({ getSessionUser: h.getSessionUser }));
vi.mock("@/lib/auth/check-access", () => ({
  getAccessibleSpaceIds: h.getAccessibleSpaceIds,
  getSpacePermission: vi.fn().mockResolvedValue(null),
  isGlobalAdmin: (u: { globalRole?: string }) =>
    u?.globalRole === "admin" || u?.globalRole === "super_admin",
}));
vi.mock("@/lib/db", () => ({
  db: {
    select: vi.fn(() => {
      const rows = h.selectQueue[h.selectCalls.count] ?? [];
      h.selectCalls.count += 1;
      return chain(rows);
    }),
    selectDistinct: vi.fn(() => {
      const rows = h.selectQueue[h.selectCalls.count] ?? [];
      h.selectCalls.count += 1;
      return chain(rows);
    }),
    insert: vi.fn(() => {
      const rows = h.insertQueue[h.insertCalls.count] ?? [];
      h.insertCalls.count += 1;
      return chain(rows);
    }),
    update: vi.fn(() => {
      h.updateCalls.count += 1;
      return chain([]);
    }),
    delete: vi.fn(() => {
      h.deleteCalls.count += 1;
      return chain([]);
    }),
    execute: vi.fn(async () => {
      const rows = h.executeQueue[h.executeCalls.count] ?? [];
      h.executeCalls.count += 1;
      return { rows };
    }),
  },
}));
vi.mock("next/headers", () => ({
  headers: vi.fn().mockResolvedValue({
    // Mallory rejoue ses requêtes sur le sous-domaine du tenant visé.
    get: (k: string) => (k === "x-org-slug" ? h.orgSlug : null),
  }),
}));
vi.mock("@/lib/git/repository", () => ({ initRepository: h.initRepository }));
vi.mock("@/lib/activity", () => ({ logActivity: vi.fn() }));
vi.mock("@/lib/chat/channel-hooks", () => ({
  createSpaceChannel: h.createSpaceChannel,
  createTeamChannel: h.createTeamChannel,
}));
vi.mock("@/lib/onboarding/progress", () => ({
  recordOnboardingEvent: vi.fn().mockResolvedValue(undefined),
  initProgress: vi.fn().mockResolvedValue(undefined),
}));
vi.mock("@/lib/calendar/auto-provision", () => ({ ensureTeamCalendar: h.ensureTeamCalendar }));
vi.mock("@/lib/org/org-members", () => ({ getOrgMemberIds: h.getOrgMemberIds }));
vi.mock("@/lib/ai/embeddings", () => ({
  isEmbeddingConfiguredAsync: h.isEmbeddingConfiguredAsync,
  searchSemantic: vi.fn().mockResolvedValue([]),
}));
vi.mock("@/lib/ai/rerank", () => ({ rerankCandidates: vi.fn(async (_q, items) => items) }));
vi.mock("@/lib/logger", () => ({
  default: { error: vi.fn(), warn: vi.fn(), info: vi.fn(), debug: vi.fn() },
}));

import { GET as spacesGet, POST as spacesPost } from "@/app/api/spaces/route";
import { GET as graphGet } from "@/app/api/graph/route";
import { GET as searchGet } from "@/app/api/search/route";
import { GET as statusGet } from "@/app/api/team/status/route";
import { GET as teamsGet, POST as teamsPost } from "@/app/api/admin/teams/route";
import { registerHooks, resetHooksForTests } from "@/lib/modules/hooks";
import { beforeEach as hooksBeforeEach } from "vitest";
hooksBeforeEach(() => {
  resetHooksForTests();
  registerHooks({ usage: { checkUsersLimit: async () => { throw new Error('unused'); }, checkSpacesLimit: (...a: unknown[]) => h.checkSpacesLimit(...a), getOrgStorageLimitBytes: async () => null } });
});


/** Mallory est membre du seul tenant `acme`, jamais du tenant `victime`. */
const MALLORY = { id: "mallory", email: "mallory@acme.tld", globalRole: "user" };

/**
 * Un `admin` global, mais étranger à l'organisation `victime`. Depuis AZ-06 le
 * rôle `admin` ne dispense plus de l'appartenance : seul `super_admin` franchit
 * la frontière d'organisation.
 */
const ADMIN_ETRANGER = { id: "admin-acme", email: "admin@acme.tld", globalRole: "admin" };

/**
 * Requêtes émises par `getRequestOrgId` avant tout accès métier :
 * organisation par défaut, organisation du slug, ligne d'appartenance.
 */
const REQUETES_HELPER = 3;

/** L'organisation `victime` existe et est active, mais sans ligne d'appartenance. */
function queueNonMembre() {
  h.selectQueue.length = 0;
  h.selectQueue.push([{ id: "org-default" }]);
  h.selectQueue.push([{ id: "org-victime", slug: "victime", isActive: true }]);
  h.selectQueue.push([]);
  h.selectCalls.count = 0;
}

/** Membre légitime de l'organisation visée, puis lignes métier attendues. */
function queueMembre(...suite: unknown[][]) {
  h.selectQueue.length = 0;
  h.selectQueue.push([{ id: "org-default" }]);
  h.selectQueue.push([{ id: "org-victime", slug: "victime", isActive: true }]);
  h.selectQueue.push([{ organizationId: "org-victime" }]);
  for (const rows of suite) h.selectQueue.push(rows);
  h.selectCalls.count = 0;
}

function attendreAucunEffetDeBord() {
  expect(h.insertCalls.count).toBe(0);
  expect(h.updateCalls.count).toBe(0);
  expect(h.deleteCalls.count).toBe(0);
  expect(h.executeCalls.count).toBe(0);
  expect(h.initRepository).not.toHaveBeenCalled();
  expect(h.createSpaceChannel).not.toHaveBeenCalled();
  expect(h.createTeamChannel).not.toHaveBeenCalled();
}

function jsonRequest(url: string, methode: string, corps: unknown) {
  return new NextRequest(url, {
    method: methode,
    body: JSON.stringify(corps),
    headers: { "Content-Type": "application/json" },
  });
}

beforeEach(() => {
  vi.clearAllMocks();
  h.orgSlug = "victime";
  h.selectQueue.length = 0;
  h.insertQueue.length = 0;
  h.executeQueue.length = 0;
  h.selectCalls.count = 0;
  h.insertCalls.count = 0;
  h.updateCalls.count = 0;
  h.deleteCalls.count = 0;
  h.executeCalls.count = 0;
  h.getSessionUser.mockResolvedValue(MALLORY);
  h.getAccessibleSpaceIds.mockResolvedValue([]);
  h.getOrgMemberIds.mockResolvedValue([]);
  h.isEmbeddingConfiguredAsync.mockResolvedValue(false);
  h.initRepository.mockResolvedValue(undefined);
  h.createSpaceChannel.mockResolvedValue(undefined);
  h.createTeamChannel.mockResolvedValue(undefined);
  h.ensureTeamCalendar.mockResolvedValue(undefined);
  h.checkSpacesLimit.mockResolvedValue({ exceeded: false, current: 0, max: 10 });
});

describe("POST /api/spaces : création dans l'organisation d'un tiers", () => {
  it("répond 404 et ne crée AUCUN espace chez le tenant victime", async () => {
    queueNonMembre();

    const res = await spacesPost(
      jsonRequest("http://victime.example.com/api/spaces", "POST", {
        name: "Espace détourné",
        type: "team",
      })
    );

    expect(res.status).toBe(404);
    // Le cœur du défaut : aucune ligne `spaces` ne part en base, donc aucun
    // quota de licence du tenant victime n'est consommé.
    expect(h.insertCalls.count).toBe(0);
    // Le quota n'est même pas interrogé : le refus précède toute logique métier.
    expect(h.checkSpacesLimit).not.toHaveBeenCalled();
    expect(h.selectCalls.count).toBe(REQUETES_HELPER);
    attendreAucunEffetDeBord();
  });

  it("refuse avant même de valider le corps de la requête", async () => {
    queueNonMembre();

    const res = await spacesPost(
      jsonRequest("http://victime.example.com/api/spaces", "POST", { name: "" })
    );

    // 404 d'organisation, pas 400 : l'autorisation passe avant la validation.
    expect(res.status).toBe(404);
    attendreAucunEffetDeBord();
  });

  it("chemin passant : un membre de l'organisation crée bien son espace", async () => {
    queueMembre();
    h.insertQueue.push([{ id: "space-1", slug: "mon-espace", name: "Mon espace" }]);

    const res = await spacesPost(
      jsonRequest("http://victime.example.com/api/spaces", "POST", {
        name: "Mon espace",
        type: "personal",
      })
    );

    expect(res.status).toBe(201);
    expect(h.insertCalls.count).toBe(1);
    expect(h.initRepository).toHaveBeenCalledTimes(1);
  });
});

describe("GET /api/spaces : liste des espaces d'un tiers", () => {
  it("répond 404 et ne lit aucun espace du tenant victime", async () => {
    queueNonMembre();

    const res = await spacesGet();

    expect(res.status).toBe(404);
    expect(await res.json()).toEqual({ error: "Organisation introuvable" });
    // Aucune requête au-delà de celles du helper : la table n'est pas lue.
    expect(h.selectCalls.count).toBe(REQUETES_HELPER);
    attendreAucunEffetDeBord();
  });

  it("chemin passant : un membre reçoit bien les espaces de son organisation", async () => {
    queueMembre(
      [], // équipes de l'utilisateur
      [], // permissions d'espace
      [{ id: "space-1", name: "Mon espace", classification: "internal", ownerUserId: null }]
    );

    const res = await spacesGet();

    expect(res.status).toBe(200);
    const corps = await res.json();
    expect(corps).toHaveLength(1);
    expect(corps[0].id).toBe("space-1");
  });
});

describe("GET /api/graph : graphe documentaire d'un tiers", () => {
  it("répond 404 et ne renvoie aucun nœud du tenant victime", async () => {
    queueNonMembre();

    const res = await graphGet(new NextRequest("http://victime.example.com/api/graph"));

    expect(res.status).toBe(404);
    expect(await res.json()).toEqual({ nodes: [], edges: [] });
    expect(h.selectCalls.count).toBe(REQUETES_HELPER);
    attendreAucunEffetDeBord();
  });

  it("chemin passant : un membre reçoit le graphe de ses espaces", async () => {
    queueMembre(
      [{ id: "doc-1", title: "Note", spaceId: "space-1", slug: "note" }],
      [] // liens
    );
    h.getAccessibleSpaceIds.mockResolvedValue(["space-1"]);

    const res = await graphGet(new NextRequest("http://victime.example.com/api/graph"));

    expect(res.status).toBe(200);
    const corps = await res.json();
    expect(corps.nodes).toHaveLength(1);
    expect(corps.nodes[0].id).toBe("doc-1");
  });
});

describe("GET /api/search : recherche dans les données d'un tiers", () => {
  it("répond 404 et n'exécute aucune requête de recherche", async () => {
    queueNonMembre();

    const res = await searchGet(
      new NextRequest("http://victime.example.com/api/search?q=salaires&rerank=0")
    );

    expect(res.status).toBe(404);
    expect(await res.json()).toEqual({ results: [] });
    // Aucune des passes (plein texte, ILIKE, titres, calendrier) n'est lancée :
    // rien du tenant victime n'a pu être lu, ni fuité par un extrait.
    expect(h.executeCalls.count).toBe(0);
    expect(h.selectCalls.count).toBe(REQUETES_HELPER);
    attendreAucunEffetDeBord();
  });

  it("chemin passant : un membre obtient bien ses résultats", async () => {
    queueMembre();
    h.getAccessibleSpaceIds.mockResolvedValue(["space-1"]);
    h.executeQueue.push([
      {
        id: "doc-1",
        title: "Salaires 2026",
        slug: "salaires",
        space_slug: "rh",
        space_name: "RH",
        content_text: "grille des salaires",
        rank: "0.9",
      },
    ]);

    const res = await searchGet(
      new NextRequest("http://victime.example.com/api/search?q=salaires&rerank=0")
    );

    expect(res.status).toBe(200);
    const corps = await res.json();
    expect(corps.results.map((r: { id: string }) => r.id)).toContain("doc-1");
  });
});

describe("GET /api/team/status : annuaire de présence d'un tiers", () => {
  it("répond 404 et n'expose aucun membre du tenant victime", async () => {
    queueNonMembre();

    const res = await statusGet();

    expect(res.status).toBe(404);
    const corps = await res.json();
    expect(corps.members).toBeUndefined();
    expect(h.getOrgMemberIds).not.toHaveBeenCalled();
    expect(h.selectCalls.count).toBe(REQUETES_HELPER);
    attendreAucunEffetDeBord();
  });

  it("chemin passant : un membre voit bien ses coéquipiers", async () => {
    queueMembre(
      [{ teamId: "team-1" }], // équipes de l'utilisateur
      [{ userId: "bob" }], // membres des équipes
      [{ id: "bob", name: "Bob", email: "bob@victime.tld", avatarUrl: null }],
      [], // statuts
      [], // événements de calendrier
      [] // réunions en cours
    );

    const res = await statusGet();

    expect(res.status).toBe(200);
    const corps = await res.json();
    expect(corps.members).toHaveLength(1);
    expect(corps.members[0].userId).toBe("bob");
  });
});

describe("/api/admin/teams : administrateur global étranger à l'organisation", () => {
  beforeEach(() => {
    h.getSessionUser.mockResolvedValue(ADMIN_ETRANGER);
  });

  it("GET répond 404 et ne liste aucune équipe du tenant victime", async () => {
    queueNonMembre();

    const res = await teamsGet();

    expect(res.status).toBe(404);
    expect(h.selectCalls.count).toBe(REQUETES_HELPER);
    attendreAucunEffetDeBord();
  });

  it("POST répond 404 et ne crée ni équipe, ni espace, ni canal", async () => {
    queueNonMembre();

    const res = await teamsPost(
      jsonRequest("http://victime.example.com/api/admin/teams", "POST", {
        name: "Équipe détournée",
      })
    );

    expect(res.status).toBe(404);
    expect(h.insertCalls.count).toBe(0);
    expect(h.ensureTeamCalendar).not.toHaveBeenCalled();
    attendreAucunEffetDeBord();
  });

  it("chemin passant : un administrateur membre liste bien ses équipes", async () => {
    queueMembre([{ id: "team-1", name: "RH", description: null, createdBy: "x", memberCount: 2 }]);

    const res = await teamsGet();

    expect(res.status).toBe(200);
    const corps = await res.json();
    expect(corps).toHaveLength(1);
    expect(corps[0].id).toBe("team-1");
  });
});
