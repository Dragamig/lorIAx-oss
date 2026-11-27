/**
 * H9 : un SVG (ou tout type executable) deja stocke ne doit jamais etre rendu
 * sur l'origine de l'application ni sur celle du stockage.
 */
import { describe, it, expect, vi, beforeEach } from "vitest";
import { NextRequest } from "next/server";

vi.hoisted(() => {
  process.env.S3_ENDPOINT = "s3.internal";
  process.env.S3_PORT = "3900";
  process.env.S3_ACCESS_KEY = "k";
  process.env.S3_SECRET_KEY = "s";
});

import { media, videoProjects } from "@/lib/db/schema";

const ORG_A = "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa";
const SPACE = "11111111-1111-4111-8111-111111111111";
let mediaRows: unknown[] = [];

vi.mock("@/lib/db", () => ({
  db: {
    select: vi.fn(() => {
      let rows: unknown[] = [];
      const b = {
        from: vi.fn((table: unknown) => {
          rows = table === media ? mediaRows : table === videoProjects ? [] : [];
          return b;
        }),
        innerJoin: vi.fn(() => b),
        where: vi.fn(() => b),
        limit: vi.fn(() => Promise.resolve(rows)),
      };
      return b;
    }),
  },
}));
vi.mock("@/lib/org/get-request-org", () => ({ getRequestOrgId: vi.fn(() => Promise.resolve(ORG_A)) }));
vi.mock("@/lib/auth/get-user", () => ({
  getSessionUser: vi.fn().mockResolvedValue({ id: "user-a", name: "A", email: "a@a.com", globalRole: "user" }),
}));
vi.mock("@/lib/auth/check-access", () => ({
  checkSpaceReadAccess: vi.fn().mockResolvedValue(true),
  checkSpaceWriteAccess: vi.fn(),
}));

const s3Send = vi.fn();

const row = (filename: string, mimeType: string) => ({
  id: "99999999-9999-4999-8999-999999999999",
  organizationId: ORG_A,
  spaceId: SPACE,
  uploadedBy: "user-z",
  deletedAt: null,
  origin: "upload",
  mimeType,
  storageKey: `${SPACE}/${filename}`,
  filename,
  updatedAt: new Date(1000),
});

async function getRaw(key: string) {
  const { GET } = await import("@/app/api/attachments/[...key]/route");
  return GET(new NextRequest(`http://localhost/api/attachments/${key}`), {
    params: Promise.resolve({ key: key.split("/") }),
  });
}

beforeEach(async () => {
  vi.clearAllMocks();
  const { s3Client } = await import("@/lib/storage/s3");
  vi.spyOn(s3Client, "send").mockImplementation(((...a: unknown[]) => s3Send(...a)) as never);
  mediaRows = [];
  s3Send.mockImplementation(async (cmd: { constructor: { name: string } }) => {
    if (cmd.constructor.name === "HeadObjectCommand") return { ContentLength: 3 };
    return {
      Body: {
        transformToByteArray: async () => new Uint8Array([1, 2, 3]),
        transformToWebStream: () => new Response("abc").body,
      },
      ContentLength: 3,
      ContentType: "image/svg+xml",
    };
  });
});

describe("restitution des SVG stockes", () => {
  it("serves_stored_svg_as_attachment_octet_stream (ligne media)", async () => {
    mediaRows = [row("logo.svg", "image/svg+xml")];
    const res = await getRaw(`${SPACE}/logo.svg`);
    expect(res.status).toBe(200);
    expect(res.headers.get("Content-Disposition")).toMatch(/^attachment/);
    expect(res.headers.get("X-Content-Type-Options")).toBe("nosniff");
    expect(res.headers.get("Content-Type")).not.toBe("image/svg+xml");
  });

  it("serves_stored_svg_as_attachment_octet_stream (cle sans ligne media)", async () => {
    const res = await getRaw(`${SPACE}/logo.svg`);
    expect(res.status).toBe(200);
    expect(res.headers.get("Content-Disposition")).toMatch(/^attachment/);
    expect(res.headers.get("X-Content-Type-Options")).toBe("nosniff");
    expect(res.headers.get("Content-Type")).not.toBe("image/svg+xml");
  });

  it("recomposes_content_type_from_extension_not_from_client", async () => {
    mediaRows = [row("a.png", "text/html")];
    const res = await getRaw(`${SPACE}/a.png`);
    expect(res.headers.get("Content-Type")).toBe("image/png");
    expect(res.headers.get("X-Content-Type-Options")).toBe("nosniff");
  });
});

describe("serveContentType", () => {
  it("neutralise svg, html et xml, quelle que soit l'extension", async () => {
    const { serveContentType } = await import("@/lib/storage/serve-content-type");
    for (const [t, f] of [
      ["image/svg+xml", "a.svg"],
      ["text/html", "a.html"],
      ["application/xml", "a.xml"],
      ["image/png,text/html", "noext"],
      ["image/svg+xml", "noext"],
    ] as const) {
      expect(serveContentType(t, f)).toEqual({
        contentType: "application/octet-stream",
        disposition: "attachment",
      });
    }
  });
  it("garde le vrai type des types inertes legitimes (docx, csv, txt, json, zip)", async () => {
    const { serveContentType } = await import("@/lib/storage/serve-content-type");
    const docx = "application/vnd.openxmlformats-officedocument.wordprocessingml.document";
    expect(serveContentType(docx, "a.docx")).toEqual({ contentType: docx, disposition: "attachment" });
    expect(serveContentType("text/csv", "a.csv")).toEqual({ contentType: "text/csv", disposition: "attachment" });
    expect(serveContentType("text/plain", "a.txt").contentType).toBe("text/plain");
    expect(serveContentType("application/json", "a.json").contentType).toBe("application/json");
    expect(serveContentType("application/zip", "a.zip").contentType).toBe("application/zip");
    expect(serveContentType("application/vnd.ms-excel", "noext")).toEqual({
      contentType: "application/vnd.ms-excel",
      disposition: "attachment",
    });
  });
  it("garde un type inline sur sans extension", async () => {
    const { serveContentType } = await import("@/lib/storage/serve-content-type");
    expect(serveContentType("image/jpeg; charset=x", "noext")).toEqual({
      contentType: "image/jpeg",
      disposition: "inline",
    });
  });
});

