import { describe, it, expect, vi, beforeEach } from "vitest";
import sharp from "sharp";
import { resolveDownloadedStorageType } from "./downloaded-content-type";

const hostile = Buffer.from(
  '<html><img src=x onerror="alert(1)"><svg onload="alert(2)"></svg><script>alert(3)</script></html>'
);

describe("resolveDownloadedStorageType", () => {
  it("neutralise du HTML hostile quel que soit le nom annonce", async () => {
    for (const name of ["a.html", "a.svg", "a.png", "libre", "a.txt"]) {
      expect(await resolveDownloadedStorageType(name, hostile)).toEqual({
        ext: "bin",
        contentType: "application/octet-stream",
        neutralized: true,
      });
    }
  });
  it("neutralise un SVG", async () => {
    const r = await resolveDownloadedStorageType("a.svg", Buffer.from('<svg onload="x()"/>'));
    expect(r.contentType).toBe("application/octet-stream");
  });
  it("garde un PNG sous son vrai type, extension tiree des octets", async () => {
    const png = await sharp({ create: { width: 2, height: 2, channels: 3, background: "#f00" } }).png().toBuffer();
    expect(await resolveDownloadedStorageType("photo.html", png)).toMatchObject({ ext: "png", contentType: "image/png" });
  });
  it("garde un texte inerte", async () => {
    expect(await resolveDownloadedStorageType("n.txt", Buffer.from("bonjour"))).toMatchObject({ ext: "txt", contentType: "text/plain" });
  });
});

const h = vi.hoisted(() => ({ uploads: [] as { key: string; body: Buffer; type: string }[] }));
vi.mock("@/lib/db", () => ({ db: {} }));
vi.mock("@/lib/storage/s3", () => ({
  uploadFile: vi.fn(async (key: string, body: Buffer, type: string) => {
    h.uploads.push({ key, body, type });
  }),
}));
vi.mock("@/lib/security/url-validator-server", () => ({
  assertPublicHostname: async () => undefined,
  resolvePublicAddresses: async () => [{ address: "203.0.113.34", family: 4 }],
}));
vi.mock("@/lib/crypto", () => ({ decrypt: (s: string) => s }));
vi.mock("@/lib/databases/attachment-cell-guard", () => ({ assertMediaCells: vi.fn() }));
vi.mock("@/lib/databases/row-change-context", () => ({ setRowChangeContext: vi.fn() }));
vi.mock("@/lib/integrations/airtable/client", () => ({ airtableProvider: {} }));
vi.mock("@/lib/integrations/notion/client", () => ({ notionProvider: {} }));

describe("downloadAndReupload (synchro externe)", () => {
  beforeEach(() => {
    h.uploads.length = 0;
    vi.stubGlobal(
      "fetch",
      vi.fn(async () => new Response(hostile, { headers: { "content-type": "text/html" } }))
    );
  });
  it("sync_import_strips_script_and_event_handlers : jamais stocke comme HTML ni SVG", async () => {
    const { downloadAndReupload } = await import("@/lib/integrations/sync-orchestrator");
    const out = await downloadAndReupload([{ url: "https://evil.example/x", filename: "x.html" }], "space-1");
    expect(out).toHaveLength(1);
    expect(h.uploads[0].type).toBe("application/octet-stream");
    expect(h.uploads[0].key).toMatch(/\.bin$/);
    expect(out[0].mimeType).toBe("application/octet-stream");
  });
});
