/**
 * Non-régression P0-6 / AZ-02 / AZ-12 / INJ-23 (audit du 2026-08-19).
 *
 * Les routes du studio d'images résolvaient l'organisation par
 * `getOrgId(getOrgSlugFromHeaders(...))`, qui traduit le slug du sous-domaine
 * en identifiant sans contrôler l'appartenance. Le cookie de session étant
 * valide sur tous les sous-domaines, Mallory, membre du seul tenant `acme`,
 * listait, téléchargeait et supprimait les images du tenant `victime` en
 * rejouant ses requêtes sur `https://victime.example.com`. L'upload, lui,
 * acceptait un `spaceId` arbitraire sans droit d'écriture (INJ-23).
 *
 * Motif de vérification : « répond 403 ou 404 ET ne fait rien ». L'absence
 * d'effet de bord est prouvée par les mocks : nombre d'accès en lecture, et
 * surtout non-appel de `db.delete`, `db.update`, `db.insert`, `uploadFile` et
 * `deleteFile` (l'objet S3 ne doit jamais partir).
 */
import { describe, it, expect, vi, beforeEach } from "vitest";
import { NextRequest } from "next/server";

const h = vi.hoisted(() => ({
  getSessionUser: vi.fn(),
  getSpacePermission: vi.fn(),
  uploadFile: vi.fn(),
  deleteFile: vi.fn(),
  updateRows: [] as unknown[],
  selectQueue: [] as unknown[][],
  selectCalls: { count: 0 },
  deleteCalls: { count: 0 },
  updateCalls: { count: 0 },
  insertCalls: { count: 0 },
}));

function chain(rows: unknown[]) {
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const self: any = {
    then: (resolve: (v: unknown[]) => void, reject?: (e: unknown) => void) =>
      Promise.resolve(rows).then(resolve, reject),
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
      return chain(h.updateRows);
    }),
    insert: vi.fn(() => {
      h.insertCalls.count += 1;
      return chain([]);
    }),
  },
}));
vi.mock("@/lib/storage/s3", () => ({
  uploadFile: h.uploadFile,
  deleteFile: h.deleteFile,
  s3Client: { send: vi.fn() },
  BUCKET: "loriax",
}));
vi.mock("next/headers", () => ({
  headers: vi.fn().mockResolvedValue({
    // Mallory rejoue ses requêtes sur le sous-domaine du tenant victime.
    get: (k: string) => (k === "x-org-slug" ? "victime" : null),
  }),
}));

import { GET as listGet, POST as uploadPost } from "@/app/api/studio/images/route";

/** Mallory est membre du seul tenant `acme`, jamais du tenant `victime`. */
const MALLORY = { id: "mallory", email: "mallory@acme.tld", globalRole: "user" };

/** L'organisation `victime` existe, mais aucune ligne `organization_members`. */
function queueNonMembre() {
  h.selectQueue.length = 0;
  h.selectQueue.push([{ id: "org-victime", slug: "victime", isActive: true }]);
  h.selectQueue.push([]);
  h.selectCalls.count = 0;
}

/** Membre légitime de l'organisation, puis lignes supplémentaires attendues. */
function queueMembre(...suite: unknown[][]) {
  h.selectQueue.length = 0;
  h.selectQueue.push([{ id: "org-victime", slug: "victime", isActive: true }]);
  h.selectQueue.push([{ organizationId: "org-victime" }]);
  for (const rows of suite) h.selectQueue.push(rows);
  h.selectCalls.count = 0;
}

/** Requêtes émises par `requireOrgScoped` avant tout accès métier. */
const REQUETES_HELPER = 2;

function attendreAucunEffetDeBord() {
  expect(h.deleteCalls.count).toBe(0);
  expect(h.updateCalls.count).toBe(0);
  expect(h.insertCalls.count).toBe(0);
  expect(h.deleteFile).not.toHaveBeenCalled();
  expect(h.uploadFile).not.toHaveBeenCalled();
}

