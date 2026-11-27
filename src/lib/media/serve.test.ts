import { describe, it, expect, vi, beforeEach } from "vitest";

const h = vi.hoisted(() => ({ size: 1000, transform: vi.fn(), sent: [] as unknown[] }));

vi.mock("@/lib/storage/s3", () => ({
  BUCKET: "b",
  s3Client: {
    send: vi.fn(async (cmd: { constructor: { name: string }; input: unknown }) => {
      h.sent.push(cmd);
      if (cmd.constructor.name === "HeadObjectCommand") return { ContentLength: h.size };
      return {
        Body: {
          transformToByteArray: h.transform,
          transformToWebStream: () =>
            new ReadableStream({
              start(c) {
                c.enqueue(new Uint8Array([1, 2, 3]));
                c.close();
              },
            }),
        },
      };
    }),
  },
}));

import { serveMediaObject } from "@/lib/media/serve";

const call = (over: Partial<Parameters<typeof serveMediaObject>[0]> = {}, hdr: HeadersInit = {}) =>
  serveMediaObject({
    req: new Request("http://x/m", { headers: hdr }),
    key: "k",
    mime: "application/pdf",
    filename: "a.pdf",
    etagSeed: "id-1",
    inline: true,
    maxAgeSeconds: 300,
    ...over,
  });

beforeEach(() => {
  h.sent.length = 0;
  h.transform.mockClear();
});

describe("serveMediaObject : HEAD", () => {
  const head = (hdr: HeadersInit = {}) =>
    call({ req: new Request("http://x/m", { method: "HEAD", headers: hdr }) });
  it("200 sans corps ni GetObject, mêmes en-têtes", async () => {
    const r = await head();
    expect(r.status).toBe(200);
    expect(r.body).toBeNull();
    expect(r.headers.get("Content-Length")).toBe("1000");
    expect(r.headers.get("Content-Type")).toBe("application/pdf");
    expect(r.headers.get("ETag")).toBe('"id-1"');
    expect(h.sent.map((c) => (c as { constructor: { name: string } }).constructor.name)).toEqual(["HeadObjectCommand"]);
  });
  it("206 avec Range, toujours sans GetObject", async () => {
    const r = await head({ Range: "bytes=0-99" });
    expect(r.status).toBe(206);
    expect(r.headers.get("Content-Range")).toBe("bytes 0-99/1000");
    expect(h.sent).toHaveLength(1);
  });
});

