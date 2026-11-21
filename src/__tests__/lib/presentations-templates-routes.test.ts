/**
 * Routes API des modèles de présentation (lot 3bis, T5).
 *
 * Les assertions portent sur les effets de bord (`db.update`, `uploadFile`,
 * `getFileJson`, `deleteFile`), pas seulement sur le statut, comme dans
 * `presentations-org-scope.test.ts`. La lib `templates.ts` et les gardes
 * `template-access.ts` sont réelles : seuls la base, S3, `requireOrgScoped` et
 * le garde de module sont des doublures.
 *
 * Preuves par mutation (retrait temporaire, test rouge, restauration, vert) :
 *   - contrôle d'admin retiré de `requireTemplateAdmin` : les tests « membre
 *     ne peut ni PATCH ni DELETE ni reset » échouent (200 au lieu de 403, et
 *     `db.update` appelé) ;
 *   - `hasGlobalRole` retiré de `templates/route.ts` (includeHidden figé à
 *     faux ou vrai) : le test sur l'argument de `listTemplates` échoue ;
 *   - `assertTemplateInOrg` retiré des routes [id] : le test « autre
 *     organisation » échoue (200 au lieu de 404, `getFileJson` appelé).
 */
import { describe, it, expect, beforeEach, vi } from "vitest";

const orgRole = vi.hoisted(() => vi.fn());
vi.mock("@/lib/presentations/org-role", () => ({ getOrgMemberRole: orgRole }));

const h = vi.hoisted(() => {
  class OrgScopeError extends Error {
    constructor(
      public readonly response: unknown,
      public readonly reason: string
    ) {
      super(reason);
    }
  }
  return {
    OrgScopeError,
    requireOrgScoped: vi.fn(),
    guard: vi.fn(),
    ligne: vi.fn(),
    liste: vi.fn(),
    insertion: vi.fn(),
    miseAJour: vi.fn(),
    suppression: vi.fn(),
    uploadFile: vi.fn(),
    getFileJson: vi.fn(),
    deleteFile: vi.fn(),
    sets: vi.fn(),
    listTemplates: vi.fn(),
  };
});

vi.mock("@/lib/auth/require-org-scoped", () => ({
  requireOrgScoped: h.requireOrgScoped,
  OrgScopeError: h.OrgScopeError,
}));

vi.mock("@/lib/db", () => {
  const chaine = (terminaux: Record<string, () => unknown>) => {
    const obj: Record<string, unknown> = {
      from: () => obj,
      where: () => obj,
      set: (v: unknown) => {
        h.sets(v);
        return obj;
      },
      values: () => obj,
      onConflictDoNothing: () => obj,
      then: (res: (v: unknown) => unknown) => Promise.resolve([]).then(res),
    };
    for (const [nom, fn] of Object.entries(terminaux)) {
      obj[nom] = () => Promise.resolve(fn());
    }
    return obj;
  };
  return {
    db: {
      select: () => chaine({ limit: () => h.ligne(), orderBy: () => h.liste() }),
      insert: () => chaine({ returning: () => h.insertion() }),
      update: () => chaine({ returning: () => h.miseAJour() }),
      delete: () => chaine({ returning: () => h.suppression() }),
    },
  };
});

vi.mock("@/lib/presentations/templates", async (importOriginal) => {
  const actual = await importOriginal<typeof import("@/lib/presentations/templates")>();
  h.listTemplates.mockImplementation(actual.listTemplates);
  return { ...actual, listTemplates: h.listTemplates };
});

vi.mock("@/lib/presentations/guards", () => ({
  guardPresentationsModule: h.guard,
  isPresentationsModuleActive: vi.fn().mockResolvedValue(true),
}));

vi.mock("@/lib/storage/s3", () => ({
  uploadFile: h.uploadFile,
  getFileJson: h.getFileJson,
  listKeys: vi.fn().mockResolvedValue([]),
  deleteFile: h.deleteFile,
}));

