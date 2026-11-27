import { describe, expect, it, vi, beforeEach } from "vitest";
import { Readable } from "node:stream";
import JSZip from "jszip";

const h = vi.hoisted(() => ({
  queue: [] as unknown[],
  selects: 0,
  access: {} as Record<string, boolean>,
  streamCalls: [] as string[],
  active: 0,
  maxActive: 0,
  destroyed: [] as string[],
  contents: {} as Record<string, string>,
  hang: new Set<string>(),
  accessCalls: 0,
}));

function chain(): unknown {
  const self: unknown = new Proxy(
    {},
    {
      get(_t, prop) {
        if (prop === "then") return (res: (v: unknown) => void) => res(h.queue.shift() ?? []);
        return () => self;
      },
    },
  );
  return self;
}
vi.mock("@/lib/db", () => ({ db: { select: () => (h.selects++, chain()) } }));
vi.mock("@/lib/media/access", () => ({
  resolveMediaAccess: (
    _u: unknown,
    row: { id: string; organizationId: string; deletedAt: Date | null },
    _m: string,
    opts: { orgId: string },
  ) =>
    (h.accessCalls++,
    Promise.resolve({
      allowed: row.organizationId === opts.orgId && !row.deletedAt && (h.access[row.id] ?? false),
    })),
}));
vi.mock("@/lib/storage/s3", () => ({
  getFileStream: async (key: string) => {
    h.streamCalls.push(key);
    h.active++;
    h.maxActive = Math.max(h.maxActive, h.active);
    const body = h.contents[key] ?? "x";
    const s = h.hang.has(key)
      ? new Readable({ read() {} })
      : Readable.from([Buffer.from(body)]);
    let released = false;
    const release = () => {
      if (!released) {
        released = true;
        h.active--;
      }
    };
    s.on("close", release);
    s.on("end", release);
    const orig = s.destroy.bind(s);
    s.destroy = ((err?: Error) => (h.destroyed.push(key), orig(err))) as typeof s.destroy;
    return s;
  },
}));

import { planZip, streamZip, ZIP_MAX_FILES, ZIP_MAX_BYTES, sanitizeZipName } from "./zip";

const user = { id: "u1" } as never;
const ORG = "org-1";
const row = (id: string, extra: Record<string, unknown> = {}) => ({
  id,
  organizationId: ORG,
  spaceId: null,
  uploadedBy: "u1",
  deletedAt: null,
  origin: "upload",
  mimeType: "image/png",
  folderId: null,
  filename: `${id}.png`,
  storageKey: `k/${id}`,
  sizeBytes: 10,
  ...extra,
});
const allow = (...ids: string[]) => ids.forEach((i) => (h.access[i] = true));

async function readAll(r: Readable): Promise<Buffer> {
  const chunks: Buffer[] = [];
  for await (const c of r) chunks.push(c as Buffer);
  return Buffer.concat(chunks);
}

beforeEach(() => {
  h.queue = [];
  h.selects = 0;
  h.access = {};
  h.streamCalls = [];
  h.active = 0;
  h.maxActive = 0;
  h.destroyed = [];
  h.contents = {};
  h.hang = new Set();
  h.accessCalls = 0;
});

describe("sanitizeZipName", () => {
  it("neutralise les chemins, NUL et noms trop longs", () => {
    expect(sanitizeZipName("../../x")).not.toMatch(/\.\./);
    expect(sanitizeZipName("../../x")).not.toContain("/");
    expect(sanitizeZipName("/etc/passwd")).not.toContain("/");
    expect(sanitizeZipName("a\0b.png")).not.toContain("\0");
    expect(sanitizeZipName("C:\\win\\x.png")).not.toContain("\\");
    const long = sanitizeZipName(`${"a".repeat(300)}.png`);
    expect(long.length).toBeLessThanOrEqual(200);
    expect(long.endsWith(".png")).toBe(true);
    expect(sanitizeZipName("..")).toBe("fichier");
    expect(sanitizeZipName("")).toBe("fichier");
  });
});

