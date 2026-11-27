/**
 * Cloisonnement de toutes les routes CRM du lot 7 contre la vraie base (schéma rh_l7_siloing).
 * La garde de route n'est PAS simulée : requireCrm, requireOrgScoped, resolveRequestOrg et
 * hasOrgMembershipRow lisent la base. Seuls la session, le juge de permission d'espace
 * (getSpacePermission), la disponibilité d'instance du module et le dispatch d'automatismes
 * sont simulés. `CRM_READ_ROUTES` et `CRM_WRITE_ROUTES` sont la liste que toute nouvelle route
 * CRM doit rejoindre (un test compare la liste aux fichiers `route.ts`).
 */
import { describe, it, expect, vi, beforeAll, afterAll, beforeEach, afterEach } from "vitest";
import { NextRequest } from "next/server";
import { readdirSync, statSync, readFileSync } from "node:fs";
import { join } from "node:path";
import { randomUUID } from "node:crypto";
import type { PermissionLevel } from "@/types";
import { setupCrmFixture, seedCrmBases, type CrmFixture, type SeededCrm } from "./crm-fixture";

const h = vi.hoisted(() => ({
  db: undefined as unknown,
  user: null as { id: string; globalRole: string } | null,
  levels: {} as Record<string, Record<string, PermissionLevel>>,
  moduleOff: new Set<string>(),
  dispatch: vi.fn(),
}));

vi.mock("@/lib/db", () => ({
  db: new Proxy({}, { get: (_t, k) => (h.db as Record<string | symbol, unknown>)[k] }),
}));
vi.mock("@/lib/auth/get-user", () => ({
  getSessionUser: vi.fn(async () => (h.user ? { ...h.user, name: "T", email: "t@x.fr" } : null)),
}));
vi.mock("@/lib/auth/check-access", () => ({
  getSpacePermission: async (userId: string, spaceId: string) => h.levels[userId]?.[spaceId] ?? null,
}));
vi.mock("@/lib/modules/enablement", () => ({
  isModuleActive: vi.fn(async (_id: string, orgId?: string | null) => !h.moduleOff.has(orgId ?? "")),
}));
vi.mock("@/lib/automations/dispatch-row-events", () => ({ dispatchRowEvents: h.dispatch }));
vi.mock("@/lib/crm/access", async (importOriginal) => {
  const actual = await importOriginal<typeof import("@/lib/crm/access")>();
  return { ...actual, requireCrm: vi.fn((...a: Parameters<typeof actual.requireCrm>) => actual.requireCrm(...a)) };
});

import { requireCrm } from "@/lib/crm/access";
import { loadCrmContext } from "../context";
import { loadRelances, countRelances } from "../relances";
import { GET as pipelineGET } from "@/app/api/crm/pipeline/route";
import { GET as relancesGET } from "@/app/api/crm/relances/route";
import { GET as relancesCountGET } from "@/app/api/crm/relances/count/route";
import { GET as contactsGET } from "@/app/api/crm/contacts/route";
import { GET as dossiersGET } from "@/app/api/crm/dossiers/route";
import { GET as dealGET } from "@/app/api/crm/deals/[rowId]/route";
import { GET as interactionsGET, POST as interactionsPOST } from "@/app/api/crm/deals/[rowId]/interactions/route";
import { POST as relancePOST } from "@/app/api/crm/deals/[rowId]/relance/route";