import { NextResponse, type NextRequest } from "next/server";
import { GET as listerModeles } from "@/app/api/presentations/templates/route";
import {
  GET as lireModele,
  PATCH as modifierModele,
  DELETE as retirerModele,
} from "@/app/api/presentations/templates/[id]/route";
import { POST as reinitialiser } from "@/app/api/presentations/templates/[id]/reset/route";
import { createEmptyDeck } from "@/lib/presentations/deck";

const ORG = "org-acme";
const ID = "22222222-2222-4222-8222-222222222222";
const MODELE = {
  id: ID,
  title: "Mon modèle",
  spaceId: null,
  organizationId: ORG,
  isTemplate: true,
  templateDescription: "desc",
  templateOrigin: null as string | null,
  templateSeedKey: null as string | null,
  templateHiddenAt: null as Date | null,
  createdBy: "33333333-3333-4333-8333-333333333333",
  version: 3,
  slideCount: 2,
};
const MODELE_LORIAX = {
  ...MODELE,
  templateOrigin: "lorIAx",
  templateSeedKey: "pitch",
  templateHiddenAt: new Date("2026-11-01T10:00:00Z"),
};

const params = Promise.resolve({ id: ID });

function requete(body?: unknown): NextRequest {
  return {
    nextUrl: new URL("http://localhost/api/presentations/templates"),
    json: async () => {
      if (body === undefined) throw new Error("pas de corps");
      return body;
    },
  } as unknown as NextRequest;
}

function utilisateur(globalRole: string) {
  h.requireOrgScoped.mockResolvedValue({
    user: { id: MODELE.createdBy, globalRole },
    orgId: ORG,
    orgSlug: "acme",
  });
}

function refus(status: number) {
  return new h.OrgScopeError(
    NextResponse.json({ error: "Accès refusé" }, { status }),
    "refus"
  );
}

function aucuneEcriture() {
  expect(h.miseAJour).not.toHaveBeenCalled();
  expect(h.insertion).not.toHaveBeenCalled();
  expect(h.suppression).not.toHaveBeenCalled();
  expect(h.uploadFile).not.toHaveBeenCalled();
  expect(h.deleteFile).not.toHaveBeenCalled();
}

beforeEach(() => {
  orgRole.mockResolvedValue("member");
  vi.clearAllMocks();
  utilisateur("admin");
  h.guard.mockResolvedValue(null);
  h.ligne.mockResolvedValue([MODELE]);
  h.liste.mockResolvedValue([MODELE]);
  h.insertion.mockResolvedValue([]);
  h.miseAJour.mockResolvedValue([{ ...MODELE, version: MODELE.version + 1 }]);
  h.suppression.mockResolvedValue([]);
  h.getFileJson.mockResolvedValue(createEmptyDeck("Mon modèle"));
  h.uploadFile.mockResolvedValue("clé");
  h.deleteFile.mockResolvedValue(undefined);
});

describe("liste des modèles", () => {
  it("un membre lit la liste, le semis est déclenché", async () => {
    utilisateur("member");
    const res = await listerModeles(requete());
    expect(res.status).toBe(200);
    expect((await res.json()).templates).toHaveLength(1);
  });

  it("includeHidden vaut faux pour un membre et vrai pour un admin", async () => {
    utilisateur("member");
    await listerModeles(requete());
    expect(h.listTemplates).toHaveBeenLastCalledWith(ORG, {
      includeHidden: false,
      seededOnly: false,
    });
    utilisateur("admin");
    await listerModeles(requete());
    expect(h.listTemplates).toHaveBeenLastCalledWith(ORG, {
      includeHidden: true,
      seededOnly: false,
    });
  });

  it("module coupé : 404, ni semis ni lecture", async () => {
    h.guard.mockResolvedValue(NextResponse.json({ error: "Introuvable" }, { status: 404 }));
    const res = await listerModeles(requete());
    expect(res.status).toBe(404);
    expect(h.insertion).not.toHaveBeenCalled();
    expect(h.liste).not.toHaveBeenCalled();
  });
});

