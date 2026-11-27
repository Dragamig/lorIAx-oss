import { describe, it, expect, vi, beforeEach } from "vitest";

const h = vi.hoisted(() => ({
  dbRows: [] as unknown[][],
  deleted: [] as unknown[],
}));

const getOwn = vi.fn();
const claim = vi.fn();
const markApplied = vi.fn();
const markFailed = vi.fn();
const recordOverrides = vi.fn();
const requireOrgScoped = vi.fn();
const getSettings = vi.fn();
const guardModule = vi.fn();
const deleteFileMock = vi.fn();
const isQuotaExceeded = vi.fn();
const createDocument = vi.fn();
const createSpreadsheetDocument = vi.fn();
const createPresentation = vi.fn();
const markUndone = vi.fn();

const { OrgScopeError } = vi.hoisted(() => ({
  OrgScopeError: class extends Error {
    constructor(public response: unknown, public reason: string) {
      super(reason);
    }
  },
}));

vi.mock("@/lib/ai/creation/store", () => ({
  getOwnCreationProposal: (...a: unknown[]) => getOwn(...a),
  claimForApply: (...a: unknown[]) => claim(...a),
  markApplied: (...a: unknown[]) => markApplied(...a),
  markFailed: (...a: unknown[]) => markFailed(...a),
  markUndone: (...a: unknown[]) => markUndone(...a),
  recordOverrides: (...a: unknown[]) => recordOverrides(...a),
}));
vi.mock("@/lib/auth/require-org-scoped", () => ({
  requireOrgScoped: (...a: unknown[]) => requireOrgScoped(...a),
  OrgScopeError,
}));
vi.mock("@/lib/ai/chat-actions-settings", () => ({
  getChatActionsSettings: (...a: unknown[]) => getSettings(...a),
  PROPOSAL_TYPE_DISABLED_MESSAGE: "désactivée",
}));
vi.mock("@/lib/presentations/guards", () => ({
  guardPresentationsModuleForOrg: (...a: unknown[]) => guardModule(...a),
}));
vi.mock("@/lib/rate-limit", () => ({
  isQuotaExceeded: (...a: unknown[]) => isQuotaExceeded(...a),
}));
vi.mock("@/lib/documents/create-document", () => ({
  createDocument: (...a: unknown[]) => createDocument(...a),
}));
vi.mock("@/lib/documents/create-spreadsheet-document", () => ({
  createSpreadsheetDocument: (...a: unknown[]) => createSpreadsheetDocument(...a),
}));
vi.mock("@/lib/presentations/create-presentation", () => ({
  createPresentation: (...a: unknown[]) => createPresentation(...a),
}));
vi.mock("@/lib/presentations/build-deck-from-outline", () => ({
  buildDeckFromOutline: (title: string) => ({ deck: title }),
}));
vi.mock("@/lib/storage/s3", () => ({ listKeys: async () => [], deleteFile: (...a: unknown[]) => deleteFileMock(...a) }));
vi.mock("@/lib/presentations/versioned-write", () => ({
  presentationKey: (id: string) => `p/${id}`,
  revisionPrefix: (id: string) => `r/${id}`,
}));
vi.mock("@/lib/db/schema", () => ({
  documents: { id: "d.id", spaceId: "d.spaceId", createdAt: "d.createdAt", updatedAt: "d.updatedAt", contentText: "d.ct" },
  presentations: { id: "p.id", spaceId: "p.spaceId", createdAt: "p.createdAt", updatedAt: "p.updatedAt", version: "p.v" },
  spreadsheetData: { sheetId: "s.sheetId", updatedAt: "s.updatedAt" },
  documentCollabStates: { documentId: "c.documentId", updatedAt: "c.updatedAt" },
  documentComments: { id: "cm.id", documentId: "cm.documentId" },
}));
vi.mock("drizzle-orm", () => ({
  and: (...c: unknown[]) => c,
  eq: (a: unknown, b: unknown) => [a, b],
}));
vi.mock("@/lib/db", () => {
  const select = () => {
    const c: Record<string, unknown> = {};
    c.from = () => c;
    c.where = () => c;
    c.limit = () => Promise.resolve(h.dbRows.shift() ?? []);
    return c;
  };
  return {
    db: {
      select,
      delete: () => ({
        where: (w: unknown) => {
          h.deleted.push(w);
          return Promise.resolve();
        },
      }),
    },
  };
});

