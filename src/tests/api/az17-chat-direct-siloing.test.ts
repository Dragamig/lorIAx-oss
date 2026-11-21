/**
 * AZ-17 : POST /api/chat/channels/direct
 *
 * La création d'une conversation directe ne contraignait pas la cible aux
 * membres de l'organisation courante : un attaquant ouvrait un canal vers un
 * compte d'un autre tenant, et la différence entre « utilisateur introuvable »
 * et « canal créé » fournissait un oracle d'existence de comptes.
 *
 * Propriété vérifiée ici : la réponse est STRICTEMENT identique (statut et
 * corps) pour un identifiant inexistant et pour l'identifiant d'un membre d'un
 * autre tenant, et aucun canal n'est créé dans les deux cas.
 *
 * FACTURE DU HARNAIS. Le faux client Drizzle répond PAR TABLE et non par rang
 * d'appel : l'implémentation d'avant le lot interrogeait `users` puis
 * `organization_members`, celle d'après n'interroge plus ni l'une ni l'autre
 * depuis la route. Les deux séquences traversent donc le même harnais, et
 * rétablir la route dans sa version d'avant le lot fait rougir sur une
 * ASSERTION, jamais sur un `db.select is not a function`.
 */
import { describe, it, expect, vi, beforeEach } from "vitest";
import { NextRequest } from "next/server";

const DRIZZLE_NAME = Symbol.for("drizzle:Name");

const h = vi.hoisted(() => ({
  // Annuaire GLOBAL de l'instance, tous tenants confondus. `user-autre-tenant`
  // est un compte parfaitement existant, simplement membre d'un autre tenant :
  // c'est ce qui rend l'oracle d'existence observable.
  utilisateursGlobaux: ["user-a", "user-b", "user-autre-tenant"],
  // Cible du dernier appel, renseignée par le constructeur de requête : le
  // faux client n'a pas accès aux clauses `where`.
  cibleCourante: "",
  transaction: vi.fn(),
  insert: vi.fn(),
}));

vi.mock("@/lib/db", () => {
  const nomTable = (table: unknown): string =>
    (table as Record<symbol, string> | null | undefined)?.[DRIZZLE_NAME] ?? "";

  const lignesPour = (table: unknown): unknown[] => {
    switch (nomTable(table)) {
      case "users":
        return h.utilisateursGlobaux.includes(h.cibleCourante)
          ? [{ id: h.cibleCourante }]
          : [];
      case "organization_members":
        // L'appelant (`user-a`) est bien membre d'une organisation.
        return [{ organizationId: "org-a", userId: "user-a", role: "member" }];
      default:
        return [];
    }
  };

  const chaine = (table?: unknown) => {
    let lignes: unknown[] = table === undefined ? [] : lignesPour(table);
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const self: any = {
      from: (t: unknown) => {
        lignes = lignesPour(t);
        return self;
      },
      innerJoin: () => self,
      where: () => self,
      set: () => self,
      values: () => self,
      orderBy: () => self,
      limit: () => Promise.resolve(lignes),
      returning: () => Promise.resolve(lignes),
      then: (resoudre: (v: unknown[]) => void, rejeter?: (e: unknown) => void) =>
        Promise.resolve(lignes).then(resoudre, rejeter),
    };
    return self;
  };

  return {
    db: {
      select: () => chaine(),
      update: (t: unknown) => chaine(t),
      delete: (t: unknown) => chaine(t),
      insert: (...args: unknown[]) => {
        h.insert(...args);
        return chaine(args[0]);
      },
      transaction: (...args: unknown[]) => h.transaction(...args),
      execute: () => Promise.resolve({ rows: [] }),
    },
  };
});

// Module réel non rechargé : il tire next-auth, non chargeable sous vitest.
vi.mock("@/lib/auth/get-user", () => ({
  getSessionUser: vi.fn(),
}));

vi.mock("@/lib/org/get-request-org", async (importOriginal) => ({
  ...(await importOriginal<typeof import("@/lib/org/get-request-org")>()),
  getRequestOrgId: vi.fn(),
}));

vi.mock("@/lib/org/org-members", async (importOriginal) => ({
  ...(await importOriginal<typeof import("@/lib/org/org-members")>()),
  getOrgMemberIds: vi.fn(),
}));

import { getSessionUser } from "@/lib/auth/get-user";
import { getRequestOrgId } from "@/lib/org/get-request-org";
import { getOrgMemberIds } from "@/lib/org/org-members";

const mockUser = vi.mocked(getSessionUser);
const mockOrgId = vi.mocked(getRequestOrgId);
const mockMembers = vi.mocked(getOrgMemberIds);
const dbTransaction = h.transaction;
const dbInsert = h.insert;

const req = (targetUserId: string) => {
  h.cibleCourante = targetUserId;
  return new NextRequest("http://localhost/api/chat/channels/direct", {
    method: "POST",
    body: JSON.stringify({ targetUserId }),
    headers: { "content-type": "application/json" },
  });
};

beforeEach(() => {
  vi.clearAllMocks();
  h.cibleCourante = "";
  mockUser.mockResolvedValue({
    id: "user-a",
    name: "Alice",
    email: "alice@org-a.com",
    globalRole: "editor",
  } as never);
  mockOrgId.mockResolvedValue("org-a");
  // Seuls Alice et Bob appartiennent à l'organisation courante.
  mockMembers.mockResolvedValue(["user-a", "user-b"]);
});

describe("POST /api/chat/channels/direct : cloisonnement de la cible", () => {
  it("refuse une cible d'un autre tenant sans créer de canal", async () => {
    const { POST } = await import("@/app/api/chat/channels/direct/route");
    const res = await POST(req("user-autre-tenant") as never);
    expect(res.status).toBe(404);
    expect(dbTransaction).not.toHaveBeenCalled();
    expect(dbInsert).not.toHaveBeenCalled();
  });

  it("répond exactement la même chose pour un compte inexistant et pour un compte d'un autre tenant (oracle fermé)", async () => {
    const { POST } = await import("@/app/api/chat/channels/direct/route");

    const resInexistant = await POST(req("00000000-0000-0000-0000-000000000000") as never);
    const corpsInexistant = await resInexistant.json();

    const resAutreTenant = await POST(req("user-autre-tenant") as never);
    const corpsAutreTenant = await resAutreTenant.json();

    expect(resInexistant.status).toBe(resAutreTenant.status);
    expect(corpsInexistant).toEqual(corpsAutreTenant);
    expect(dbTransaction).not.toHaveBeenCalled();
  });

  it("répond 404 sans effet de bord quand aucune organisation n'est résolue (fail-closed)", async () => {
    mockOrgId.mockResolvedValue(null);
    const { POST } = await import("@/app/api/chat/channels/direct/route");
    const res = await POST(req("user-b") as never);
    expect(res.status).toBe(404);
    expect(dbTransaction).not.toHaveBeenCalled();
  });

  it("crée le canal pour une cible membre de l'organisation courante", async () => {
    dbTransaction.mockResolvedValue("channel-1");
    const { POST } = await import("@/app/api/chat/channels/direct/route");
    const res = await POST(req("user-b") as never);
    expect(res.status).toBe(200);
    expect(await res.json()).toEqual({ id: "channel-1" });
    expect(dbTransaction).toHaveBeenCalledTimes(1);
    expect(mockMembers).toHaveBeenCalledWith("org-a");
  });
});