describe("fiche d'un modèle", () => {
  it("un membre lit la fiche et la charge utile", async () => {
    utilisateur("member");
    const res = await lireModele(requete(), { params });
    expect(res.status).toBe(200);
    expect(h.getFileJson).toHaveBeenCalledTimes(1);
  });

  it("un modèle masqué est un 404 pour un membre, sans lecture S3", async () => {
    utilisateur("member");
    h.ligne.mockResolvedValue([{ ...MODELE, templateHiddenAt: new Date() }]);
    const res = await lireModele(requete(), { params });
    expect(res.status).toBe(404);
    expect(h.getFileJson).not.toHaveBeenCalled();
  });

  it("un modèle masqué reste lisible par l'admin", async () => {
    h.ligne.mockResolvedValue([{ ...MODELE, templateHiddenAt: new Date() }]);
    const res = await lireModele(requete(), { params });
    expect(res.status).toBe(200);
  });

  it("un admin d'une autre organisation reçoit 404 sans accès S3", async () => {
    h.requireOrgScoped.mockResolvedValue({
      user: { id: "x", globalRole: "admin" },
      orgId: "org-autre",
      orgSlug: "autre",
    });
    const res = await lireModele(requete(), { params });
    expect(res.status).toBe(404);
    expect(h.getFileJson).not.toHaveBeenCalled();
    const patch = await modifierModele(requete({ name: "x" }), { params });
    expect(patch.status).toBe(404);
    const del = await retirerModele(requete(), { params });
    expect(del.status).toBe(404);
    const rst = await reinitialiser(requete({}), { params });
    expect(rst.status).toBe(404);
    aucuneEcriture();
  });

  it("module coupé : 404 avant tout accès", async () => {
    h.guard.mockResolvedValue(NextResponse.json({ error: "Introuvable" }, { status: 404 }));
    const res = await lireModele(requete(), { params });
    expect(res.status).toBe(404);
    expect(h.ligne).not.toHaveBeenCalled();
    expect(h.getFileJson).not.toHaveBeenCalled();
  });

  it("non authentifié : la réponse du helper est rendue telle quelle", async () => {
    h.requireOrgScoped.mockRejectedValue(refus(401));
    const res = await lireModele(requete(), { params });
    expect(res.status).toBe(401);
    expect(h.ligne).not.toHaveBeenCalled();
  });
});

describe("écriture réservée à l'admin", () => {
  it("un membre ne peut ni PATCH ni DELETE ni reset : 403, aucune écriture", async () => {
    utilisateur("member");
    expect((await modifierModele(requete({ name: "x" }), { params })).status).toBe(403);
    expect((await retirerModele(requete(), { params })).status).toBe(403);
    expect((await reinitialiser(requete({}), { params })).status).toBe(403);
    aucuneEcriture();
  });

  it("PATCH met à jour nom, description et masquage", async () => {
    const res = await modifierModele(
      requete({ name: "Nouveau", description: "d", hidden: true }),
      { params }
    );
    expect(res.status).toBe(200);
    expect(h.miseAJour).toHaveBeenCalledTimes(1);
    expect(h.uploadFile).not.toHaveBeenCalled();
  });

  it("PATCH sans champ reconnu : 400, aucune écriture", async () => {
    const res = await modifierModele(requete({}), { params });
    expect(res.status).toBe(400);
    aucuneEcriture();
  });
});

describe("retrait", () => {
  it("masque le modèle : une mise à jour, aucune suppression ligne ou S3", async () => {
    const res = await retirerModele(requete(), { params });
    expect(res.status).toBe(200);
    expect(h.miseAJour).toHaveBeenCalledTimes(1);
    expect(h.suppression).not.toHaveBeenCalled();
    expect(h.deleteFile).not.toHaveBeenCalled();
    expect(h.uploadFile).not.toHaveBeenCalled();
  });
});

