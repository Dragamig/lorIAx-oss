/**
 * Cloisonnement et concurrence des routes du module « Présentations »
 * (`src/app/api/presentations/**`, lot 1 de la spec du 2026-09-08).
 *
 * Deux propriétés sont vérifiées ici, et elles ont la même racine : la table
 * `presentations` est adressable par un identifiant nu, et sa charge utile vit
 * dans S3, hors de portée de toute politique d'accès du stockage. Rien
 * n'empêche donc, structurellement, qu'un identifiant deviné rende le
 * diaporama d'un autre tenant. Seul `requireOrgScoped`, appelé sur le
 * `spaceId` lu sur la ligne, l'interdit, et c'est cette garde que les tests
 * exercent.
 *
 * Les assertions portent volontairement sur les effets de bord (`getFileJson`,
 * `uploadFile`, `db.update`, `db.delete`) et pas seulement sur le code de
 * statut : retirer la garde ferait alors passer un test qui se contenterait de
 * regarder la réponse renvoyée par une doublure permissive.
 *
 * Second volet : le contrôle de concurrence optimiste. Un 409 doit être un
 * refus TOTAL, sans la moindre écriture S3, sinon la révision du perdant
 * écrase celle du gagnant tout en lui affichant un conflit.
 */
import { describe, it, expect, beforeEach, vi } from "vitest";

const h = vi.hoisted(() => {
  /** Réplique de l'erreur typée du helper : les routes font `instanceof`. */
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
    liste: vi.fn(),
    insertion: vi.fn(),
    miseAJour: vi.fn(),
    suppression: vi.fn(),
    uploadFile: vi.fn(),
    getFileJson: vi.fn(),
    listKeys: vi.fn(),
    deleteFile: vi.fn(),
  };
});

vi.mock("@/lib/auth/require-org-scoped", () => ({
  requireOrgScoped: h.requireOrgScoped,
  OrgScopeError: h.OrgScopeError,
}));

vi.mock("@/lib/db", () => {
  // Chaîne drizzle minimale : chaque maillon se rend lui-même, les méthodes
  // terminales rendent une promesse. `then` est présent pour que les chaînes
  // sans terminaison explicite (`db.delete().where()`) restent attendables.
  const chaine = (terminaux: Record<string, () => unknown>) => {
    const obj: Record<string, unknown> = {
      from: () => obj,
      where: () => obj,
      set: () => obj,
      values: () => obj,
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
      delete: () => chaine({ returning: () => [] }),
    },
  };
});

/**
 * Le garde de module est neutralisé ici : ces tests portent sur le
 * cloisonnement, pas sur la composition de l'image. Sa propre couverture est
 * assurée de bout en bout, module réellement coupé (e2e/presentations.spec.ts).
 */
vi.mock("@/lib/presentations/guards", () => ({
  guardPresentationsModule: vi.fn().mockResolvedValue(null),
  isPresentationsModuleActive: vi.fn().mockResolvedValue(true),
}));

const canLinkDocument = vi.hoisted(() => vi.fn());
vi.mock("@/lib/presentations/document-link", () => ({ canLinkDocument }));

vi.mock("@/lib/storage/s3", () => ({
  uploadFile: h.uploadFile,
  getFileJson: h.getFileJson,
  listKeys: h.listKeys,
  deleteFile: h.deleteFile,
}));

import { NextResponse, type NextRequest } from "next/server";
import { GET as listerPresentations, POST as creerPresentation } from "@/app/api/presentations/route";
import {
  GET as lirePresentation,
  PUT as enregistrerPresentation,
  DELETE as supprimerPresentation,
} from "@/app/api/presentations/[id]/route";
import { createEmptyDeck } from "@/lib/presentations/deck";

const ESPACE_VICTIME = "11111111-1111-4111-8111-111111111111";
const PRESENTATION = {
  id: "22222222-2222-4222-8222-222222222222",
  title: "Comité stratégique",
  spaceId: ESPACE_VICTIME,
  documentId: null,
  createdBy: "33333333-3333-4333-8333-333333333333",
  version: 4,
  slideCount: 12,
  thumbnailKey: null,
  createdAt: new Date("2026-09-01T10:00:00Z"),
  updatedAt: new Date("2026-09-02T10:00:00Z"),
};

const params = Promise.resolve({ id: PRESENTATION.id });

