/**
 * AZ-18 : GET /api/search, passe calendrier
 *
 * Dans la branche admin, la condition `space_id IS NULL` élargissait la
 * recherche à toutes les entités sans espace, dont les calendriers PERSONNELS,
 * sans aucun filtre d'organisation : un admin remontait des événements de
 * calendriers personnels d'utilisateurs d'autres tenants.
 *
 * Le test inspecte le SQL réellement soumis pour la passe calendrier et vérifie
 * qu'un calendrier personnel n'est retenu que si son propriétaire est membre de
 * l'organisation de la requête.
 *
 * FACTURE DU HARNAIS. Les doublures conservent l'implémentation réelle des
 * exports non pilotés (`importOriginal`) et pilotent AUSSI `getOrgId` /
 * `getOrgSlugFromHeaders`, la voie de résolution d'organisation d'avant le lot.
 * L'organisation courante est décrite une seule fois (`h.orgCourante`) et les
 * deux voies en dérivent, de sorte que rétablir la route dans sa version
 * d'avant le lot fait rougir sur une ASSERTION, jamais sur un export manquant
 * ou sur une résolution qui lève.
 */
import { describe, it, expect, vi, beforeEach } from "vitest";
import { NextRequest } from "next/server";

const h = vi.hoisted(() => ({
  // Organisation résolue pour la requête courante, null = aucune
  orgCourante: "org-a" as string | null,
  // Espion sur `db.execute` : c'est par là que passent toutes les passes SQL
  execute: vi.fn((_requete?: unknown) => Promise.resolve({ rows: [] as unknown[] })),
}));

/**
 * Faux client Drizzle générique : il ne présume ni du nombre ni de l'ordre des
 * requêtes, toute chaîne se termine sur une liste vide. Tout est défini dans
 * la fabrique elle-même, aucune variable de module n'est capturée.
 */
vi.mock("@/lib/db", () => {
  const chaine = () => {
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const self: any = {
      from: () => self,
      innerJoin: () => self,
      leftJoin: () => self,
      where: () => self,
      orderBy: () => self,
      groupBy: () => self,
      set: () => self,
      values: () => self,
      limit: () => Promise.resolve([]),
      returning: () => Promise.resolve([]),
      then: (resoudre: (v: unknown[]) => void, rejeter?: (e: unknown) => void) =>
        Promise.resolve([] as unknown[]).then(resoudre, rejeter),
    };
    return self;
  };
  return {
    db: {
      execute: (requete: unknown) => h.execute(requete),
      select: () => chaine(),
      update: () => chaine(),
      delete: () => chaine(),
      insert: () => chaine(),
    },
  };
});

const dbExecute = h.execute;

// Module réel non rechargé : il tire next-auth, non chargeable sous vitest.
vi.mock("@/lib/auth/get-user", () => ({ getSessionUser: vi.fn() }));

vi.mock("@/lib/org/get-request-org", async (importOriginal) => ({
  ...(await importOriginal<typeof import("@/lib/org/get-request-org")>()),
  getRequestOrgId: vi.fn(),
}));

// Voie de résolution d'avant le lot : slug depuis les en-têtes puis traduction
// en identifiant. `getOrgId` rend `null` quand aucune organisation n'est
// résolue, ce qui reproduit fidèlement la branche « pas de filtre » de
// l'implémentation d'origine.
vi.mock("@/lib/org/get-org-id", async (importOriginal) => ({
  ...(await importOriginal<typeof import("@/lib/org/get-org-id")>()),
  getOrgSlugFromHeaders: vi.fn(async () => "tenant-a"),
  getOrgId: vi.fn(async () => h.orgCourante),
}));

vi.mock("@/lib/auth/check-access", async (importOriginal) => ({
  ...(await importOriginal<typeof import("@/lib/auth/check-access")>()),
  getAccessibleSpaceIds: vi.fn(),
  isGlobalAdmin: vi.fn(),
}));

vi.mock("@/lib/ai/embeddings", async (importOriginal) => ({
  ...(await importOriginal<typeof import("@/lib/ai/embeddings")>()),
  isEmbeddingConfiguredAsync: vi.fn().mockResolvedValue(false),
  searchSemantic: vi.fn().mockResolvedValue([]),
}));

