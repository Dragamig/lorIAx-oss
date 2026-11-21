/**
 * Non-régression : cloisonnement de la supervision des automatisations
 * (`/api/admin/automations` et `/api/admin/automations/runs`), lot 6.
 *
 * Les deux routes gardaient le rôle `admin` et interrogeaient la base sans la
 * moindre clause d'organisation. Un admin lisait donc le nom, la
 * configuration et l'auteur avec son adresse électronique des automatisations
 * de tous les tenants, ainsi que leur historique d'exécution avec les messages
 * d'erreur, qui portent souvent des données métier.
 *
 * Choix de portée : ce ne sont PAS des ressources de portée instance. Une
 * automatisation appartient à une base (`user_databases`), qui appartient à un
 * espace (`spaces`), qui porte `organization_id`. Il y a donc quelque chose à
 * filtrer, et le corollaire de l'ADR-079 ne s'applique pas : on filtre, on ne
 * relève pas le rôle. L'organisation est résolue par `getRequestOrgId`, en
 * fail-closed, `null` valant 404.
 *
 * Motif de vérification : « répond 404 ET ne lit rien de global ». La présence
 * effective d'une clause d'organisation est prouvée par le comptage des appels
 * à `.where()` sur la requête de lecture, l'annulation du correctif rendant
 * ce compte nul.
 */
import { describe, it, expect, vi, beforeEach } from "vitest";

const h = vi.hoisted(() => ({
  getSessionUser: vi.fn(),
  getRequestOrgId: vi.fn(),
  rows: [] as unknown[],
  whereArgs: [] as unknown[],
}));

function chain(getRows: () => unknown[]) {
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const self: any = {
    then: (resolve: (v: unknown[]) => void, reject?: (e: unknown) => void) =>
      Promise.resolve(getRows()).then(resolve, reject),
  };
  for (const methode of ["from", "innerJoin", "leftJoin", "orderBy", "limit"]) {
    self[methode] = vi.fn(() => self);
  }
  self.where = vi.fn((arg: unknown) => {
    h.whereArgs.push(arg);
    return self;
  });
  return self;
}

/**
 * Vrai si la clause passée à `.where()` mentionne quelque part la colonne
 * `organization_id`. On parcourt l'arbre Drizzle (`queryChunks` imbriqués)
 * plutôt que de comparer des objets : c'est ce qui distingue une clause de
 * cloisonnement d'un simple filtre de statut.
 */
function mentionneOrganisation(noeud: unknown, vus = new Set<unknown>()): boolean {
  if (!noeud || typeof noeud !== "object") return false;
  if (vus.has(noeud)) return false;
  vus.add(noeud);
  const objet = noeud as Record<string, unknown>;
  if (objet.name === "organization_id") return true;
  for (const valeur of Object.values(objet)) {
    if (Array.isArray(valeur)) {
      if (valeur.some((v) => mentionneOrganisation(v, vus))) return true;
    } else if (mentionneOrganisation(valeur, vus)) {
      return true;
    }
  }
  return false;
}

vi.mock("@/lib/auth/get-user", () => ({ getSessionUser: h.getSessionUser }));
vi.mock("@/lib/org/get-request-org", () => ({ getRequestOrgId: h.getRequestOrgId }));
vi.mock("@/lib/db", () => ({
  db: { select: vi.fn(() => chain(() => h.rows)) },
}));

beforeEach(() => {
  vi.clearAllMocks();
  h.rows = [];
  h.whereArgs.length = 0;
  h.getSessionUser.mockResolvedValue({
    id: "admin-a",
    name: "Admin A",
    email: "admin@org-a.test",
    globalRole: "admin",
  });
  h.getRequestOrgId.mockResolvedValue("org-a");
});

describe("GET /api/admin/automations : cloisonnement", () => {
  it("la liste porte une clause d'organisation", async () => {
    h.rows = [{ id: "auto-1" }];

    const { GET } = await import("@/app/api/admin/automations/route");
    const res = await GET();

    expect(res.status).toBe(200);
    expect(h.whereArgs).toHaveLength(1);
    expect(mentionneOrganisation(h.whereArgs[0])).toBe(true);
  });

  it("404 et aucune lecture quand aucune organisation n'est résolue (fail-closed)", async () => {
    h.getRequestOrgId.mockResolvedValue(null);

    const { GET } = await import("@/app/api/admin/automations/route");
    const res = await GET();

    expect(res.status).toBe(404);
    expect((await res.json()).error).toBe("Organisation introuvable");
    expect(h.whereArgs).toHaveLength(0);
  });
});

describe("GET /api/admin/automations/runs : cloisonnement", () => {
  const req = (qs = "") =>
    new Request(`http://localhost/api/admin/automations/runs${qs}`);

  it("l'historique porte une clause d'organisation", async () => {
    h.rows = [{ id: "run-1" }];

    const { GET } = await import("@/app/api/admin/automations/runs/route");
    const res = await GET(req());

    expect(res.status).toBe(200);
    expect(h.whereArgs).toHaveLength(1);
    expect(mentionneOrganisation(h.whereArgs[0])).toBe(true);
  });

  it("la clause d'organisation survit au filtre de statut", async () => {
    h.rows = [{ id: "run-1" }];

    const { GET } = await import("@/app/api/admin/automations/runs/route");
    const res = await GET(req("?status=error"));

    expect(res.status).toBe(200);
    expect(h.whereArgs).toHaveLength(1);
    expect(mentionneOrganisation(h.whereArgs[0])).toBe(true);
  });

  it("404 et aucune lecture quand aucune organisation n'est résolue (fail-closed)", async () => {
    h.getRequestOrgId.mockResolvedValue(null);

    const { GET } = await import("@/app/api/admin/automations/runs/route");
    const res = await GET(req());

    expect(res.status).toBe(404);
    expect(h.whereArgs).toHaveLength(0);
  });
});