import { applyCreation, undoCreation } from "../apply";

const SPACE = "11111111-1111-4111-8111-111111111111";
const OTHER = "22222222-2222-4222-8222-222222222222";
const user = { id: "u1", name: "U", email: "u@x.fr", globalRole: "member" } as never;
const req = {} as never;

function row(kind: string, payload: Record<string, unknown>, extra: Record<string, unknown> = {}) {
  return { id: "prop1", orgId: "org1", userId: "u1", kind, payload, status: "pending", resultId: null, ...extra };
}
const sheetPayload = { spaceId: SPACE, title: "T", columns: [{ name: "A" }], rows: [["x"]] };
const docPayload = { spaceId: SPACE, title: "D", outline: [{ heading: "H", level: 1 }] };
const deckPayload = { spaceId: SPACE, title: "P", slides: [{ title: "S" }] };

const call = (overrides?: unknown) =>
  applyCreation({ proposalId: "prop1", user, orgId: "org1", overrides, req });

beforeEach(() => {
  vi.clearAllMocks();
  h.dbRows = [];
  h.deleted = [];
  getOwn.mockResolvedValue(row("spreadsheet", sheetPayload));
  claim.mockResolvedValue(true);
  requireOrgScoped.mockResolvedValue({ orgId: "org1", spaceId: SPACE, permission: "editor" });
  getSettings.mockResolvedValue({
    proposeSpreadsheets: true,
    proposeDocuments: true,
    proposePresentations: true,
  });
  guardModule.mockResolvedValue(null);
  isQuotaExceeded.mockResolvedValue(false);
  createSpreadsheetDocument.mockResolvedValue({ document: { id: "doc1", spaceId: SPACE, title: "T" }, sheetId: "sh" });
  createDocument.mockResolvedValue({ id: "doc2", spaceId: SPACE, title: "D" });
  createPresentation.mockResolvedValue({ id: "pres1", spaceId: SPACE, title: "P" });
  h.dbRows.push([{ id: "parent" }]);
});