function formDataRequest(spaceId: string | null) {
  const fd = new FormData();
  fd.append("file", new File(["binaire"], "logo.png", { type: "image/png" }));
  fd.append("name", "logo.png");
  if (spaceId) fd.append("spaceId", spaceId);
  return new NextRequest("http://victime.example.com/api/studio/images", {
    method: "POST",
    body: fd,
  });
}

beforeEach(() => {
  vi.clearAllMocks();
  h.deleteCalls.count = 0;
  h.updateCalls.count = 0;
  h.insertCalls.count = 0;
  h.updateRows = [];
  h.getSessionUser.mockResolvedValue(MALLORY);
  h.getSpacePermission.mockResolvedValue(null);
});

describe("Studio d'images : organisation étrangère (P0-6)", () => {
  it("répond 404 et ne liste aucune image du tenant victime", async () => {
    queueNonMembre();

    const res = await listGet(
      new NextRequest("http://victime.example.com/api/studio/images")
    );

    expect(res.status).toBe(404);
    // Aucune requête au-delà de celles du helper : la table n'est pas lue.
    expect(h.selectCalls.count).toBe(REQUETES_HELPER);
    attendreAucunEffetDeBord();
  });

  it("répond 404 et ne téléverse rien pour un upload sur le tenant victime", async () => {
    queueNonMembre();

    const res = await uploadPost(formDataRequest("space-victime"));

    expect(res.status).toBe(404);
    expect(h.selectCalls.count).toBe(REQUETES_HELPER);
    attendreAucunEffetDeBord();
  });
});

describe("Studio d'images : permission d'espace (INJ-23)", () => {
  it("répond 403 et ne téléverse rien quand l'utilisateur n'est pas éditeur de l'espace", async () => {
    // Helper simple, puis helper avec ressource : org, appartenance, espace.
    queueMembre(
      [{ id: "org-victime", slug: "victime", isActive: true }],
      [{ organizationId: "org-victime" }],
      [{ id: "space-rh", organizationId: "org-victime" }]
    );
    h.getSpacePermission.mockResolvedValue("viewer");

    const res = await uploadPost(formDataRequest("space-rh"));

    expect(res.status).toBe(403);
    attendreAucunEffetDeBord();
  });

  it("répond 404 sans interroger la permission quand l'espace visé est d'une autre organisation", async () => {
    queueMembre(
      [{ id: "org-victime", slug: "victime", isActive: true }],
      [{ organizationId: "org-victime" }],
      [{ id: "space-x", organizationId: "org-tierce" }]
    );

    const res = await uploadPost(formDataRequest("space-x"));

    expect(res.status).toBe(404);
    expect(h.getSpacePermission).not.toHaveBeenCalled();
    attendreAucunEffetDeBord();
  });

  it("répond 403 et ne liste rien quand l'espace demandé est interdit à l'utilisateur", async () => {
    queueMembre([{ id: "space-rh", organizationId: "org-victime" }]);
    h.getSpacePermission.mockResolvedValue(null);

    const res = await listGet(
      new NextRequest("http://victime.example.com/api/studio/images?spaceId=space-rh")
    );

    expect(res.status).toBe(403);
    // Org, appartenance, espace : la table des images n'est jamais atteinte.
    expect(h.selectCalls.count).toBe(REQUETES_HELPER + 1);
    attendreAucunEffetDeBord();
  });
});

describe("Studio d'images : usages légitimes préservés", () => {
  it("liste les images d'un espace pour un membre qui en est viewer", async () => {
    queueMembre(
      [{ id: "space-com", organizationId: "org-victime" }],
      [{ id: "img-1", organizationId: "org-victime", spaceId: "space-com", name: "logo" }]
    );
    h.getSpacePermission.mockResolvedValue("viewer");

    const res = await listGet(
      new NextRequest("http://victime.example.com/api/studio/images?spaceId=space-com")
    );

    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body).toHaveLength(1);
    // Contrat de réponse inchangé : chaque image porte son URL /api/media.
    expect(body[0].url).toBe("/api/media/img-1");
  });
});