/** Requête minimale : seuls `json()` et `nextUrl` sont sollicités. */
function requete(body?: unknown, url = "http://localhost/api/presentations"): NextRequest {
  return {
    nextUrl: new URL(url),
    json: async () => {
      if (body === undefined) throw new Error("pas de corps");
      return body;
    },
  } as unknown as NextRequest;
}

/** Refus fabriqué par le helper, dans la forme exacte qu'il produit. */
function refus(status: number, reason: string) {
  const message = status === 404 ? "Introuvable" : "Accès refusé";
  return new h.OrgScopeError(NextResponse.json({ error: message }, { status }), reason);
}

/** Aucune trace, ni en base ni dans le stockage. */
function aucuneEcriture() {
  expect(h.uploadFile).not.toHaveBeenCalled();
  expect(h.miseAJour).not.toHaveBeenCalled();
  expect(h.insertion).not.toHaveBeenCalled();
  expect(h.deleteFile).not.toHaveBeenCalled();
}

beforeEach(() => {
  vi.clearAllMocks();
  canLinkDocument.mockResolvedValue(true);
  h.requireOrgScoped.mockResolvedValue({
    user: { id: PRESENTATION.createdBy },
    orgId: "org-acme",
    orgSlug: "acme",
  });
  h.ligne.mockResolvedValue([PRESENTATION]);
  h.liste.mockResolvedValue([PRESENTATION]);
  h.insertion.mockResolvedValue([PRESENTATION]);
  h.miseAJour.mockResolvedValue([{ ...PRESENTATION, version: PRESENTATION.version + 1 }]);
  h.getFileJson.mockResolvedValue(createEmptyDeck(PRESENTATION.title));
  h.listKeys.mockResolvedValue([]);
  h.uploadFile.mockResolvedValue("clé");
  h.deleteFile.mockResolvedValue(undefined);
});

describe("lecture d'une présentation", () => {
  it("confronte l'espace de la ligne à l'organisation de la requête, en lecture", async () => {
    await lirePresentation(requete(), { params });
    expect(h.requireOrgScoped).toHaveBeenCalledWith({
      resource: { type: "space", id: ESPACE_VICTIME },
      minPermission: "viewer",
    });
  });

  it("refuse sans permission, et ne touche jamais au stockage", async () => {
    h.requireOrgScoped.mockRejectedValue(refus(403, "permission-denied"));
    const res = await lirePresentation(requete(), { params });
    expect(res.status).toBe(403);
    // Preuve que la garde précède la lecture S3 : sans elle, le diaporama
    // complet aurait déjà été chargé et sérialisé dans la réponse.
    expect(h.getFileJson).not.toHaveBeenCalled();
  });

  it("rend 404 pour une présentation d'un autre espace, sans révéler son existence", async () => {
    h.requireOrgScoped.mockRejectedValue(refus(404, "resource-not-found"));
    const res = await lirePresentation(requete(), { params });
    expect(res.status).toBe(404);
    expect(await res.json()).toEqual({ error: "Introuvable" });
    expect(h.getFileJson).not.toHaveBeenCalled();
  });

  it("rend 404 sur un identifiant inconnu, sans consulter l'accès", async () => {
    h.ligne.mockResolvedValue([]);
    const res = await lirePresentation(requete(), { params });
    expect(res.status).toBe(404);
    expect(h.requireOrgScoped).not.toHaveBeenCalled();
  });

  it("reconstruit un document vide quand la charge utile n'a jamais été écrite", async () => {
    h.getFileJson.mockResolvedValue(null);
    const res = await lirePresentation(requete(), { params });
    expect(res.status).toBe(200);
    const corps = await res.json();
    expect(corps.deck.slides).toHaveLength(1);
    expect(corps.presentation.id).toBe(PRESENTATION.id);
  });
});

describe("liste des présentations d'un espace", () => {
  it("exige un espace", async () => {
    const res = await listerPresentations(requete(undefined, "http://localhost/api/presentations"));
    expect(res.status).toBe(400);
    expect(h.requireOrgScoped).not.toHaveBeenCalled();
  });

  it("refuse la liste sans permission de lecture sur l'espace", async () => {
    h.requireOrgScoped.mockRejectedValue(refus(404, "resource-not-found"));
    const res = await listerPresentations(
      requete(undefined, `http://localhost/api/presentations?spaceId=${ESPACE_VICTIME}`)
    );
    expect(res.status).toBe(404);
    expect(h.liste).not.toHaveBeenCalled();
  });
});