describe("planZip (ids)", () => {
  it("garde seuls les médias lisibles de l'organisation, hors corbeille", async () => {
    allow("a", "b", "c", "d");
    h.queue = [
      [
        row("a"),
        row("b", { deletedAt: new Date() }),
        row("c", { organizationId: "autre-org" }),
        row("d", { filename: "d.png" }),
        row("e"), // non autorisé
      ],
    ];
    const r = await planZip(user, ORG, { ids: ["a", "b", "c", "d", "e", "inconnu"] });
    expect(r.ok).toBe(true);
    if (!r.ok) return;
    expect(r.entries.map((e) => e.mediaId).sort()).toEqual(["a", "d"]);
    expect(r.skipped).toBe(4);
    expect(r.totalBytes).toBe(20);
    expect(h.streamCalls).toEqual([]);
  });

  it("rien de lisible : 404 muet", async () => {
    h.queue = [[row("a"), row("b", { organizationId: "autre-org" })]];
    const r = await planZip(user, ORG, { ids: ["a", "b"] });
    expect(r).toEqual({ ok: false, status: 404, error: expect.any(String) });
  });

  it("plus de 500 fichiers : 413 sans requête ni lecture S3", async () => {
    const ids = Array.from({ length: ZIP_MAX_FILES + 1 }, (_, i) => `m${i}`);
    const r = await planZip(user, ORG, { ids });
    expect(r).toMatchObject({ ok: false, status: 413 });
    expect(h.selects).toBe(0);
    expect(h.streamCalls).toEqual([]);
  });

  it("plus de 2 Go : 413 sans lecture S3", async () => {
    allow("a", "b");
    h.queue = [[row("a", { sizeBytes: ZIP_MAX_BYTES }), row("b", { sizeBytes: 1 })]];
    const r = await planZip(user, ORG, { ids: ["a", "b"] });
    expect(r).toMatchObject({ ok: false, status: 413 });
    expect(h.streamCalls).toEqual([]);
  });

  it("un seul select par lot de 50 identifiants", async () => {
    const ids = Array.from({ length: 51 }, (_, i) => `m${i}`);
    ids.forEach((i) => allow(i));
    h.queue = [ids.slice(0, 50).map((i) => row(i)), [row("m50")]];
    const r = await planZip(user, ORG, { ids });
    expect(h.selects).toBe(2);
    expect(r.ok && r.entries.length).toBe(51);
  });

  it("dédoublonne les noms et assainit les chemins", async () => {
    allow("a", "b", "c", "d");
    h.queue = [
      [
        row("a", { filename: "photo.png" }),
        row("b", { filename: "Photo.png" }),
        row("c", { filename: "../../x.png" }),
        row("d", { filename: `${"z".repeat(300)}.png` }),
      ],
    ];
    const r = await planZip(user, ORG, { ids: ["a", "b", "c", "d"] });
    if (!r.ok) throw new Error("plan");
    const paths = r.entries.map((e) => e.path);
    expect(paths).toContain("photo.png");
    expect(paths).toContain("Photo (2).png");
    for (const p of paths) {
      expect(p).not.toMatch(/\.\./);
      expect(p.startsWith("/")).toBe(false);
      expect(p.length).toBeLessThanOrEqual(200);
    }
  });
});

describe("planZip (borne du travail)", () => {
  it("s'arrête dès que le plafond de fichiers est dépassé, sans tout résoudre", async () => {
    const many = Array.from({ length: 3000 }, (_, i) => row(`m${i}`, { folderId: "f1" }));
    many.forEach((r) => allow(r.id));
    h.queue = [[{ id: "f1", parentId: null, name: "Racine" }], many];
    const r = await planZip(user, ORG, { folderId: "f1" });
    expect(r).toMatchObject({ ok: false, status: 413 });
    expect(h.accessCalls).toBeLessThanOrEqual(ZIP_MAX_FILES + 1);
  });

  it("s'arrête dès que le plafond d'octets est dépassé", async () => {
    const big = Array.from({ length: 400 }, (_, i) =>
      row(`g${i}`, { folderId: "f1", sizeBytes: ZIP_MAX_BYTES / 2 }),
    );
    big.forEach((r) => allow(r.id));
    h.queue = [[{ id: "f1", parentId: null, name: "Racine" }], big];
    const r = await planZip(user, ORG, { folderId: "f1" });
    expect(r).toMatchObject({ ok: false, status: 413 });
    expect(h.accessCalls).toBeLessThanOrEqual(3);
  });
});