describe("serveMediaObject", () => {
  it("200 en flux sans transformToByteArray", async () => {
    const r = await call();
    expect(r.status).toBe(200);
    expect(r.body).toBeInstanceOf(ReadableStream);
    expect(r.headers.get("Accept-Ranges")).toBe("bytes");
    expect(r.headers.get("Cache-Control")).toBe("private, max-age=300");
    expect(h.transform).not.toHaveBeenCalled();
  });
  it("revalidate : Cache-Control private, no-cache", async () => {
    const r = await call({ revalidate: true } as never);
    expect(r.headers.get("Cache-Control")).toBe("private, no-cache");
  });
  it("206 pour bytes=0-99", async () => {
    const r = await call({}, { Range: "bytes=0-99" });
    expect(r.status).toBe(206);
    expect(r.headers.get("Content-Range")).toBe("bytes 0-99/1000");
  });
  it("206 pour bytes=900-", async () => {
    const r = await call({}, { Range: "bytes=900-" });
    expect(r.status).toBe(206);
    expect(r.headers.get("Content-Range")).toBe("bytes 900-999/1000");
  });
  it.each(["bytes=999999999-", "bytes=0-1,5-9", "abc"])("416 pour %s", async (range) => {
    const r = await call({}, { Range: range });
    expect(r.status).toBe(416);
    expect(r.headers.get("Content-Range")).toBe("bytes */1000");
    expect(r.headers.get("X-Content-Type-Options")).toBe("nosniff");
  });
  it("304 avec If-None-Match égal à l'ETag", async () => {
    const first = await call();
    const etag = first.headers.get("ETag")!;
    const r = await call({}, { "If-None-Match": etag });
    expect(r.status).toBe(304);
    expect(r.body).toBeNull();
  });
  it("une ligne .png au type stocke menteur est servie image/png avec nosniff", async () => {
    for (const mime of ["image/svg+xml", "text/html"]) {
      const r = await call({ mime, filename: "a.png" });
      expect(r.headers.get("Content-Type")).toBe("image/png");
      expect(r.headers.get("X-Content-Type-Options")).toBe("nosniff");
    }
  });
  it("SVG et HTML restent en pièce jointe, PDF inline", async () => {
    expect((await call({ mime: "image/svg+xml", filename: "a.svg" })).headers.get("Content-Disposition")).toMatch(
      /^attachment/
    );
    expect((await call({ mime: "text/html", filename: "a.html" })).headers.get("Content-Disposition")).toMatch(
      /^attachment/
    );
    expect((await call()).headers.get("Content-Disposition")).toMatch(/^inline/);
    expect((await call({ inline: false })).headers.get("Content-Disposition")).toMatch(
      /^attachment/
    );
  });
  it("un SVG est servi avec Content-Disposition attachment et nosniff", async () => {
    const r = await call({ mime: "image/svg+xml", filename: "logo.svg", inline: true });
    expect(r.headers.get("Content-Disposition")).toMatch(/^attachment/);
    expect(r.headers.get("X-Content-Type-Options")).toBe("nosniff");
  });
  it("un SVG est servi image/svg+xml (affichable en <img>) sous CSP sandbox, en pièce jointe", async () => {
    for (const method of ["GET", "HEAD"]) {
      const r = await call({ renderSvg: true, req: new Request("http://x/m", { method }), mime: "application/octet-stream", filename: "Logo.SVG" });
      expect(r.headers.get("Content-Type")).toBe("image/svg+xml");
      expect(r.headers.get("Content-Security-Policy")).toBe("sandbox; default-src 'none'; style-src 'unsafe-inline'");
      expect(r.headers.get("X-Content-Type-Options")).toBe("nosniff");
      expect(r.headers.get("Content-Disposition")).toMatch(/^attachment/);
    }
  });
  it("svgz et HTML restent neutralisés, sans type image/svg+xml", async () => {
    expect((await call({ renderSvg: true, mime: "image/svg+xml", filename: "a.svgz" })).headers.get("Content-Type")).toBe("application/octet-stream");
    expect((await call({ mime: "text/html", filename: "a.html" })).headers.get("Content-Security-Policy")).toBeNull();
  });
  it("sans renderSvg, un SVG reste octet-stream", async () => {
    expect((await call({ mime: "image/svg+xml", filename: "a.svg" })).headers.get("Content-Type")).toBe("application/octet-stream");
  });
  it("nosniff sur toutes les réponses", async () => {
    for (const hdr of [{}, { Range: "bytes=0-1" }, { Range: "x" }] as Record<string, string>[]) {
      expect((await call({}, hdr)).headers.get("X-Content-Type-Options")).toBe("nosniff");
    }
  });
  it("nom non ASCII encodé avec repli ASCII", async () => {
    const cd = (await call({ filename: "résumé 2026.pdf" })).headers.get("Content-Disposition")!;
    expect(cd).toContain("filename*=UTF-8''r%C3%A9sum%C3%A9%202026.pdf");
    const fallback = /filename="([^"]*)"/.exec(cd)![1];
    expect(/^[\x20-\x7e]*$/.test(fallback)).toBe(true);
  });
  it("un nom finissant par un antislash donne un en-tête bien formé", async () => {
    const cd = (await call({ filename: 'bad"\\name\\' })).headers.get("Content-Disposition")!;
    expect(/^(inline|attachment); filename="[^"\\]*"; filename\*=UTF-8''[^ ]*$/.test(cd)).toBe(true);
  });
});
