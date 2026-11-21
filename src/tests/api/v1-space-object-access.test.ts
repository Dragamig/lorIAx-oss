/**
 * Non-régression AZ-14 (audit du 2026-08-19) et son voisinage dans l'API v1.
 *
 * Les routes v1 confinaient leurs ressources à l'organisation de la clé d'API,
 * puis s'arrêtaient là : aucune ne demandait si le porteur de la clé avait le
 * moindre droit sur l'espace visé. Un compte légitime du tenant se fabriquait
 * une clé `documents:read` et lisait l'arborescence d'un espace interdit, une
 * clé `documents:write` et y créait un document, une clé `webhooks` et
 * s'abonnait en continu à ses événements.
 *
 * Motif de vérification, repris de `space-documents-access.test.ts` : le code
 * de retour ne prouve rien tout seul. Chaque refus est doublé de la preuve que
 * la route n'a produit AUCUN effet — pas de seconde requête de lecture, pas
 * d'appel de création, pas d'insertion en base.
 *
 * Le scope de clé (`requireScope`) est neutralisé dans ces tests : il est déjà
 * couvert ailleurs, et ce qu'on mesure ici est le droit d'OBJET, qui s'ajoute
 * au droit de scope au lieu de le remplacer.
 */
import { describe, it, expect, vi, beforeEach } from "vitest";

const h = vi.hoisted(() => ({
  authenticateApiRequest: vi.fn(),
  requireScope: vi.fn(),
  select: vi.fn(),
  insertValues: vi.fn(),
  insertReturning: vi.fn(),
  checkSpaceReadAccess: vi.fn(),
  getSpacePermission: vi.fn(),
  checkSpaceWriteAccess: vi.fn(),
  checkDocumentEditAccess: vi.fn(),
  createDocument: vi.fn(),
}));

vi.mock("@/lib/api/auth-api", () => ({
  authenticateApiRequest: h.authenticateApiRequest,
  requireScope: h.requireScope,
}));

vi.mock("@/lib/db", () => ({
  db: {
    select: h.select,
    insert: vi.fn(() => ({ values: h.insertValues })),
    update: vi.fn(() => ({ set: vi.fn() })),
  },
}));

// `importOriginal` : on n'étale que les deux fonctions réellement pilotées.
// Le reste du module garde ses exports véritables, si bien qu'un test rouge
// après annulation du correctif l'est pour une assertion, jamais pour un
// export manquant.
vi.mock("@/lib/auth/check-access", async (importOriginal) => ({
  ...(await importOriginal<typeof import("@/lib/auth/check-access")>()),
  checkSpaceReadAccess: h.checkSpaceReadAccess,
  getSpacePermission: h.getSpacePermission,
  checkSpaceWriteAccess: h.checkSpaceWriteAccess,
  checkDocumentEditAccess: h.checkDocumentEditAccess,
}));

// Idem : `SpaceNotFoundError` reste la classe d'origine, dont la route se sert
// dans un `instanceof`.
vi.mock("@/lib/documents/create-document", async (importOriginal) => ({
  ...(await importOriginal<typeof import("@/lib/documents/create-document")>()),
  createDocument: h.createDocument,
}));

const ORG = "org-acme";
const SPACE = "11111111-1111-4111-8111-111111111111";
const PARENT = "22222222-2222-4222-8222-222222222222";

const AUTH = {
  user: {
    id: "user-bob",
    orgId: ORG,
    email: "bob@acme.tld",
    name: "Bob",
    globalRole: "user",
    capabilities: [],
    scopes: ["documents:read", "documents:write", "webhooks"],
  },
};

/** Chaîne `select().from().where()...`, thenable quelle que soit sa longueur. */
function selectChain(rows: unknown[]) {
  const chain: Record<string, unknown> = {
    from: vi.fn(() => chain),
    innerJoin: vi.fn(() => chain),
    where: vi.fn(() => chain),
    orderBy: vi.fn(() => chain),
    limit: vi.fn(() => chain),
    then: (resolve: (v: unknown[]) => void, reject?: (e: unknown) => void) =>
      Promise.resolve(rows).then(resolve, reject),
  };
  return chain;
}

beforeEach(() => {
  vi.clearAllMocks();
  // `clearAllMocks` efface les appels, pas les implémentations ni les files
  // `mockReturnValueOnce`. Sans ces remises à zéro ciblées, une file de
  // chaînes `select` non consommée par un test fuiterait dans le suivant et
  // rendrait la suite dépendante de son ordre d'exécution : un test pourrait
  // alors passer ou échouer pour une raison étrangère à ce qu'il mesure.
  h.select.mockReset();
  h.checkSpaceReadAccess.mockReset();
  h.checkSpaceWriteAccess.mockReset();
  h.authenticateApiRequest.mockResolvedValue(AUTH);
  h.requireScope.mockReturnValue(null);
  h.insertValues.mockReturnValue({ returning: h.insertReturning });
  h.insertReturning.mockResolvedValue([{ id: "wh-1" }]);
  h.createDocument.mockResolvedValue({ id: "doc-1", title: "Note" });
  h.checkDocumentEditAccess.mockResolvedValue(true);
});