describe("applyCreation", () => {
  it("crée un tableur, enregistre result_id, DTO sans clé de stockage", async () => {
    const out = await call();
    expect(out.status).toBe("applied");
    expect(createSpreadsheetDocument).toHaveBeenCalledTimes(1);
    expect(markApplied).toHaveBeenCalledWith("prop1", "doc1", "document");
    expect(JSON.stringify(out)).not.toMatch(/filePath|Key|sheetId/);
    expect(createSpreadsheetDocument.mock.calls[0][0]).toMatchObject({
      visibility: "private",
      activitySource: "ai_chat",
      createdBy: "u1",
    });
  });

  it("crée un document (private, ai_chat) et une présentation", async () => {
    getOwn.mockResolvedValue(row("document", docPayload));
    expect((await call()).status).toBe("applied");
    expect(createDocument.mock.calls[0][0]).toMatchObject({ visibility: "private", activitySource: "ai_chat" });
    getOwn.mockResolvedValue(row("presentation", deckPayload));
    expect((await call()).status).toBe("applied");
    expect(createPresentation).toHaveBeenCalledTimes(1);
    expect(markApplied).toHaveBeenLastCalledWith("prop1", "pres1", "presentation");
  });

  it("proposition d'un autre utilisateur : introuvable (null), rien créé", async () => {
    getOwn.mockResolvedValue(null);
    expect((await call()).status).toBe("not_found");
    expect(createSpreadsheetDocument).not.toHaveBeenCalled();
    expect(getOwn).toHaveBeenCalledWith("org1", "u1", "prop1");
  });

  it("droit éditeur retiré : refusée, proposition non consommée", async () => {
    requireOrgScoped.mockRejectedValue(new OrgScopeError({}, "permission-denied"));
    const out = await call();
    expect(out.status).toBe("refused");
    expect(claim).not.toHaveBeenCalled();
    expect(createSpreadsheetDocument).not.toHaveBeenCalled();
  });

  it("espace modifié vers un espace sans droit : refusé, droit vérifié sur l'espace effectif", async () => {
    requireOrgScoped.mockImplementation(async (o: { resource: { id: string } }) => {
      if (o.resource.id === OTHER) throw new OrgScopeError({}, "permission-denied");
      return { orgId: "org1", spaceId: SPACE, permission: "editor" };
    });
    const out = await call({ spaceId: OTHER });
    expect(out.status).toBe("refused");
    expect(requireOrgScoped.mock.calls[0][0].resource.id).toBe(OTHER);
    expect(createSpreadsheetDocument).not.toHaveBeenCalled();
  });

  it("espace d'une autre organisation renvoyé par le garde : refusé", async () => {
    requireOrgScoped.mockResolvedValue({ orgId: "autre", spaceId: SPACE, permission: "editor" });
    expect((await call()).status).toBe("refused");
  });

  it("double clic : un seul fichier créé", async () => {
    claim.mockResolvedValueOnce(true).mockResolvedValueOnce(false);
    h.dbRows.push([{ id: "parent" }]);
    const [a, b] = await Promise.all([call(), call()]);
    expect([a.status, b.status].sort()).toEqual(["applied", "refused"]);
    expect(createSpreadsheetDocument).toHaveBeenCalledTimes(1);
  });

  it("interrupteur éteint : refusé avec le message dédié", async () => {
    getSettings.mockResolvedValue({ proposeSpreadsheets: false });
    const out = await call();
    expect(out).toMatchObject({ status: "refused", message: "désactivée" });
    expect(claim).not.toHaveBeenCalled();
  });

  it("visibilité venue du modèle : payload invalide, rien créé", async () => {
    getOwn.mockResolvedValue(row("document", { ...docPayload, visibility: "public" }));
    expect((await call()).status).toBe("invalid");
    expect(createDocument).not.toHaveBeenCalled();
  });

  it("document créé en private sans lire de visibilité du payload", async () => {
    getOwn.mockResolvedValue(row("document", docPayload));
    await call();
    expect(createDocument.mock.calls[0][0].visibility).toBe("private");
  });

  it("module Présentations vérifié sur l'orgId de la proposition", async () => {
    getOwn.mockResolvedValue(row("presentation", deckPayload, { orgId: "orgProp" }));
    await applyCreation({ proposalId: "prop1", user, orgId: "orgProp", req });
    expect(guardModule).toHaveBeenCalledWith("orgProp");
  });

  it("échec S3 de la présentation : ligne et objets nettoyés, markFailed", async () => {
    getOwn.mockResolvedValue(row("presentation", deckPayload));
    createPresentation.mockRejectedValue(Object.assign(new Error("s3"), { presentationId: "pres9" }));
    const out = await call();
    expect(out.status).toBe("failed");
    expect(h.deleted.length).toBe(1);
    expect(deleteFileMock).toHaveBeenCalledWith("p/pres9");
    expect(markFailed).toHaveBeenCalledWith("prop1");
  });

  it("markApplied échoue une fois : nouvel essai, proposition appliquée", async () => {
    markApplied.mockRejectedValueOnce(new Error("db")).mockResolvedValue(undefined);
    const out = await call();
    expect(out.status).toBe("applied");
    expect(markApplied).toHaveBeenCalledTimes(2);
    expect(markFailed).not.toHaveBeenCalled();
  });

  it("markApplied échoue toujours : objet conservé, jamais failed, jamais de doublon", async () => {
    markApplied.mockRejectedValue(new Error("db"));
    const out = await call();
    expect(out.status).toBe("applied");
    expect(markFailed).not.toHaveBeenCalled();
    expect(createSpreadsheetDocument).toHaveBeenCalledTimes(1);
  });

  it("présentation sans module : refusée", async () => {
    getOwn.mockResolvedValue(row("presentation", deckPayload));
    guardModule.mockResolvedValue({ status: 404 });
    const out = await call();
    expect(out.status).toBe("refused");
    expect(createPresentation).not.toHaveBeenCalled();
  });

  it("overrides invalides : rejetés, rien créé", async () => {
    expect((await call({ userId: "x" })).status).toBe("invalid");
    expect((await call({ spaceId: "pas-un-uuid" })).status).toBe("invalid");
    expect(createSpreadsheetDocument).not.toHaveBeenCalled();
  });

  it("overrides valides : appliqués et journalisés, payload stocké inchangé", async () => {
    const out = await call({ title: "Nouveau" });
    expect(out.status).toBe("applied");
    expect(createSpreadsheetDocument.mock.calls[0][0].title).toBe("Nouveau");
    expect(recordOverrides).toHaveBeenCalledWith("prop1", { title: "Nouveau" });
  });

  it("payload stocké corrompu : re-validation zod, refus sans création", async () => {
    getOwn.mockResolvedValue(row("spreadsheet", { ...sheetPayload, columns: [] }));
    expect((await call()).status).toBe("invalid");
    expect(createSpreadsheetDocument).not.toHaveBeenCalled();
  });

  it("quota compté ; épuisé : refusé avant claim", async () => {
    await call();
    expect(isQuotaExceeded).toHaveBeenCalledWith(expect.stringContaining("u1"), expect.any(Array));
    isQuotaExceeded.mockResolvedValue(true);
    h.dbRows.push([{ id: "parent" }]);
    const out = await call();
    expect(out.status).toBe("refused");
    expect(claim).toHaveBeenCalledTimes(1);
  });

  it("échec de création : markFailed, statut failed", async () => {
    createSpreadsheetDocument.mockRejectedValue(new Error("boom"));
    const out = await call();
    expect(out.status).toBe("failed");
    expect(markFailed).toHaveBeenCalledWith("prop1");
    expect(markApplied).not.toHaveBeenCalled();
  });

  it("proposition déjà traitée : refusée", async () => {
    getOwn.mockResolvedValue(row("spreadsheet", sheetPayload, { status: "applied" }));
    expect((await call()).status).toBe("refused");
    expect(claim).not.toHaveBeenCalled();
  });
});