describe("planZip (dossier)", () => {
  const folders = [
    { id: "f1", parentId: null, name: "Racine" },
    { id: "f2", parentId: "f1", name: "Sous" },
    { id: "f3", parentId: null, name: "Autre" },
  ];

  it("conserve la structure du dossier et de ses sous-dossiers", async () => {
    allow("a", "b");
    h.queue = [
      folders,
      [row("a", { folderId: "f1", filename: "a.png" }), row("b", { folderId: "f2", filename: "b.png" })],
    ];
    const r = await planZip(user, ORG, { folderId: "f1" });
    if (!r.ok) throw new Error("plan");
    expect(r.entries.map((e) => e.path).sort()).toEqual(["Racine/Sous/b.png", "Racine/a.png"]);
  });

  it("dossier : un média refusé n'est jamais compté ni mentionné", async () => {
    allow("a");
    h.queue = [
      folders,
      [row("a", { folderId: "f1" }), row("secret", { folderId: "f1" }), row("trash", { folderId: "f1", deletedAt: new Date() })],
    ];
    const r = await planZip(user, ORG, { folderId: "f1" });
    if (!r.ok) throw new Error("plan");
    expect(r.skipped).toBe(0);
    const zip = await JSZip.loadAsync(await readAll(streamZip(r, new AbortController().signal)));
    expect(Object.keys(zip.files)).not.toContain("_non-inclus.txt");
  });

  it("dossier d'une autre organisation ou inconnu : 404", async () => {
    h.queue = [folders];
    const r = await planZip(user, ORG, { folderId: "inconnu" });
    expect(r).toMatchObject({ ok: false, status: 404 });
  });

  it("dossier trop volumineux : 413 avant tout accès S3", async () => {
    const many = Array.from({ length: 5001 }, (_, i) => row(`m${i}`, { folderId: "f1" }));
    h.queue = [folders, many];
    const r = await planZip(user, ORG, { folderId: "f1" });
    expect(r).toMatchObject({ ok: false, status: 413 });
    expect(h.streamCalls).toEqual([]);
  });
});

describe("streamZip", () => {
  const plan = (skipped = 0) => ({
    entries: [
      { mediaId: "a", storageKey: "k/a", path: "a.txt", sizeBytes: 1 },
      { mediaId: "b", storageKey: "k/b", path: "d/b.txt", sizeBytes: 1 },
      { mediaId: "c", storageKey: "k/c", path: "c.txt", sizeBytes: 1 },
    ],
    skipped,
    totalBytes: 3,
  });

  it("produit une archive valide, un objet S3 à la fois", async () => {
    h.contents = { "k/a": "AAA", "k/b": "BBB", "k/c": "CCC" };
    const buf = await readAll(streamZip(plan(), new AbortController().signal));
    const zip = await JSZip.loadAsync(buf);
    expect(await zip.file("a.txt")!.async("string")).toBe("AAA");
    expect(await zip.file("d/b.txt")!.async("string")).toBe("BBB");
    expect(h.maxActive).toBe(1);
    expect(zip.file("_non-inclus.txt")).toBeNull();
  });

  it("_non-inclus.txt présent si des médias sont omis, sans identifiant", async () => {
    const buf = await readAll(streamZip(plan(3), new AbortController().signal));
    const zip = await JSZip.loadAsync(buf);
    const txt = await zip.file("_non-inclus.txt")!.async("string");
    expect(txt).toContain("3");
    expect(txt).not.toMatch(/k\/|[0-9a-f]{8}-/);
  });

  it("abort détruit le flux S3 courant et ferme l'archive", async () => {
    h.hang.add("k/a");
    const ac = new AbortController();
    const out = streamZip(plan(), ac.signal);
    const done = readAll(out).catch(() => null);
    await vi.waitFor(() => expect(h.streamCalls).toEqual(["k/a"]));
    ac.abort();
    await done;
    expect(h.destroyed).toContain("k/a");
    expect(h.streamCalls).toEqual(["k/a"]);
    expect(out.destroyed).toBe(true);
  });
});
