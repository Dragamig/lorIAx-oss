/**
 * Utiliser un modèle, enregistrer comme modèle, protéger l'écriture (lot 3bis, T6).
 *
 * Assertions sur les effets de bord (`db.update`, `db.insert`, `uploadFile`,
 * `getFileJson`, `deleteFile`), pas seulement sur le statut. La lib
 * `templates.ts` et les gardes `template-access.ts` sont réelles.
 *
 * Preuves par mutation (retrait temporaire, test rouge, restauration, vert) :
 *   - branche modèle du PUT (`requireTemplateAdmin`) retirée de
 *     `[id]/route.ts` : « PUT d'un modèle par un non-admin » échoue (200 au
 *     lieu de 403, `uploadFile` appelé) ;
 *   - `assertTemplateInOrg` retiré de `createFromTemplate` : « modèle d'une
 *     autre organisation » échoue (201 au lieu de 404) ;
 *   - ordre inversé dans `requireTemplateAdminFor` (contrôle de rôle avant
 *     `assertTemplateInOrg`) : « membre d'une autre organisation : 404 » en
 *     PUT et en DELETE échouent (403 au lieu de 404) ;
 *   - contrôle d'admin retiré de `requireTemplateAdmin` : « enregistrer par un
 *     membre » échoue (201 au lieu de 403, insertion effectuée).
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
    ligne: vi.fn(),
    insertion: vi.fn(),
    miseAJour: vi.fn(),
    suppression: vi.fn(),
    uploadFile: vi.fn(),
    getFileJson: vi.fn(),
    listKeys: vi.fn(),
    deleteFile: vi.fn(),
    sets: vi.fn(),
    values: vi.fn(),
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
      orderBy: () => obj,
      set: (v: unknown) => {
        h.sets(v);
        return obj;
      },
      values: (v: unknown) => {
        h.values(v);
        return obj;
      },
      then: (res: (v: unknown) => unknown) => Promise.resolve([]).then(res),
    };
    for (const [nom, fn] of Object.entries(terminaux)) {
      obj[nom] = () => Promise.resolve(fn());
    }
    return obj;
  };
  return {
    db: {
      select: () => chaine({ limit: () => h.ligne() }),
      insert: () => chaine({ returning: () => h.insertion() }),
      update: () => chaine({ returning: () => h.miseAJour() }),
      delete: () => chaine({ returning: () => h.suppression() }),
    },
  };
});

vi.mock("@/lib/presentations/guards", () => ({
  guardPresentationsModule: vi.fn().mockResolvedValue(null),
  isPresentationsModuleActive: vi.fn().mockResolvedValue(true),
}));

vi.mock("@/lib/onboarding/progress", () => ({
  recordIfRealSpace: vi.fn().mockResolvedValue(undefined),
}));

vi.mock("@/lib/storage/s3", () => ({
  uploadFile: h.uploadFile,
  getFileJson: h.getFileJson,
  listKeys: h.listKeys,
  deleteFile: h.deleteFile,
}));

import { NextResponse, type NextRequest } from "next/server";
import { POST as creer } from "@/app/api/presentations/route";
import {
  GET as lire,
  PUT as enregistrer,
  DELETE as supprimer,
} from "@/app/api/presentations/[id]/route";
import { POST as enregistrerCommeModele } from "@/app/api/presentations/[id]/template/route";
import { createEmptyDeck } from "@/lib/presentations/deck";

const ORG = "org-acme";
const ESPACE = "11111111-1111-4111-8111-111111111111";
const ID_MODELE = "22222222-2222-4222-8222-222222222222";
const ID_SOURCE = "44444444-4444-4444-8444-444444444444";
const USER = "33333333-3333-4333-8333-333333333333";
const MODELE = {
  id: ID_MODELE,
  title: "Mon modèle",
  spaceId: null,
  organizationId: ORG,
  isTemplate: true,
  templateDescription: null,
  templateOrigin: null as string | null,
  templateSeedKey: null as string | null,
  templateHiddenAt: null as Date | null,
  createdBy: USER,
  version: 3,
  slideCount: 1,
};
const SOURCE = {
  id: ID_SOURCE,
  title: "Source",
  spaceId: ESPACE,
  organizationId: null,
  isTemplate: false,
  version: 5,
  slideCount: 1,
};

function requete(body?: unknown): NextRequest {
  return {
    nextUrl: new URL("http://localhost/api/presentations"),
    json: async () => {
      if (body === undefined) throw new Error("pas de corps");
      return body;
    },
  } as unknown as NextRequest;
}

function utilisateur(globalRole: string) {
  h.requireOrgScoped.mockResolvedValue({
    user: { id: USER, globalRole },
    orgId: ORG,
    orgSlug: "acme",
  });
}

function refus(status: number) {
  return new h.OrgScopeError(NextResponse.json({ error: "Accès refusé" }, { status }), "refus");
}

const cles = () => h.uploadFile.mock.calls.map((c) => c[0] as string);

beforeEach(() => {
  orgRole.mockResolvedValue("member");
  vi.clearAllMocks();
  utilisateur("admin");
  h.ligne.mockResolvedValue([MODELE]);
  h.insertion.mockResolvedValue([{ id: "nouveau" }]);
  h.miseAJour.mockResolvedValue([{ ...MODELE, version: 4 }]);
  h.suppression.mockResolvedValue([]);
  h.getFileJson.mockResolvedValue(createEmptyDeck("Mon modèle"));
  h.listKeys.mockResolvedValue([]);
  h.uploadFile.mockResolvedValue("clé");
  h.deleteFile.mockResolvedValue(undefined);
});

describe("utiliser un modèle (POST avec templateId)", () => {
  const corps = { spaceId: ESPACE, templateId: ID_MODELE, title: "Ma copie" };

  it("crée une ligne et un objet neufs, version 1, sans jamais écrire le modèle", async () => {
    utilisateur("member");
    h.insertion.mockImplementation(async () => [{ id: h.values.mock.calls[0][0].id }]);
    const res = await creer(requete(corps));
    expect(res.status).toBe(201);
    const insere = h.values.mock.calls[0][0];
    expect(insere.id).not.toBe(ID_MODELE);
    expect(insere.spaceId).toBe(ESPACE);
    expect(insere.title).toBe("Ma copie");
    expect(insere.isTemplate).toBeUndefined();
    expect(cles()).toEqual([`presentations/${insere.id}.json`]);
    expect(cles()).not.toContain(`presentations/${ID_MODELE}.json`);
    const ecrit = JSON.parse((h.uploadFile.mock.calls[0][1] as Buffer).toString());
    expect(ecrit.title).toBe("Ma copie");
    expect(h.miseAJour).not.toHaveBeenCalled();
    expect(h.sets).not.toHaveBeenCalled();
    expect(h.deleteFile).not.toHaveBeenCalled();
  });

  it("l'espace cible reste soumis à la permission d'éditeur", async () => {
    await creer(requete(corps));
    expect(h.requireOrgScoped).toHaveBeenCalledWith({
      resource: { type: "space", id: ESPACE },
      minPermission: "editor",
    });
  });

  it("modèle d'une autre organisation : 404 muet, aucune écriture", async () => {
    h.ligne.mockResolvedValue([{ ...MODELE, organizationId: "org-autre" }]);
    const res = await creer(requete(corps));
    expect(res.status).toBe(404);
    expect(h.uploadFile).not.toHaveBeenCalled();
    expect(h.insertion).not.toHaveBeenCalled();
  });

  it("modèle masqué : 404, aucune écriture", async () => {
    h.ligne.mockResolvedValue([{ ...MODELE, templateHiddenAt: new Date() }]);
    const res = await creer(requete(corps));
    expect(res.status).toBe(404);
    expect(h.uploadFile).not.toHaveBeenCalled();
    expect(h.insertion).not.toHaveBeenCalled();
  });

  it("I6 : un non-membre ne peut pas utiliser un modèle d'organisation : 404, aucune écriture", async () => {
    orgRole.mockResolvedValue(null);
    utilisateur("editor");
    const res = await creer(requete(corps));
    expect(res.status).toBe(404);
    expect(h.uploadFile).not.toHaveBeenCalled();
    expect(h.insertion).not.toHaveBeenCalled();
  });

  it("I6 : un non-membre peut utiliser un modèle LorIAx (semé)", async () => {
    orgRole.mockResolvedValue(null);
    utilisateur("editor");
    h.ligne.mockResolvedValue([{ ...MODELE, templateOrigin: "lorIAx", templateSeedKey: "pitch" }]);
    h.insertion.mockImplementation(async () => [{ id: h.values.mock.calls[0][0].id }]);
    const res = await creer(requete(corps));
    expect(res.status).toBe(201);
  });

  it("échec S3 : 500 et aucune ligne créée (l'objet précède la ligne)", async () => {
    h.uploadFile.mockRejectedValue(new Error("S3 HS"));
    const res = await creer(requete(corps));
    expect(res.status).toBe(500);
    expect(h.insertion).not.toHaveBeenCalled();
    expect(h.deleteFile).not.toHaveBeenCalled();
  });
});

describe("protection de l'écriture d'un modèle", () => {
  const params = Promise.resolve({ id: ID_MODELE });
  const put = { deck: createEmptyDeck("X"), expectedVersion: 3 };

  it("PUT d'un modèle par un non-admin : 403, aucune écriture S3 ni base", async () => {
    utilisateur("member");
    const res = await enregistrer(requete(put), { params });
    expect(res.status).toBe(403);
    expect(h.uploadFile).not.toHaveBeenCalled();
    expect(h.sets).not.toHaveBeenCalled();
    expect(h.miseAJour).not.toHaveBeenCalled();
  });

  it("PUT d'un modèle par un admin : écriture versionnée", async () => {
    const res = await enregistrer(requete(put), { params });
    expect(res.status).toBe(200);
    expect(cles()).toContain(`presentations/${ID_MODELE}.json`);
  });

  it("PUT d'un modèle d'une autre organisation : 404, aucune écriture", async () => {
    h.ligne.mockResolvedValue([{ ...MODELE, organizationId: "org-autre" }]);
    const res = await enregistrer(requete(put), { params });
    expect(res.status).toBe(404);
    expect(h.uploadFile).not.toHaveBeenCalled();
  });

  it("PUT d'un modèle par un membre d'une autre organisation : 404 muet, zéro écriture", async () => {
    h.requireOrgScoped.mockResolvedValue({
      user: { id: USER, globalRole: "member" },
      orgId: "org-autre",
      orgSlug: "autre",
    });
    const res = await enregistrer(requete(put), { params });
    expect(res.status).toBe(404);
    expect(h.uploadFile).not.toHaveBeenCalled();
    expect(h.miseAJour).not.toHaveBeenCalled();
    expect(h.sets).not.toHaveBeenCalled();
  });

  it("DELETE d'un modèle par un membre d'une autre organisation : 404 muet, zéro écriture", async () => {
    h.requireOrgScoped.mockResolvedValue({
      user: { id: USER, globalRole: "member" },
      orgId: "org-autre",
      orgSlug: "autre",
    });
    const res = await supprimer(requete(), { params });
    expect(res.status).toBe(404);
    expect(h.deleteFile).not.toHaveBeenCalled();
    expect(h.suppression).not.toHaveBeenCalled();
    expect(h.uploadFile).not.toHaveBeenCalled();
  });

  it("PUT ordinaire : permission d'éditeur de l'espace, inchangé", async () => {
    h.ligne.mockResolvedValue([SOURCE]);
    h.miseAJour.mockResolvedValue([{ ...SOURCE, version: 6 }]);
    const res = await enregistrer(requete({ ...put, expectedVersion: 5 }), {
      params: Promise.resolve({ id: ID_SOURCE }),
    });
    expect(res.status).toBe(200);
    expect(h.requireOrgScoped).toHaveBeenCalledWith({
      resource: { type: "space", id: ESPACE },
      minPermission: "editor",
    });
  });

  it("DELETE d'un modèle : 409, ni deleteFile ni db.delete", async () => {
    const res = await supprimer(requete(), { params });
    expect(res.status).toBe(409);
    expect(h.deleteFile).not.toHaveBeenCalled();
    expect(h.suppression).not.toHaveBeenCalled();
    expect(h.listKeys).not.toHaveBeenCalled();
  });

  it("GET d'un modèle masqué par un membre : 404 sans lecture S3", async () => {
    utilisateur("member");
    h.ligne.mockResolvedValue([{ ...MODELE, templateHiddenAt: new Date() }]);
    const res = await lire(requete(), { params });
    expect(res.status).toBe(404);
    expect(h.getFileJson).not.toHaveBeenCalled();
  });

  it("GET d'un modèle par un membre : 200 sans permission d'espace", async () => {
    utilisateur("member");
    const res = await lire(requete(), { params });
    expect(res.status).toBe(200);
    expect(h.requireOrgScoped).toHaveBeenCalledWith({}, expect.anything());
  });
});

describe("enregistrer comme modèle (POST /[id]/template)", () => {
  const params = Promise.resolve({ id: ID_SOURCE });
  const corps = { name: "Mon modèle", description: "d" };

  beforeEach(() => {
    h.ligne.mockResolvedValue([SOURCE]);
    h.insertion.mockResolvedValue([{ id: "copie-1", isTemplate: true, spaceId: null }]);
  });

  it("membre : 403, aucune écriture", async () => {
    utilisateur("member");
    const res = await enregistrerCommeModele(requete(corps), { params });
    expect(res.status).toBe(403);
    expect(h.insertion).not.toHaveBeenCalled();
    expect(h.uploadFile).not.toHaveBeenCalled();
  });

  it("admin d'une autre organisation : 404 muet, aucune écriture", async () => {
    h.requireOrgScoped
      .mockResolvedValueOnce({ user: { id: USER, globalRole: "admin" }, orgId: "org-autre", orgSlug: "x" })
      .mockRejectedValueOnce(refus(404));
    const res = await enregistrerCommeModele(requete(corps), { params });
    expect(res.status).toBe(404);
    expect(h.insertion).not.toHaveBeenCalled();
    expect(h.uploadFile).not.toHaveBeenCalled();
  });

  it("admin de l'organisation : copie créée, source intacte", async () => {
    const res = await enregistrerCommeModele(requete(corps), { params });
    expect(res.status).toBe(201);
    const insere = h.values.mock.calls[0][0];
    expect(insere.isTemplate).toBe(true);
    expect(insere.organizationId).toBe(ORG);
    expect(insere.spaceId).toBeUndefined();
    expect(insere.templateOrigin).toBeUndefined();
    expect(cles()).toEqual(["presentations/copie-1.json"]);
    expect(cles()).not.toContain(`presentations/${ID_SOURCE}.json`);
    expect(h.miseAJour).not.toHaveBeenCalled();
    expect(h.sets).not.toHaveBeenCalled();
    expect(h.deleteFile).not.toHaveBeenCalled();
  });

  it("source sans objet S3 : 409, aucune ligne ni objet", async () => {
    h.getFileJson.mockResolvedValue(null);
    const res = await enregistrerCommeModele(requete(corps), { params });
    expect(res.status).toBe(409);
    expect(h.insertion).not.toHaveBeenCalled();
    expect(h.uploadFile).not.toHaveBeenCalled();
  });

  it("échec S3 après insertion : ligne masquée, 500, aucune suppression", async () => {
    h.uploadFile.mockRejectedValue(new Error("S3 HS"));
    const res = await enregistrerCommeModele(requete(corps), { params });
    expect(res.status).toBe(500);
    expect(h.sets).toHaveBeenCalledWith({ templateHiddenAt: expect.any(Date) });
    expect(h.deleteFile).not.toHaveBeenCalled();
    expect(h.suppression).not.toHaveBeenCalled();
  });

  it("source déjà modèle : 404", async () => {
    h.ligne.mockResolvedValue([MODELE]);
    const res = await enregistrerCommeModele(requete(corps), { params });
    expect(res.status).toBe(404);
    expect(h.insertion).not.toHaveBeenCalled();
  });
});