describe("undoCreation", () => {
  const t0 = new Date("2026-11-26T10:00:00Z");
  const applied = (kind = "document") =>
    row(kind, docPayload, { status: "applied", resultId: "doc2", resultType: kind === "presentation" ? "presentation" : "document" });

  it("supprime l'objet non modifié", async () => {
    getOwn.mockResolvedValue(applied());
    h.dbRows = [[{ id: "doc2", spaceId: SPACE, createdAt: t0, updatedAt: t0, contentText: "x" }]];
    const out = await undoCreation({ proposalId: "prop1", user, orgId: "org1", req });
    expect(out.status).toBe("undone");
    expect(h.deleted.length).toBeGreaterThan(0);
    expect(markUndone).toHaveBeenCalledWith("prop1", "org1", "u1");
  });

  it("refus d'annulation : le statut n'est pas passé à undone", async () => {
    getOwn.mockResolvedValue(applied());
    h.dbRows = [[{ id: "doc2", spaceId: SPACE, createdAt: t0, updatedAt: new Date(t0.getTime() + 5000), contentText: "x" }]];
    expect((await undoCreation({ proposalId: "prop1", user, orgId: "org1", req })).status).toBe("refused");
    expect(markUndone).not.toHaveBeenCalled();
  });

  const T_APPLIED = new Date(t0.getTime() + 1000);
  const appliedRow = () => ({ ...applied(), appliedAt: T_APPLIED });
  const docRow = [{ id: "doc2", spaceId: SPACE, createdAt: t0, updatedAt: t0, contentText: "x" }];

  it("état Yjs seedé à la création : annulation permise", async () => {
    getOwn.mockResolvedValue(appliedRow());
    h.dbRows = [docRow, [{ updatedAt: t0 }], [], []];
    expect((await undoCreation({ proposalId: "prop1", user, orgId: "org1", req })).status).toBe("undone");
  });

  it("état Yjs écrit après l'application : annulation refusée", async () => {
    getOwn.mockResolvedValue(appliedRow());
    h.dbRows = [docRow, [{ updatedAt: new Date(T_APPLIED.getTime() + 5000) }]];
    const out = await undoCreation({ proposalId: "prop1", user, orgId: "org1", req });
    expect(out).toMatchObject({ status: "refused", message: expect.stringContaining("modifié") });
    expect(h.deleted).toHaveLength(0);
  });

  it("document avec enfant : annulation refusée", async () => {
    getOwn.mockResolvedValue(appliedRow());
    h.dbRows = [docRow, [], [{ id: "child" }]];
    expect((await undoCreation({ proposalId: "prop1", user, orgId: "org1", req })).status).toBe("refused");
    expect(h.deleted).toHaveLength(0);
  });

  it("document avec commentaire : annulation refusée", async () => {
    getOwn.mockResolvedValue(appliedRow());
    h.dbRows = [docRow, [], [], [{ id: "c1" }]];
    expect((await undoCreation({ proposalId: "prop1", user, orgId: "org1", req })).status).toBe("refused");
    expect(h.deleted).toHaveLength(0);
  });

  it("refusé après modification", async () => {
    getOwn.mockResolvedValue(applied());
    h.dbRows = [[{ id: "doc2", spaceId: SPACE, createdAt: t0, updatedAt: new Date(t0.getTime() + 5000), contentText: "x" }]];
    const out = await undoCreation({ proposalId: "prop1", user, orgId: "org1", req });
    expect(out.status).toBe("refused");
    expect(out).toMatchObject({ message: expect.any(String) });
    expect(h.deleted).toHaveLength(0);
  });

  it("refusé si le feuillet du tableur a été modifié", async () => {
    getOwn.mockResolvedValue(applied("spreadsheet"));
    h.dbRows = [
      [{ id: "doc2", spaceId: SPACE, createdAt: t0, updatedAt: t0, contentText: '<div sheetid="abc"></div>' }],
      [{ updatedAt: new Date(t0.getTime() + 9000) }],
    ];
    const out = await undoCreation({ proposalId: "prop1", user, orgId: "org1", req });
    expect(out.status).toBe("refused");
    expect(h.deleted).toHaveLength(0);
  });

  it("proposition d'un autre utilisateur : not_found", async () => {
    getOwn.mockResolvedValue(null);
    expect((await undoCreation({ proposalId: "prop1", user, orgId: "org1", req })).status).toBe("not_found");
  });

  it("droit éditeur retiré : refusé", async () => {
    getOwn.mockResolvedValue(applied());
    h.dbRows = [[{ id: "doc2", spaceId: SPACE, createdAt: t0, updatedAt: t0, contentText: "x" }]];
    requireOrgScoped.mockRejectedValue(new OrgScopeError({}, "permission-denied"));
    expect((await undoCreation({ proposalId: "prop1", user, orgId: "org1", req })).status).toBe("refused");
    expect(h.deleted).toHaveLength(0);
  });

  it("proposition non appliquée : refusée", async () => {
    getOwn.mockResolvedValue(row("document", docPayload));
    expect((await undoCreation({ proposalId: "prop1", user, orgId: "org1", req })).status).toBe("refused");
  });
});