describe("types inertes servis tels quels", () => {
  it("un docx et un csv gardent leur Content-Type reel (flux)", async () => {
    mediaRows = [row("r.csv", "text/csv")];
    const res = await getRaw(`${SPACE}/r.csv`);
    expect(res.headers.get("Content-Type")).toBe("text/csv");
    expect(res.headers.get("Content-Disposition")).toMatch(/^attachment/);
    const docx = "application/vnd.openxmlformats-officedocument.wordprocessingml.document";
    mediaRows = [row("d.docx", docx)];
    const res2 = await getRaw(`${SPACE}/d.docx`);
    expect(res2.headers.get("Content-Type")).toBe(docx);
  });
  it("getFileUrl garde la surcharge inline d'un png et d'un pdf", async () => {
    const { getFileUrl } = await import("@/lib/storage/s3");
    for (const [t, f] of [["image/png", "a.png"], ["application/pdf", "a.pdf"]]) {
      const u = new URL(
        await getFileUrl(`k/${f}`, 60, { contentType: t, contentDisposition: `inline; filename="${f}"` })
      );
      expect(u.searchParams.get("response-content-type")).toBe(t);
      expect(u.searchParams.get("response-content-disposition")).toMatch(/^inline/);
    }
  });
  it("OOXML stocke avec extension inconnue garde son vrai type", async () => {
    const { serveContentType, isActiveContent } = await import("@/lib/storage/serve-content-type");
    for (const t of [
      "application/vnd.openxmlformats-officedocument.wordprocessingml.document",
      "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
      "application/vnd.openxmlformats-officedocument.presentationml.presentation",
    ]) {
      expect(isActiveContent(t, "noext")).toBe(false);
      expect(serveContentType(t, "noext").contentType).toBe(t);
      expect(serveContentType(t, "f.dat").contentType).toBe(t);
    }
    expect(isActiveContent("application/atom+xml", "noext")).toBe(true);
  });
  it("getFileUrl OOXML avec disposition inline n'est pas reecrit en attachment", async () => {
    const { getFileUrl } = await import("@/lib/storage/s3");
    for (const [t, f] of [
      ["application/vnd.openxmlformats-officedocument.wordprocessingml.document", "a.docx"],
      ["application/vnd.openxmlformats-officedocument.spreadsheetml.sheet", "a.xlsx"],
      ["application/vnd.openxmlformats-officedocument.presentationml.presentation", "a.pptx"],
    ]) {
      const u = new URL(
        await getFileUrl(`k/${f}`, 60, { contentType: t, contentDisposition: `inline; filename="${f}"` })
      );
      expect(u.searchParams.get("response-content-type")).toBe(t);
      expect(u.searchParams.get("response-content-disposition")).toMatch(/^inline/);
    }
  });
  it("getFileUrl neutralise un type stocke mal forme (virgule)", async () => {
    const { getFileUrl } = await import("@/lib/storage/s3");
    for (const t of ["image/svg+xml, text/html", "text/html,", "text/html, x/y"]) {
      const u = new URL(
        await getFileUrl("k/a.dat", 60, { contentType: t, contentDisposition: 'inline; filename="a.dat"' })
      );
      expect(u.searchParams.get("response-content-type")).toBe("application/octet-stream");
      expect(u.searchParams.get("response-content-disposition")).toMatch(/^attachment/);
    }
  });
  it("getFileUrl garde le type d'un docx", async () => {
    const { getFileUrl } = await import("@/lib/storage/s3");
    const docx = "application/vnd.openxmlformats-officedocument.wordprocessingml.document";
    const u = new URL(
      await getFileUrl("k/a.docx", 60, { contentType: docx, contentDisposition: 'attachment; filename="a.docx"' })
    );
    expect(u.searchParams.get("response-content-type")).toBe(docx);
  });
});

describe("URL presignees", () => {
  it("presigned_url_for_svg_drops_response_overrides", async () => {
    const { getFileUrl } = await import("@/lib/storage/s3");
    const url = new URL(
      await getFileUrl("k/logo.svg", 60, {
        contentType: "image/svg+xml",
        contentDisposition: 'inline; filename="logo.svg"',
      })
    );
    expect(url.searchParams.get("response-content-type")).not.toBe("image/svg+xml");
    expect(url.searchParams.get("response-content-disposition") ?? "").toMatch(/^attachment/);
  });

  it("la route signed neutralise un SVG sans ligne media", async () => {
    const { getFileUrl } = await import("@/lib/storage/s3");
    void getFileUrl;
    const { GET } = await import("@/app/api/attachments/signed/route");
    const res = await GET(
      new NextRequest(`http://localhost/api/attachments/signed?key=${encodeURIComponent(`${SPACE}/logo.svg`)}`)
    );
    const { url } = await res.json();
    const u = new URL(url);
    expect(u.searchParams.get("response-content-type")).toBe("application/octet-stream");
    expect(u.searchParams.get("response-content-disposition") ?? "").toMatch(/^attachment/);
  });
});