describe("réinitialisation", () => {
  it("modèle d'organisation : 422, aucune écriture", async () => {
    const res = await reinitialiser(requete({}), { params });
    expect(res.status).toBe(422);
    aucuneEcriture();
  });

  it("modèle LorIAx : contenu remplacé (S3) et démasqué (db)", async () => {
    h.ligne.mockResolvedValue([MODELE_LORIAX]);
    h.miseAJour.mockResolvedValue([{ ...MODELE_LORIAX, templateHiddenAt: null, version: 4 }]);
    const res = await reinitialiser(requete({ expectedVersion: 3 }), { params });
    expect(res.status).toBe(200);
    expect(h.miseAJour).toHaveBeenCalledTimes(1);
    expect(h.uploadFile).toHaveBeenCalled();
    expect(h.sets).toHaveBeenCalledWith(
      expect.objectContaining({ templateHiddenAt: null, version: 4 })
    );
    expect(h.deleteFile).not.toHaveBeenCalled();
  });

  it("expectedVersion périmée : 409 avec currentVersion, aucune écriture", async () => {
    h.ligne.mockResolvedValue([MODELE_LORIAX]);
    const res = await reinitialiser(requete({ expectedVersion: 1 }), { params });
    expect(res.status).toBe(409);
    expect((await res.json()).currentVersion).toBe(3);
    aucuneEcriture();
  });

  it("conflit détecté à l'écriture : 409 avec currentVersion", async () => {
    h.ligne.mockResolvedValue([MODELE_LORIAX]);
    h.miseAJour.mockResolvedValue([]);
    const res = await reinitialiser(requete({ expectedVersion: 3 }), { params });
    expect(res.status).toBe(409);
    expect(h.uploadFile).not.toHaveBeenCalled();
  });
});

describe("rôle borné à l'organisation (I1) et lecture réservée aux membres (I6)", () => {
  it("I1 : admin global SANS ligne d'appartenance : 404 en écriture, aucune écriture", async () => {
    orgRole.mockResolvedValue(null);
    utilisateur("admin");
    expect((await modifierModele(requete({ name: "x" }), { params })).status).toBe(404);
    expect((await retirerModele(requete(), { params })).status).toBe(404);
    expect((await reinitialiser(requete({}), { params })).status).toBe(404);
    aucuneEcriture();
  });

  it("I1 : propriétaire d'organisation (rôle global editor) gère ses modèles", async () => {
    orgRole.mockResolvedValue("owner");
    utilisateur("editor");
    const res = await modifierModele(requete({ name: "Nouveau" }), { params });
    expect(res.status).toBe(200);
    expect(h.miseAJour).toHaveBeenCalledTimes(1);
  });

  it("I1 : admin d'appartenance (rôle global viewer) gère ses modèles", async () => {
    orgRole.mockResolvedValue("admin");
    utilisateur("viewer");
    expect((await retirerModele(requete(), { params })).status).toBe(200);
  });

  it("I1 : membre simple sans rôle admin : toujours 403", async () => {
    orgRole.mockResolvedValue("member");
    utilisateur("editor");
    expect((await modifierModele(requete({ name: "x" }), { params })).status).toBe(403);
    aucuneEcriture();
  });

  it("I6 : un non-membre ne reçoit que les modèles LorIAx dans la liste", async () => {
    orgRole.mockResolvedValue(null);
    utilisateur("editor");
    await listerModeles(requete());
    expect(h.listTemplates).toHaveBeenLastCalledWith(ORG, {
      includeHidden: false,
      seededOnly: true,
    });
  });

  it("I6 : GET d'un modèle d'organisation par un non-membre : 404 sans lecture S3", async () => {
    orgRole.mockResolvedValue(null);
    utilisateur("editor");
    const res = await lireModele(requete(), { params });
    expect(res.status).toBe(404);
    expect(h.getFileJson).not.toHaveBeenCalled();
  });

  it("I6 : GET d'un modèle LorIAx (semé) par un non-membre : 200", async () => {
    orgRole.mockResolvedValue(null);
    utilisateur("editor");
    h.ligne.mockResolvedValue([{ ...MODELE_LORIAX, templateHiddenAt: null }]);
    const res = await lireModele(requete(), { params });
    expect(res.status).toBe(200);
  });
});
