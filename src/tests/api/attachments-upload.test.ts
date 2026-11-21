import { describe, it, expect, vi, beforeEach } from "vitest";
import { registerHooks, resetHooksForTests } from "@/lib/modules/hooks";
import { beforeEach as hooksBeforeEach } from "vitest";
hooksBeforeEach(() => {
  resetHooksForTests();
  registerHooks({ usage: { checkUsersLimit: async () => { throw new Error('unused'); }, checkSpacesLimit: async () => { throw new Error('unused'); }, getOrgStorageLimitBytes: async (...a: unknown[]) => null } });
});


/**
 * FACTURE DU HARNAIS. Les doublures conservent l'implémentation réelle des
 * exports non pilotés (`importOriginal`) et pilotent AUSSI `getSpacePermission`,
 * l'export utilisé par l'implémentation d'avant le lot. Le niveau de l'espace
 * est décrit une seule fois (`h.niveauEspace`) et les deux fonctions en
 * dérivent : `getSpacePermission` le rend tel quel (aucun seuil, comportement
 * d'origine), `checkSpaceWriteAccess` n'accorde qu'à partir d'`editor`.
 * Rétablir la route dans sa version d'avant le lot fait donc rougir sur une
 * ASSERTION, jamais sur un export manquant.
 */
const h = vi.hoisted(() => ({
  // Niveau réel de l'utilisateur sur `space-1`, null = aucun accès
  niveauEspace: "editor" as "viewer" | "editor" | "admin" | null,
  checkSpaceWriteAccess: vi.fn(),
  getSpacePermission: vi.fn(),
  uploadFile: vi.fn(),
  insertCalls: { count: 0 },
}));

// Auth OK par défaut. Module réel non rechargé : il tire next-auth, non
// chargeable sous vitest, et n'expose qu'un export utile ici.
vi.mock("@/lib/auth/get-user", () => ({
  getSessionUser: vi.fn().mockResolvedValue({ id: "user-1", globalRole: "editor" }),
}));
// AZ-16 : la route s'appuie désormais sur checkSpaceWriteAccess, qui confine
// l'espace à l'organisation courante ET refuse le niveau `viewer`. Elle
// n'appelle plus getSpacePermission, qui ne faisait ni l'un ni l'autre.
vi.mock("@/lib/auth/check-access", async (importOriginal) => ({
  ...(await importOriginal<typeof import("@/lib/auth/check-access")>()),
  checkSpaceWriteAccess: h.checkSpaceWriteAccess,
  getSpacePermission: h.getSpacePermission,
}));

// Organisation de la requête et limite de stockage : l'ingestion en dépend.
vi.mock("@/lib/org/get-request-org", () => ({
  getRequestOrgId: vi.fn().mockResolvedValue("org-1"),
}));

// Stockage S3 : upload no-op, getFileUrl renvoie une URL présignée éphémère
// (c'est précisément ce qu'on NE veut PAS voir persister dans le document).
const presigned =
  "http://localhost:3900/loriax-files/space-1/abc.png?X-Amz-Algorithm=AWS4-HMAC-SHA256&X-Amz-Expires=900&X-Amz-Signature=deadbeef";
vi.mock("@/lib/storage/s3", async (importOriginal) => ({
  ...(await importOriginal<typeof import("@/lib/storage/s3")>()),
  uploadFile: h.uploadFile,
  getFileUrl: vi.fn().mockResolvedValue(presigned),
}));

// file-type : reconnait un PNG
vi.mock("file-type", async (importOriginal) => ({
  ...(await importOriginal<typeof import("file-type")>()),
  fileTypeFromBuffer: vi.fn().mockResolvedValue({ ext: "png", mime: "image/png" }),
}));

/**
 * Faux client Drizzle : il répond à l'insertion quelle que soit la table visée
 * et quel que soit le nombre de requêtes, jamais par rang d'appel. Le schéma
 * réel n'est pas doublé, les vraies tables restent donc reconnaissables.
 */