describe("création", () => {
  it("exige le droit d'édition sur l'espace et n'écrit rien s'il manque", async () => {
    h.requireOrgScoped.mockRejectedValue(refus(403, "permission-denied"));
    const res = await creerPresentation(requete({ spaceId: ESPACE_VICTIME }));
    expect(res.status).toBe(403);
    expect(h.requireOrgScoped).toHaveBeenCalledWith({
      resource: { type: "space", id: ESPACE_VICTIME },
      minPermission: "editor",
    });
    aucuneEcriture();
  });

  it("écrit la ligne avant la charge utile", async () => {
    const ordre: string[] = [];
    h.insertion.mockImplementation(() => {
      ordre.push("base");
      return [PRESENTATION];
    });
    h.uploadFile.mockImplementation(() => {
      ordre.push("s3");
      return Promise.resolve("clé");
    });
    const res = await creerPresentation(requete({ spaceId: ESPACE_VICTIME, title: "Kick-off" }));
    expect(res.status).toBe(201);
    expect(ordre).toEqual(["base", "s3"]);
    expect(h.uploadFile.mock.calls[0][0]).toBe(`presentations/${PRESENTATION.id}.json`);
  });
});

describe("enregistrement", () => {
  const deck = createEmptyDeck("Comité stratégique");
  const corpsValide = { deck, expectedVersion: PRESENTATION.version };

  it("exige le droit d'édition, pas la simple lecture", async () => {
    await enregistrerPresentation(requete(corpsValide), { params });
    expect(h.requireOrgScoped).toHaveBeenCalledWith({
      resource: { type: "space", id: ESPACE_VICTIME },
      minPermission: "editor",
    });
  });

  it("refuse un simple lecteur, sans rien écrire", async () => {
    h.requireOrgScoped.mockRejectedValue(refus(403, "permission-denied"));
    const res = await enregistrerPresentation(requete(corpsValide), { params });
    expect(res.status).toBe(403);
    aucuneEcriture();
  });

  it("rend 404 pour une présentation d'un autre espace, sans rien écrire", async () => {
    h.requireOrgScoped.mockRejectedValue(refus(404, "resource-not-found"));
    const res = await enregistrerPresentation(requete(corpsValide), { params });
    expect(res.status).toBe(404);
    aucuneEcriture();
  });

  it("rend 409 sur version obsolète, et n'écrit ABSOLUMENT rien", async () => {
    const res = await enregistrerPresentation(
      requete({ deck, expectedVersion: PRESENTATION.version - 1 }),
      { params }
    );
    expect(res.status).toBe(409);
    expect(await res.json()).toMatchObject({ currentVersion: PRESENTATION.version });
    aucuneEcriture();
  });

  it("rend 409 quand la ligne a changé entre la lecture et l'écriture", async () => {
    // Course entre deux onglets : la comparaison initiale passe, mais l'UPDATE
    // conditionné sur `version = expectedVersion` ne touche aucune ligne.
    h.miseAJour.mockResolvedValue([]);
    h.ligne
      .mockResolvedValueOnce([PRESENTATION])
      .mockResolvedValueOnce([{ ...PRESENTATION, version: PRESENTATION.version + 1 }]);
    const res = await enregistrerPresentation(requete(corpsValide), { params });
    expect(res.status).toBe(409);
    expect(await res.json()).toMatchObject({ currentVersion: PRESENTATION.version + 1 });
    expect(h.uploadFile).not.toHaveBeenCalled();
  });

  it("rend 413 au-delà de 5 Mo, sans rien écrire", async () => {
    const enorme = {
      ...deck,
      slides: [{ id: "s1", charge: "x".repeat(5 * 1024 * 1024 + 1) }],
    };
    const res = await enregistrerPresentation(
      requete({ deck: enorme, expectedVersion: PRESENTATION.version }),
      { params }
    );
    expect(res.status).toBe(413);
    aucuneEcriture();
  });

  it("refuse une charge utile qui n'est pas un diaporama", async () => {
    const res = await enregistrerPresentation(
      requete({ deck: { format: "n'importe quoi", version: 1, slides: [] }, expectedVersion: 4 }),
      { params }
    );
    expect(res.status).toBe(400);
    aucuneEcriture();
  });

  it("écrit la révision puis le courant, et incrémente la version", async () => {
    const res = await enregistrerPresentation(requete(corpsValide), { params });
    expect(res.status).toBe(200);
    expect(h.uploadFile.mock.calls.map((appel) => appel[0])).toEqual([
      `presentations/${PRESENTATION.id}/v5.json`,
      `presentations/${PRESENTATION.id}.json`,
    ]);
    expect((await res.json()).presentation.version).toBe(PRESENTATION.version + 1);
  });

  it("ne garde que les dix révisions les plus récentes, numériquement", async () => {
    const prefixe = `presentations/${PRESENTATION.id}/`;
    h.listKeys.mockResolvedValue(
      Array.from({ length: 12 }, (_, i) => `${prefixe}v${i + 1}.json`)
    );
    await enregistrerPresentation(requete(corpsValide), { params });
    // v1 et v2 partent : le tri est bien numérique, un tri lexicographique
    // aurait sacrifié v10 et v11.
    expect(h.deleteFile.mock.calls.map((appel) => appel[0]).sort()).toEqual([
      `${prefixe}v1.json`,
      `${prefixe}v2.json`,
    ]);
  });

  it("n'échoue pas sur une purge en erreur : l'enregistrement est déjà acquis", async () => {
    h.listKeys.mockRejectedValue(new Error("S3 indisponible"));
    const res = await enregistrerPresentation(requete(corpsValide), { params });
    expect(res.status).toBe(200);
  });
});