vi.mock("@/lib/ai/rerank", async (importOriginal) => ({
  ...(await importOriginal<typeof import("@/lib/ai/rerank")>()),
  rerankCandidates: vi.fn(async (_q: string, items: unknown[]) => items),
}));

import { getSessionUser } from "@/lib/auth/get-user";
import { getRequestOrgId } from "@/lib/org/get-request-org";
import { getAccessibleSpaceIds, isGlobalAdmin } from "@/lib/auth/check-access";

const mockUser = vi.mocked(getSessionUser);
const mockOrgId = vi.mocked(getRequestOrgId);
const mockSpaces = vi.mocked(getAccessibleSpaceIds);
const mockAdmin = vi.mocked(isGlobalAdmin);

/** Décrit l'organisation courante pour les deux voies de résolution. */
function poserOrg(orgId: string | null) {
  h.orgCourante = orgId;
  mockOrgId.mockResolvedValue(orgId as never);
}

/** Aplatit une requête Drizzle en son texte SQL, paramètres remplacés. */
function texteSql(chunk: unknown): string {
  if (chunk === null || chunk === undefined) return "";
  if (typeof chunk !== "object") return `{${String(chunk)}}`;
  const obj = chunk as Record<string, unknown>;
  if (Array.isArray(obj.queryChunks)) {
    return obj.queryChunks.map((c) => texteSql(c)).join("");
  }
  if (Array.isArray(obj.value)) return obj.value.join("");
  if (typeof obj.value === "string") return `{${obj.value}}`;
  return "";
}

/** SQL de la passe calendrier parmi toutes les requêtes soumises. */
function sqlCalendrier(): string {
  const requetes = dbExecute.mock.calls
    .map((c) => texteSql(c[0]))
    .filter((t) => t.includes("calendar_events"));
  expect(requetes).toHaveLength(1);
  return requetes[0].replace(/\s+/g, " ");
}

beforeEach(() => {
  vi.clearAllMocks();
  dbExecute.mockResolvedValue({ rows: [] } as never);
  mockUser.mockResolvedValue({
    id: "user-admin",
    name: "Admin",
    email: "admin@org-a.com",
    globalRole: "admin",
  } as never);
  poserOrg("org-a");
  mockSpaces.mockResolvedValue([] as never);
  mockAdmin.mockReturnValue(true as never);
});

const req = () => new NextRequest("http://localhost/api/search?q=reunion&rerank=0");

describe("GET /api/search : cloisonnement de la passe calendrier", () => {
  it("borne les calendriers personnels aux membres de l'organisation (branche admin)", async () => {
    const { GET } = await import("@/app/api/search/route");
    const res = await GET(req() as never);
    expect(res.status).toBe(200);

    const sql = sqlCalendrier();
    // L'organisation de la requête est bien le paramètre du filtre.
    expect(sql).toContain("{org-a}");
    // Les calendriers personnels passent par l'appartenance du propriétaire.
    expect(sql).toContain("organization_members");
    expect(sql).toContain("c.owner_user_id IN");
    // Plus aucune branche n'accepte un calendrier sans espace sans condition
    // supplémentaire : `space_id IS NULL` n'est jamais suivi d'un `OR`.
    expect(sql).not.toMatch(/c\.space_id IS NULL OR/);
  });

  it("borne aussi les calendriers personnels pour un utilisateur non admin", async () => {
    mockAdmin.mockReturnValue(false as never);
    mockSpaces.mockResolvedValue(["space-1"] as never);
    const { GET } = await import("@/app/api/search/route");
    await GET(req() as never);

    const sql = sqlCalendrier();
    expect(sql).toContain("organization_members");
    expect(sql).not.toMatch(/c\.space_id IS NULL OR/);
  });

  it("répond 404 sans interroger la base quand aucune organisation n'est résolue", async () => {
    poserOrg(null);
    const { GET } = await import("@/app/api/search/route");
    const res = await GET(req() as never);
    expect(res.status).toBe(404);
    expect(dbExecute).not.toHaveBeenCalled();
  });
});