// ───────────────────────────────────────────────────────────────────────────
describe("GET /api/v1/spaces/:slug/documents — droit de lecture sur l'espace", () => {
  const ctx = { params: Promise.resolve({ slug: "direction" }) };
  const req = () =>
    new Request("http://acme.example.com/api/v1/spaces/direction/documents");

  it("répond 403 et ne lit aucun document quand la clé n'a aucun droit sur l'espace", async () => {
    h.select.mockReturnValue(selectChain([{ id: SPACE, name: "Direction" }]));
    h.checkSpaceReadAccess.mockResolvedValue(false);

    const { GET } = await import("@/app/api/v1/spaces/[slug]/documents/route");
    const res = await GET(req(), ctx);

    expect(res.status).toBe(403);
    await expect(res.json()).resolves.toMatchObject({ error: "Accès refusé" });
    // Absence d'effet : la seule requête émise est la résolution de l'espace,
    // jamais la lecture de l'arborescence.
    expect(h.select).toHaveBeenCalledTimes(1);
  });

  it("répond 404 sans consulter les droits quand l'espace est hors de l'organisation de la clé", async () => {
    h.select.mockReturnValue(selectChain([]));

    const { GET } = await import("@/app/api/v1/spaces/[slug]/documents/route");
    const res = await GET(req(), ctx);

    expect(res.status).toBe(404);
    expect(h.checkSpaceReadAccess).not.toHaveBeenCalled();
  });

  it("répond 200 et sert l'arborescence à un simple lecteur de l'espace", async () => {
    h.select
      .mockReturnValueOnce(selectChain([{ id: SPACE, name: "Direction" }]))
      .mockReturnValueOnce(
        selectChain([{ id: "doc-1", title: "Feuille de route", classification: "internal", createdBy: "autre" }])
      );
    h.checkSpaceReadAccess.mockResolvedValue(true);
    h.getSpacePermission.mockResolvedValue("viewer");

    const { GET } = await import("@/app/api/v1/spaces/[slug]/documents/route");
    const res = await GET(req(), ctx);

    expect(res.status).toBe(200);
    expect(h.checkSpaceReadAccess).toHaveBeenCalledWith(AUTH.user, SPACE);
    await expect(res.json()).resolves.toMatchObject({
      data: [{ id: "doc-1", title: "Feuille de route" }],
    });
  });
});

// ───────────────────────────────────────────────────────────────────────────
describe("POST /api/v1/documents — droit d'écriture sur l'espace", () => {
  const req = (body: Record<string, unknown>) =>
    new Request("http://acme.example.com/api/v1/documents", {
      method: "POST",
      body: JSON.stringify(body),
    });

  it("répond 403 et ne crée rien quand la clé n'a pas le droit d'écrire dans l'espace", async () => {
    h.select.mockReturnValue(selectChain([{ id: SPACE }]));
    h.checkSpaceWriteAccess.mockResolvedValue(false);

    const { POST } = await import("@/app/api/v1/documents/route");
    const res = await POST(req({ spaceId: SPACE, title: "Intrusion" }));

    expect(res.status).toBe(403);
    await expect(res.json()).resolves.toMatchObject({ error: "Accès refusé" });
    // Absence d'effet : aucune écriture de document, ni fichier, ni ligne.
    expect(h.createDocument).not.toHaveBeenCalled();
  });

  it("refuse en 403 le simple lecteur d'un espace, la lecture ne vaut pas écriture", async () => {
    h.select.mockReturnValue(selectChain([{ id: SPACE }]));
    // `checkSpaceWriteAccess` refuse le niveau `viewer` : c'est ce refus-là
    // qu'on rejoue, pour que la route ne se contente jamais d'un droit de
    // lecture là où elle écrit.
    h.checkSpaceWriteAccess.mockResolvedValue(false);
    h.checkSpaceReadAccess.mockResolvedValue(true);

    const { POST } = await import("@/app/api/v1/documents/route");
    const res = await POST(req({ spaceId: SPACE, title: "Intrusion" }));

    expect(res.status).toBe(403);
    expect(h.createDocument).not.toHaveBeenCalled();
  });

  it("répond 404 sans consulter les droits quand l'espace est hors de l'organisation de la clé", async () => {
    h.select.mockReturnValue(selectChain([]));

    const { POST } = await import("@/app/api/v1/documents/route");
    const res = await POST(req({ spaceId: SPACE, title: "Intrusion" }));

    expect(res.status).toBe(404);
    expect(h.checkSpaceWriteAccess).not.toHaveBeenCalled();
    expect(h.createDocument).not.toHaveBeenCalled();
  });

  it("répond 404 et ne crée rien quand le parent visé vit dans un autre espace", async () => {
    h.select
      .mockReturnValueOnce(selectChain([{ id: SPACE }])) // espace de l'org
      .mockReturnValueOnce(selectChain([])); // parent absent DE CET espace
    h.checkSpaceWriteAccess.mockResolvedValue(true);

    const { POST } = await import("@/app/api/v1/documents/route");
    const res = await POST(
      req({ spaceId: SPACE, title: "Greffe", parentId: PARENT })
    );

    expect(res.status).toBe(404);
    expect(h.createDocument).not.toHaveBeenCalled();
  });

  it("répond 201 et crée le document pour un éditeur de l'espace", async () => {
    h.select.mockReturnValue(selectChain([{ id: SPACE }]));
    h.checkSpaceWriteAccess.mockResolvedValue(true);

    const { POST } = await import("@/app/api/v1/documents/route");
    const res = await POST(req({ spaceId: SPACE, title: "Note" }));

    expect(res.status).toBe(201);
    expect(h.checkSpaceWriteAccess).toHaveBeenCalledWith(AUTH.user, SPACE);
    expect(h.createDocument).toHaveBeenCalledTimes(1);
  });
});