const URL = process.env.RELATIONS_TEST_DATABASE_URL;
const DB_NAME = URL ? new globalThis.URL(URL).pathname.replace(/^\//, "") : "";
if (URL && !DB_NAME.includes("test")) {
  throw new Error(`RELATIONS_TEST_DATABASE_URL doit viser une base de test, reçu "${DB_NAME}"`);
}

const NOT_FOUND = JSON.stringify({ error: "Introuvable" });
const MISSING = "00000000-0000-4000-8000-000000000000";

interface RouteCase {
  /** `METHOD chemin` tel que dérivé du dossier `src/app/api/crm`. */
  id: string;
  method: "GET" | "POST";
  path: (rowId: string) => string;
  call: (req: NextRequest, rowId: string) => Promise<Response>;
  body?: unknown;
}
const withRow = (rowId: string) => ({ params: Promise.resolve({ rowId }) });

export const CRM_READ_ROUTES: RouteCase[] = [
  { id: "GET pipeline", method: "GET", path: () => "/api/crm/pipeline", call: (r) => pipelineGET(r) },
  { id: "GET relances", method: "GET", path: () => "/api/crm/relances", call: (r) => relancesGET(r) },
  { id: "GET relances/count", method: "GET", path: () => "/api/crm/relances/count", call: (r) => relancesCountGET(r) },
  { id: "GET contacts", method: "GET", path: () => "/api/crm/contacts", call: (r) => contactsGET(r) },
  { id: "GET dossiers", method: "GET", path: () => "/api/crm/dossiers", call: (r) => dossiersGET(r) },
  { id: "GET deals/[rowId]", method: "GET", path: (id) => `/api/crm/deals/${id}`, call: (r, id) => dealGET(r, withRow(id)) },
  {
    id: "GET deals/[rowId]/interactions",
    method: "GET",
    path: (id) => `/api/crm/deals/${id}/interactions`,
    call: (r, id) => interactionsGET(r, withRow(id)),
  },
];
export const CRM_WRITE_ROUTES: RouteCase[] = [
  {
    id: "POST deals/[rowId]/interactions",
    method: "POST",
    path: (id) => `/api/crm/deals/${id}/interactions`,
    call: (r, id) => interactionsPOST(r, withRow(id)),
    body: { type: "Appel" },
  },
  {
    id: "POST deals/[rowId]/relance",
    method: "POST",
    path: (id) => `/api/crm/deals/${id}/relance`,
    call: (r, id) => relancePOST(r, withRow(id)),
    body: { done: true },
  },
];
const ALL_ROUTES = [...CRM_READ_ROUTES, ...CRM_WRITE_ROUTES];
const ROW_ROUTES = ALL_ROUTES.filter((r) => r.path("x").includes("/deals/"));

/** Routes du lot 6 (raccordement), couvertes par crm-siloing.integration.test.ts. */
const LOT6_ROUTES = new Set([
  "POST activate",
  "GET activate/preview",
  "GET connection",
  "PUT connection",
  "GET connection/candidates",
  "POST deactivate",
  "GET status",
]);

/** Fil d'activité : couvert par src/app/api/crm/activity/__tests__/route.test.ts. */
const ACTIVITY_ROUTES = new Set(["GET activity"]);

function routeFiles(dir: string, out: string[] = []): string[] {
  for (const name of readdirSync(dir)) {
    const p = join(dir, name);
    if (statSync(p).isDirectory()) {
      if (name !== "__tests__") routeFiles(p, out);
    } else if (name === "route.ts") out.push(p);
  }
  return out;
}

describe("liste des routes CRM", () => {
  it("chaque méthode exportée par un route.ts de src/app/api/crm est dans CRM_READ_ROUTES, CRM_WRITE_ROUTES le lot 6 ou le fil d'activité", () => {
    const root = join(process.cwd(), "src/app/api/crm");
    const found = new Set<string>();
    for (const file of routeFiles(root)) {
      const rel = file.slice(root.length + 1).replace(/\/?route\.ts$/, "");
      const code = readFileSync(file, "utf8");
      for (const m of code.matchAll(/export\s+async\s+function\s+(GET|POST|PUT|PATCH|DELETE)\b/g)) {
        found.add(`${m[1]} ${rel}`);
      }
    }
    const listed = new Set([...ALL_ROUTES.map((r) => r.id), ...LOT6_ROUTES, ...ACTIVITY_ROUTES]);
    expect([...found].filter((id) => !listed.has(id)).sort()).toEqual([]);
    expect([...listed].filter((id) => !found.has(id)).sort()).toEqual([]);
  });
});

describe.skipIf(!URL)("cloisonnement des routes CRM du lot 7 (Postgres)", () => {
  let fx: CrmFixture;
  let s: SeededCrm;
  let userB: string;
  let spaceC: string;
  let bDeal: string;
  let bContact: string;
  const bTitle = "Dossier B1";

  const req = (slug: string | null, method: string, path: string, body?: unknown, rawBody?: string) =>
    new NextRequest(`http://x${path}`, {
      method,
      headers: slug ? { "x-org-slug": slug } : {},
      body: rawBody !== undefined ? rawBody : body === undefined ? undefined : JSON.stringify(body),
    });
  const asUser = (id: string | null) => {
    h.user = id ? { id, globalRole: "viewer" } : null;
  };
  const run = (route: RouteCase, slug: string | null, rowId: string, body: unknown = route.body) =>
    route.call(req(slug, route.method, route.path(rowId), body), rowId);

  async function snapshot() {
    const rows = (await fx.pool.query("SELECT id, database_id, cells FROM user_database_rows ORDER BY id")).rows;
    const changes = (await fx.pool.query("SELECT id FROM database_row_changes ORDER BY id")).rows;
    return JSON.stringify({ rows, changes });
  }

  // État partagé restauré après chaque test (afterEach), jamais en ligne dans un test.
  let origConn: Record<string, unknown>;
  let origDbs: Record<string, unknown>[];
  let origRows: { id: string; cells: unknown }[];
  let origLevels: string;

  beforeAll(async () => {
    fx = await setupCrmFixture(URL!, "rh_l7_siloing", { tasks: true });
    h.db = fx.db;
    await fx.pool.query(`
      ALTER TABLE organizations
        ADD COLUMN is_active boolean NOT NULL DEFAULT true,
        ADD COLUMN created_at timestamptz NOT NULL DEFAULT now();
    `);
    // Organisation par défaut distincte (la plus ancienne) : A et B sont des organisations isolées.
    await fx.pool.query("INSERT INTO organizations (id, slug, name, created_at) VALUES ($1,'default','Def', now() - interval '1 day')", [
      randomUUID(),
    ]);
    s = await seedCrmBases(fx);
    h.levels = s.levels;
    await fx.pool.query("UPDATE user_database_columns SET config = $2 WHERE id = $1", [
      s.col["interactions.type"],
      JSON.stringify({ options: ["Appel", "Mail"] }),
    ]);

    // Organisation B peuplée : sa propre connexion, ses colonnes, ses lignes.
    userB = randomUUID();
    spaceC = randomUUID();
    await fx.pool.query("INSERT INTO users (id, name) VALUES ($1,'UserB')", [userB]);
    await fx.pool.query("INSERT INTO organization_members (organization_id, user_id, role) VALUES ($1,$2,'member')", [s.orgB, userB]);
    await fx.pool.query("INSERT INTO spaces (id, organization_id, name) VALUES ($1,$2,'Espace C')", [spaceC, s.orgA]);
    s.levels[userB] = { [s.spaceB]: "editor" };
    const q = fx.pool.query.bind(fx.pool);
    const newCol = async (dbId: string, name: string, type: string, position: number, config: object = {}) =>
      (
        await q(
          "INSERT INTO user_database_columns (database_id, name, type, position, config) VALUES ($1,$2,$3,$4,$5) RETURNING id",
          [dbId, name, type, position, JSON.stringify(config)],
        )
      ).rows[0].id as string;
    const bTitleCol = (await q("SELECT id FROM user_database_columns WHERE database_id = $1 AND name = 'Titre'", [s.foreign.dossiers])).rows[0].id as string;
    const bNom = await newCol(s.foreign.contacts, "Nom", "text", 0);
    const bStatut = await newCol(s.foreign.dossiers, "Statut", "select", 1, { options: ["Prospect", "Devis"] });
    const bMontant = await newCol(s.foreign.dossiers, "Montant", "number", 2);
    const bRelance = await newCol(s.foreign.dossiers, "Relance", "date", 3);
    const bContactCol = await newCol(s.foreign.dossiers, "Contact", "relation", 4, { targetDatabaseId: s.foreign.contacts });
    const bDate = await newCol(s.foreign.interactions, "Date", "date", 0);
    const bType = await newCol(s.foreign.interactions, "Type", "select", 1, { options: ["Appel"] });
    const bDossier = await newCol(s.foreign.interactions, "Dossier", "relation", 2, { targetDatabaseId: s.foreign.dossiers });
    const insertRow = async (dbId: string, cells: object, position: number) =>
      (await q("INSERT INTO user_database_rows (database_id, cells, position) VALUES ($1,$2,$3) RETURNING id", [dbId, JSON.stringify(cells), position]))
        .rows[0].id as string;
    bContact = await insertRow(s.foreign.contacts, { [bNom]: "Contact B1" }, 0);
    bDeal = await insertRow(
      s.foreign.dossiers,
      { [bTitleCol]: bTitle, [bStatut]: "Prospect", [bMontant]: 777, [bRelance]: "2020-01-01", [bContactCol]: [bContact] },
      1,
    );
    await insertRow(s.foreign.interactions, { [bDate]: "2026-11-01", [bType]: "Appel", [bDossier]: [bDeal] }, 0);
    await q(
      `INSERT INTO crm_connections (organization_id, enabled, contacts_database_id, deals_database_id,
        interactions_database_id, field_map) VALUES ($1, true, $2, $3, $4, $5)`,
      [
        s.orgB,
        s.foreign.contacts,
        s.foreign.dossiers,
        s.foreign.interactions,
        JSON.stringify({
          contacts: { nom: bNom },
          dossiers: { titre: bTitleCol, statut: bStatut, montant: bMontant, relance: bRelance, contact: bContactCol },
          interactions: { date: bDate, type: bType, dossier: bDossier },
        }),
      ],
    );

    origConn = (await q("SELECT * FROM crm_connections WHERE organization_id = $1", [s.orgA])).rows[0];
    origDbs = (await q("SELECT id, space_id, archived_at, deleted_at FROM user_databases")).rows;
    origRows = (await q("SELECT id, cells FROM user_database_rows")).rows;
    origLevels = JSON.stringify(s.levels);
  }, 60000);
  afterAll(async () => {
    await fx?.teardown();
  }, 60000);

  beforeEach(() => {
    asUser(s.editor);
    h.dispatch.mockClear();
    vi.mocked(requireCrm).mockClear();
  });
  afterEach(async () => {
    const q = fx.pool.query.bind(fx.pool);
    h.moduleOff.clear();
    for (const k of Object.keys(s.levels)) delete s.levels[k];
    Object.assign(s.levels, JSON.parse(origLevels));
    await q(
      `UPDATE crm_connections SET enabled = $2, contacts_database_id = $3, deals_database_id = $4,
        interactions_database_id = $5, field_map = $6 WHERE organization_id = $1`,
      [
        s.orgA,
        origConn.enabled,
        origConn.contacts_database_id,
        origConn.deals_database_id,
        origConn.interactions_database_id,
        JSON.stringify(origConn.field_map),
      ],
    );
    for (const d of origDbs) {
      await q("UPDATE user_databases SET space_id = $2, archived_at = $3, deleted_at = $4 WHERE id = $1", [
        d.id, d.space_id, d.archived_at, d.deleted_at,
      ]);
    }
    for (const r of origRows) await q("UPDATE user_database_rows SET cells = $2 WHERE id = $1", [r.id, JSON.stringify(r.cells)]);
    await q("DELETE FROM user_database_rows WHERE id <> ALL($1::uuid[])", [origRows.map((r) => r.id)]);
    await q("DELETE FROM user_database_views WHERE name LIKE 'Pipeline%'");
    await q("DELETE FROM tasks");
    await q("DELETE FROM database_row_changes");
  });

  describe("session absente", () => {
    it.each(ALL_ROUTES.map((r) => [r.id, r] as const))("%s : 401, rien d'écrit", async (_id, route) => {
      asUser(null);
      const before = await snapshot();
      const res = await run(route, "a", s.dossierIds[0]);
      expect(res.status).toBe(401);
      expect(await snapshot()).toBe(before);
      expect(h.dispatch).not.toHaveBeenCalled();
    });
  });

  describe("garde requireCrm", () => {
    it.each(ALL_ROUTES.map((r) => [r.id, r] as const))("%s : appelée avec level member, requireEnabled et la requête", async (_id, route) => {
      const request = req("a", route.method, route.path(s.dossierIds[0]), route.body);
      const res = await route.call(request, s.dossierIds[0]);
      expect(res.status).toBeLessThan(500);
      const calls = vi.mocked(requireCrm).mock.calls;
      expect(calls).toHaveLength(1);
      expect(calls[0][0]).toEqual({ level: "member", requireEnabled: true });
      expect(calls[0][1]).toBe(request);
    });
  });

  describe("404 uniforme", () => {
    type Scenario = { name: string; user: () => string; slug: string; setup?: () => Promise<void> };
    const q = (sql: string, p: unknown[] = []) => fx.pool.query(sql, p);
    const scenarios: Scenario[] = [
      { name: "utilisateur d'une autre organisation (slug de A)", user: () => userB, slug: "a" },
      { name: "utilisateur de A visant l'organisation B", user: () => s.editor, slug: "b" },
      {
        name: "module CRM désactivé pour l'organisation",
        user: () => s.editor,
        slug: "a",
        setup: async () => void h.moduleOff.add(s.orgA),
      },
      {
        name: "connexion désactivée",
        user: () => s.editor,
        slug: "a",
        setup: async () => void (await q("UPDATE crm_connections SET enabled = false WHERE organization_id = $1", [s.orgA])),
      },
      {
        name: "connexion incomplète (base Interactions non raccordée)",
        user: () => s.editor,
        slug: "a",
        setup: async () => void (await q("UPDATE crm_connections SET interactions_database_id = NULL WHERE organization_id = $1", [s.orgA])),
      },
      {
        name: "connexion incomplète (base Contacts non raccordée)",
        user: () => s.editor,
        slug: "a",
        setup: async () => void (await q("UPDATE crm_connections SET contacts_database_id = NULL WHERE organization_id = $1", [s.orgA])),
      },
      {
        name: "base Dossiers rendue illisible par retrait de permission",
        user: () => s.editor,
        slug: "a",
        setup: async () => {
          await q("UPDATE user_databases SET space_id = $2 WHERE id = $1", [s.bases.dossiers, spaceC]);
        },
      },
      {
        name: "base Contacts rendue illisible par retrait de permission",
        user: () => s.editor,
        slug: "a",
        setup: async () => void (await q("UPDATE user_databases SET space_id = $2 WHERE id = $1", [s.bases.contacts, spaceC])),
      },
      {
        name: "base Interactions rendue illisible par retrait de permission",
        user: () => s.editor,
        slug: "a",
        setup: async () => void (await q("UPDATE user_databases SET space_id = $2 WHERE id = $1", [s.bases.interactions, spaceC])),
      },
      { name: "membre de l'organisation sans aucun droit d'espace", user: () => s.outsider, slug: "a" },
      {
        name: "base Dossiers archivée",
        user: () => s.editor,
        slug: "a",
        setup: async () => void (await q("UPDATE user_databases SET archived_at = now() WHERE id = $1", [s.bases.dossiers])),
      },
      {
        name: "base Dossiers en corbeille",
        user: () => s.editor,
        slug: "a",
        setup: async () => void (await q("UPDATE user_databases SET deleted_at = now() WHERE id = $1", [s.bases.dossiers])),
      },
    ];

    describe.each(scenarios)("$name", (sc) => {
      it.each(ALL_ROUTES.map((r) => [r.id, r] as const))("%s : 404 au corps exact, rien d'écrit", async (_id, route) => {
        await sc.setup?.();
        asUser(sc.user());
        const before = await snapshot();
        const res = await run(route, sc.slug, s.dossierIds[0]);
        expect(res.status).toBe(404);
        expect(await res.text()).toBe(NOT_FOUND);
        expect(await snapshot()).toBe(before);
        expect(h.dispatch).not.toHaveBeenCalled();
      });
    });

    it("tous les corps 404 de tous les scénarios et de toutes les routes sont égaux entre eux", async () => {
      const bodies = new Set<string>();
      for (const sc of scenarios) {
        await sc.setup?.();
        asUser(sc.user());
        for (const route of ALL_ROUTES) bodies.add(await (await run(route, sc.slug, s.dossierIds[0])).text());
        // Remise à zéro entre scénarios (l'afterEach ne passe qu'à la fin du test).
        await fx.pool.query(
          "UPDATE crm_connections SET enabled = $2, contacts_database_id = $3, deals_database_id = $4, interactions_database_id = $5 WHERE organization_id = $1",
          [s.orgA, origConn.enabled, origConn.contacts_database_id, origConn.deals_database_id, origConn.interactions_database_id],
        );
        for (const d of origDbs) {
          await fx.pool.query("UPDATE user_databases SET space_id = $2, archived_at = $3, deleted_at = $4 WHERE id = $1", [
            d.id, d.space_id, d.archived_at, d.deleted_at,
          ]);
        }
        h.moduleOff.clear();
      }
      expect([...bodies]).toEqual([NOT_FOUND]);
    });
  });

  describe("lignes hors périmètre : même 404 que l'inexistant, aucune écriture", () => {
    const outside = () => ({
      "dossier de l'organisation B (slug de A)": () => bDeal,
      "contact de A (autre base)": () => s.contactIds[0],
      "interaction de A (autre base)": () => s.interactionIds[0],
      "uuid inexistant": () => MISSING,
      "identifiant non uuid": () => "pas-un-uuid",
    });
    describe.each(Object.entries(outside()))("%s", (_name, idOf) => {
      it.each(ROW_ROUTES.map((r) => [r.id, r] as const))("%s", async (_id, route) => {
        const before = await snapshot();
        const res = await run(route, "a", idOf());
        expect(res.status).toBe(404);
        expect(await res.text()).toBe(NOT_FOUND);
        expect(await snapshot()).toBe(before);
        expect(h.dispatch).not.toHaveBeenCalled();
      });
    });

    it("dossier de A demandé depuis l'organisation B par son propre utilisateur : 404, rien d'écrit", async () => {
      asUser(userB);
      const before = await snapshot();
      for (const route of ROW_ROUTES) {
        const res = await run(route, "b", s.dossierIds[0]);
        expect(res.status).toBe(404);
        expect(await res.text()).toBe(NOT_FOUND);
      }
      expect(await snapshot()).toBe(before);
    });

    it("viewer seul : lecture possible, toute écriture en 404 (jamais 403), rien d'écrit", async () => {
      asUser(s.viewer);
      for (const route of CRM_READ_ROUTES) expect((await run(route, "a", s.dossierIds[0])).status).toBe(200);
      const before = await snapshot();
      for (const route of CRM_WRITE_ROUTES) {
        const res = await run(route, "a", s.dossierIds[0]);
        expect(res.status).toBe(404);
        expect(await res.text()).toBe(NOT_FOUND);
      }
      expect(await snapshot()).toBe(before);
      expect(h.dispatch).not.toHaveBeenCalled();
    });
  });

  describe("organisation B peuplée : aucune fuite dans un sens ni dans l'autre", () => {
    const readsWithoutRow = CRM_READ_ROUTES.filter((r) => !r.path("x").includes("/deals/"));
    it.each(readsWithoutRow.map((r) => [r.id, r] as const))("%s : B ne voit que B, A ne voit que A", async (_id, route) => {
      asUser(userB);
      const resB = await run(route, "b", bDeal);
      expect(resB.status).toBe(200);
      const textB = await resB.text();
      expect(textB).not.toMatch(/Dossier [1-6]\b|Contact [1-4]\b|Contact B?1@|Espace A/);
      for (const id of [...s.dossierIds, ...s.contactIds, ...s.interactionIds, s.bases.dossiers, s.spaceA]) {
        expect(textB).not.toContain(id);
      }

      asUser(s.editor);
      const resA = await run(route, "a", s.dossierIds[0]);
      expect(resA.status).toBe(200);
      const textA = await resA.text();
      expect(textA).not.toContain(bTitle);
      expect(textA).not.toContain("Contact B1");
      for (const id of [bDeal, bContact, s.foreign.dossiers, s.spaceB]) expect(textA).not.toContain(id);
    });

    it("pipeline et fiche de B portent bien le dossier de B", async () => {
      asUser(userB);
      const pipe = await (await run(CRM_READ_ROUTES[0], "b", bDeal)).json();
      expect(pipe.deals.map((d: { title: string }) => d.title)).toContain(bTitle);
      const deal = await (await dealGET(req("b", "GET", `/api/crm/deals/${bDeal}`), withRow(bDeal))).json();
      expect(deal.deal.title).toBe(bTitle);
      expect(deal.contact.name).toBe("Contact B1");
    });
  });

  describe("données hétérogènes : jamais d'exception", () => {
    const setDeal = async (idx: number, cells: Record<string, unknown>) =>
      void (await fx.pool.query("UPDATE user_database_rows SET cells = cells || $2::jsonb WHERE id = $1", [
        s.dossierIds[idx],
        JSON.stringify(cells),
      ]));
    const allReads = async () => {
      for (const route of CRM_READ_ROUTES) {
        const res = await run(route, "a", s.dossierIds[0]);
        expect(res.status, route.id).toBe(200);
        const text = await res.text();
        expect(text).not.toContain("NaN");
        expect(text).not.toContain("Contact B1");
      }
    };

    it("contact pointant hors de la base Contacts (autre organisation, autre base) : fiche sans contact, aucune fuite", async () => {
      await setDeal(0, { [s.col["dossiers.contact"]]: [bContact] });
      await setDeal(1, { [s.col["dossiers.contact"]]: [s.dossierIds[2]] });
      await allReads();
      for (const idx of [0, 1]) {
        const body = await (await dealGET(req("a", "GET", `/api/crm/deals/${s.dossierIds[idx]}`), withRow(s.dossierIds[idx]))).json();
        expect(body.contact ?? null).toBeNull();
        expect(body.contactRow ?? null).toBeNull();
        expect(JSON.stringify(body)).not.toContain("Contact B1");
      }
      const pipe = await (await run(CRM_READ_ROUTES[0], "a", "")).json();
      const d0 = pipe.deals.find((d: { id: string }) => d.id === s.dossierIds[0]);
      expect(d0.contactName ?? null).toBeNull();
    });

    it("dossier sans contact (tableau vide, cellule absente, null) : toutes les lectures répondent", async () => {
      await setDeal(0, { [s.col["dossiers.contact"]]: [] });
      await setDeal(1, { [s.col["dossiers.contact"]]: null });
      await fx.pool.query("UPDATE user_database_rows SET cells = cells - $2 WHERE id = $1", [s.dossierIds[2], s.col["dossiers.contact"]]);
      await allReads();
      for (const idx of [0, 1, 2]) {
        const res = await dealGET(req("a", "GET", `/api/crm/deals/${s.dossierIds[idx]}`), withRow(s.dossierIds[idx]));
        expect(res.status).toBe(200);
        expect((await res.json()).contact ?? null).toBeNull();
      }
    });

    it("montant en texte, statut hors options, responsable vide, relance invalide : lectures 200", async () => {
      await setDeal(0, {
        [s.col["dossiers.montant"]]: "abc",
        [s.col["dossiers.statut"]]: "Inconnu",
        [s.col["dossiers.responsable"]]: [],
        [s.col["dossiers.relance"]]: "pas une date",
      });
      await setDeal(1, { [s.col["dossiers.montant"]]: null, [s.col["dossiers.statut"]]: null });
      await allReads();
    });
  });

  describe("ordre réel des contrôles sur les écritures : 404 avant 400", () => {
    const invalid = { bogus: 1 };
    it.each(CRM_WRITE_ROUTES.map((r) => [r.id, r] as const))("%s : ligne introuvable ou non permise en 404 même avec un corps invalide", async (_id, route) => {
      const before = await snapshot();
      for (const id of [MISSING, bDeal, s.contactIds[0], "pas-un-uuid"]) {
        for (const raw of [JSON.stringify(invalid), "{pas du json", ""]) {
          const res = await route.call(req("a", route.method, route.path(id), undefined, raw), id);
          expect(res.status, `${id} / ${raw}`).toBe(404);
          expect(await res.text()).toBe(NOT_FOUND);
        }
      }
      asUser(s.viewer);
      for (const raw of [JSON.stringify(invalid), "{pas du json"]) {
        const res = await route.call(req("a", route.method, route.path(s.dossierIds[0]), undefined, raw), s.dossierIds[0]);
        expect(res.status).toBe(404);
        expect(await res.text()).toBe(NOT_FOUND);
      }
      expect(await snapshot()).toBe(before);
      expect(h.dispatch).not.toHaveBeenCalled();
    });

    it.each(CRM_WRITE_ROUTES.map((r) => [r.id, r] as const))("%s : ligne permise avec un corps invalide ou illisible en 400, rien d'écrit", async (_id, route) => {
      const before = await snapshot();
      for (const raw of [JSON.stringify(invalid), "{pas du json", ""]) {
        const res = await route.call(req("a", route.method, route.path(s.dossierIds[0]), undefined, raw), s.dossierIds[0]);
        expect(res.status, raw).toBe(400);
        expect(await res.json()).toEqual({ error: "Paramètres invalides", code: "invalid_params" });
      }
      expect(await snapshot()).toBe(before);
      expect(h.dispatch).not.toHaveBeenCalled();
    });
  });

  describe("badge : count === late + today de la file « mes dossiers »", () => {
    const NOW = new Date("2026-11-18T12:00:00Z");
    const setRelance = async (idx: number, date: string | null) =>
      void (await fx.pool.query("UPDATE user_database_rows SET cells = cells || $2::jsonb WHERE id = $1", [
        s.dossierIds[idx],
        JSON.stringify({ [s.col["dossiers.relance"]]: date }),
      ]));
    const queue = async (user: string, mine: boolean) => {
      const ctx = await loadCrmContext(s.orgA, user, s.deps);
      expect(ctx).not.toBeNull();
      return loadRelances(ctx!, { horizon: 7, mine, now: NOW, tz: "Europe/Paris" }, s.deps);
    };
    const badge = async (user: string) => {
      const ctx = await loadCrmContext(s.orgA, user, s.deps);
      return countRelances(ctx!, { now: NOW, tz: "Europe/Paris" }, s.deps);
    };
    const seed = async () => {
      // Responsables : editor sur 0, 2, 4 ; viewer sur 1, 3, 5. Statuts : 3 Signé, 4 Perdu.
      await setRelance(0, "2026-11-17");
      await setRelance(1, "2026-11-18");
      await setRelance(2, "2026-11-18");
      await setRelance(3, "2026-11-10");
      await setRelance(4, "2026-11-12");
      await setRelance(5, "2026-11-25");
    };

    it("sans statuts clos : le badge égale late + today de la file « mes dossiers », pour chaque utilisateur", async () => {
      await seed();
      for (const user of [s.editor, s.viewer]) {
        const mine = await queue(user, true);
        expect(await badge(user)).toBe(mine.groups.late.length + mine.groups.today.length);
      }
      const all = await queue(s.editor, false);
      expect(all.groups.late.length + all.groups.today.length).toBeGreaterThan(await badge(s.editor));
    });

    it("avec une vue Pipeline aux statuts clos : dossiers clos exclus du badge comme de la file", async () => {
      await seed();
      await fx.pool.query(
        "INSERT INTO user_database_views (database_id, name, type, scope, position, config) VALUES ($1,'Pipeline A','kanban','shared',5,$2)",
        [
          s.bases.dossiers,
          JSON.stringify({ kanbanTotals: { amountColumnId: s.col["dossiers.montant"], closedLanes: ["Signé", "Perdu"], weights: {}, showWeighted: false } }),
        ],
      );
      const e = await queue(s.editor, true);
      const v = await queue(s.viewer, true);
      expect(e.groups.late.map((i) => i.title)).toEqual(["Dossier 1"]);
      expect(e.groups.today.map((i) => i.title)).toEqual(["Dossier 3"]);
      expect(v.groups.today.map((i) => i.title)).toEqual(["Dossier 2"]);
      expect(await badge(s.editor)).toBe(e.groups.late.length + e.groups.today.length);
      expect(await badge(s.editor)).toBe(2);
      expect(await badge(s.viewer)).toBe(v.groups.late.length + v.groups.today.length);
      expect(await badge(s.viewer)).toBe(1);
    });

    it("sans relance raccordée ni responsable : badge 0, file vide", async () => {
      await seed();
      await fx.pool.query("UPDATE crm_connections SET field_map = jsonb_set(field_map, '{dossiers,responsable}', 'null') WHERE organization_id = $1", [s.orgA]);
      expect(await badge(s.editor)).toBe(0);
    });
  });
});