vi.mock("@/lib/db", () => {
  const ligne = {
    id: "att-1",
    documentId: null,
    spaceId: "space-1",
    filename: "photo.png",
    mimeType: "image/png",
    sizeBytes: 75,
    storageKey: "space-1/abc.png",
    uploadedBy: "user-1",
  };
  const chaine = (lignes: unknown[]) => {
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const self: any = {
      from: () => self,
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
  const base = {
      select: () => chaine([]),
      insert: () => {
        h.insertCalls.count += 1;
        return chaine([ligne]);
      },
      update: () => chaine([ligne]),
      delete: () => chaine([ligne]),
      execute: () => Promise.resolve({ rows: [] }),
  };
  return {
    db: {
      ...base,
      // L'ingestion insère sous verrou consultatif, dans une transaction.
      transaction: (fn: (tx: unknown) => Promise<unknown>) => fn(base),
    },
  };
});

function pngFormData(): FormData {
  const fd = new FormData();
  const png = new Uint8Array([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]);
  fd.append("file", new File([png], "photo.png", { type: "image/png" }));
  fd.append("spaceId", "space-1");
  return fd;
}

function post(fd: FormData) {
  const req = new Request("http://localhost/api/attachments", {
    method: "POST",
    body: fd,
  });
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  return import("@/app/api/attachments/route").then(({ POST }) => POST(req as any));
}

/** Décrit le niveau de l'utilisateur sur l'espace pour les deux doublures. */
function poserNiveauEspace(niveau: "viewer" | "editor" | "admin" | null) {
  h.niveauEspace = niveau;
  h.getSpacePermission.mockResolvedValue(niveau);
  h.checkSpaceWriteAccess.mockResolvedValue(niveau === "editor" || niveau === "admin");
}

beforeEach(() => {
  vi.clearAllMocks();
  h.insertCalls.count = 0;
  poserNiveauEspace("editor");
});

/**
 * Non-régression sur l'audit du 2026-08-19, constat AZ-16.
 *
 * La route se contentait de `getSpacePermission`, donc sans filtre
 * d'organisation et surtout SANS AUCUN SEUIL : le niveau `viewer` suffisait à
 * téléverser 50 Mo dans un espace en lecture seule. Le volet cross-org est
 * fermé par ailleurs (AZ-06), le seuil manquant l'est ici.
 *
 * Motif du dépôt : « répond 403 ET ne fait rien », l'absence d'effet de bord
 * étant prouvée par le non-appel de `uploadFile` et de `db.insert`.
 */
describe("POST /api/attachments : droit d'écriture requis", () => {
  it("répond 403 quand l'espace n'autorise pas l'écriture, et ne stocke rien", async () => {
    // Le cas d'AZ-16 : l'utilisateur a bien un accès à l'espace, mais en
    // LECTURE SEULE. L'implémentation d'avant le lot se contentait de la
    // présence d'un niveau et laissait passer le téléversement.
    poserNiveauEspace("viewer");
    const res = await post(pngFormData());

    expect(res.status).toBe(403);
    await expect(res.json()).resolves.toEqual({
      error: "Accès refusé à cet espace",
    });
    expect(h.uploadFile).not.toHaveBeenCalled();
    expect(h.insertCalls.count).toBe(0);
  });

  it("contrôle l'écriture avec la session et le spaceId reçus", async () => {
    await post(pngFormData());
    expect(h.checkSpaceWriteAccess).toHaveBeenCalledWith(
      expect.objectContaining({ id: "user-1" }),
      "space-1",
      { orgId: "org-1" }
    );
  });

  it("téléverse quand le droit d'écriture est accordé", async () => {
    const res = await post(pngFormData());
    expect(res.status).toBe(201);
    expect(h.uploadFile).toHaveBeenCalledTimes(1);
  });
});

describe("POST /api/attachments : URL durable", () => {

  it("renvoie une URL stable same-origin (pas une URL présignée qui expire)", async () => {
    const { POST } = await import("@/app/api/attachments/route");
    const req = new Request("http://localhost/api/attachments", {
      method: "POST",
      body: pngFormData(),
    });
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const res = await POST(req as any);
    expect(res.status).toBe(201);
    const body = await res.json();

    // L'URL persistée dans le document NE DOIT PAS être une URL présignée éphémère.
    expect(body.url).not.toContain("X-Amz-Expires");
    expect(body.url).not.toContain("X-Amz-Signature");
    // Elle doit pointer vers la route de récupération stable, par clé de stockage.
    expect(body.url).toMatch(/^\/api\/attachments\/space-1\/[0-9a-f-]+\.png$/);
  });

  it("ajoute les en-têtes de dépréciation sur la réponse de succès", async () => {
    const { POST } = await import("@/app/api/attachments/route");
    const req = new Request("http://localhost/api/attachments", {
      method: "POST",
      body: pngFormData(),
    });
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const res = await POST(req as any);
    expect(res.status).toBe(201);
    expect(res.headers.get("Deprecation")).toBe("true");
    expect(res.headers.get("Link")).toBe('</api/media>; rel="successor-version"');
    const body = await res.json();
    expect(body.mediaUrl).toMatch(/^\/api\/media\//);
  });
});