// ───────────────────────────────────────────────────────────────────────────
describe("POST /api/v1/webhooks — droit de lecture sur l'espace abonné", () => {
  const req = (body: Record<string, unknown>) =>
    new Request("http://acme.example.com/api/v1/webhooks", {
      method: "POST",
      body: JSON.stringify(body),
    });

  const payload = {
    url: "https://exemple.tld/hook",
    events: ["document.created"],
    spaceId: SPACE,
  };

  it("répond 403 et n'insère rien quand la clé n'a aucun droit sur l'espace visé", async () => {
    h.select
      .mockReturnValueOnce(selectChain([])) // webhooks existants (quota)
      .mockReturnValueOnce(selectChain([{ id: SPACE }])); // espace de l'org
    h.checkSpaceReadAccess.mockResolvedValue(false);

    const { POST } = await import("@/app/api/v1/webhooks/route");
    const res = await POST(req(payload));

    expect(res.status).toBe(403);
    await expect(res.json()).resolves.toMatchObject({ error: "Accès refusé" });
    // Absence d'effet : aucun abonnement posé en base, donc aucune livraison
    // future des titres de documents de cet espace.
    expect(h.insertValues).not.toHaveBeenCalled();
  });

  it("répond 404 sans consulter les droits quand l'espace est hors de l'organisation de la clé", async () => {
    h.select
      .mockReturnValueOnce(selectChain([]))
      .mockReturnValueOnce(selectChain([]));

    const { POST } = await import("@/app/api/v1/webhooks/route");
    const res = await POST(req(payload));

    expect(res.status).toBe(404);
    expect(h.checkSpaceReadAccess).not.toHaveBeenCalled();
    expect(h.insertValues).not.toHaveBeenCalled();
  });

  it("répond 201 pour un lecteur de l'espace visé", async () => {
    h.select
      .mockReturnValueOnce(selectChain([]))
      .mockReturnValueOnce(selectChain([{ id: SPACE }]));
    h.checkSpaceReadAccess.mockResolvedValue(true);

    const { POST } = await import("@/app/api/v1/webhooks/route");
    const res = await POST(req(payload));

    expect(res.status).toBe(201);
    expect(h.checkSpaceReadAccess).toHaveBeenCalledWith(AUTH.user, SPACE);
    expect(h.insertValues).toHaveBeenCalledTimes(1);
  });

  it("répond 201 sans contrôle d'espace pour un webhook global à l'organisation", async () => {
    h.select.mockReturnValue(selectChain([]));

    const { POST } = await import("@/app/api/v1/webhooks/route");
    const res = await POST(
      req({ url: "https://exemple.tld/hook", events: ["document.created"] })
    );

    expect(res.status).toBe(201);
    expect(h.checkSpaceReadAccess).not.toHaveBeenCalled();
  });
});

// ───────────────────────────────────────────────────────────────────────────
describe("POST /api/v1/documents/:id/comments — fil parent borné au document", () => {
  const ctx = { params: Promise.resolve({ id: "doc-1" }) };
  const req = (body: Record<string, unknown>) =>
    new Request("http://acme.example.com/api/v1/documents/doc-1/comments", {
      method: "POST",
      body: JSON.stringify(body),
    });

  it("répond 404 et n'insère rien quand le commentaire parent relève d'un autre document", async () => {
    h.select
      .mockReturnValueOnce(selectChain([{ id: "doc-1", spaceId: SPACE }]))
      .mockReturnValueOnce(selectChain([])); // parent absent de CE document

    const { POST } = await import("@/app/api/v1/documents/[id]/comments/route");
    const res = await POST(req({ content: "Bonjour", parentId: PARENT }), ctx);

    expect(res.status).toBe(404);
    expect(h.insertValues).not.toHaveBeenCalled();
  });

  it("répond 201 quand le fil parent appartient bien au document", async () => {
    h.select
      .mockReturnValueOnce(selectChain([{ id: "doc-1", spaceId: SPACE }]))
      .mockReturnValueOnce(selectChain([{ id: PARENT }]));
    h.insertReturning.mockResolvedValue([{ id: "c-1", content: "Bonjour" }]);

    const { POST } = await import("@/app/api/v1/documents/[id]/comments/route");
    const res = await POST(req({ content: "Bonjour", parentId: PARENT }), ctx);

    expect(res.status).toBe(201);
    expect(h.insertValues).toHaveBeenCalledTimes(1);
  });
});