describe("suppression", () => {
  it("refuse un simple lecteur et laisse le stockage intact", async () => {
    h.requireOrgScoped.mockRejectedValue(refus(403, "permission-denied"));
    const res = await supprimerPresentation(requete(), { params });
    expect(res.status).toBe(403);
    expect(h.requireOrgScoped).toHaveBeenCalledWith({
      resource: { type: "space", id: ESPACE_VICTIME },
      minPermission: "editor",
    });
    expect(h.deleteFile).not.toHaveBeenCalled();
  });

  it("purge le préfixe complet et la clé courante", async () => {
    const prefixe = `presentations/${PRESENTATION.id}/`;
    h.listKeys.mockResolvedValue([`${prefixe}v3.json`, `${prefixe}v4.json`]);
    const res = await supprimerPresentation(requete(), { params });
    expect(res.status).toBe(200);
    expect(h.deleteFile.mock.calls.map((appel) => appel[0])).toEqual([
      `${prefixe}v3.json`,
      `${prefixe}v4.json`,
      `presentations/${PRESENTATION.id}.json`,
    ]);
  });
});

describe("identifiants non UUID et document porteur (revue finale, parties mineures)", () => {
  const MAUVAIS = Promise.resolve({ id: "pas-un-uuid" });

  it("GET, PUT et DELETE d'un identifiant non UUID : 404, aucune requête en base", async () => {
    const put = { deck: createEmptyDeck("X"), expectedVersion: 1 };
    expect((await lirePresentation(requete(), { params: MAUVAIS })).status).toBe(404);
    expect((await enregistrerPresentation(requete(put), { params: MAUVAIS })).status).toBe(404);
    expect((await supprimerPresentation(requete(), { params: MAUVAIS })).status).toBe(404);
    expect(h.ligne).not.toHaveBeenCalled();
    aucuneEcriture();
  });

  it("liste avec un spaceId non UUID : 404, jamais 500", async () => {
    const res = await listerPresentations(
      requete(undefined, "http://localhost/api/presentations?spaceId=nimporte")
    );
    expect(res.status).toBe(404);
    expect(h.requireOrgScoped).not.toHaveBeenCalled();
    expect(h.liste).not.toHaveBeenCalled();
  });

  it("création avec un documentId refusé : 404 muet, ni ligne ni objet", async () => {
    canLinkDocument.mockResolvedValue(false);
    const res = await creerPresentation(
      requete({ spaceId: ESPACE_VICTIME, documentId: "44444444-4444-4444-8444-444444444444" })
    );
    expect(res.status).toBe(404);
    expect(canLinkDocument).toHaveBeenCalledWith(
      expect.objectContaining({ id: PRESENTATION.createdBy }),
      "44444444-4444-4444-8444-444444444444",
      ESPACE_VICTIME
    );
    aucuneEcriture();
  });

  it("création avec un documentId admis : 201", async () => {
    const res = await creerPresentation(
      requete({ spaceId: ESPACE_VICTIME, documentId: "44444444-4444-4444-8444-444444444444" })
    );
    expect(res.status).toBe(201);
  });
});
