import { describe, it, expect, vi } from "vitest";
import { backfillPdfThumbnails, parseArgs, type BackfillDeps } from "./media-pdf-thumbnails";

function mk(rows: Array<{ id: string; storage_key: string; size_bytes?: number }>, renders: Array<unknown>, opts: { updateCount?: number } = {}) {
  const queries: Array<{ sql: string; params?: unknown[] }> = [];
  const deps: BackfillDeps = {
    pool: {
      query: vi.fn(async (sql: string, params?: unknown[]) => {
        queries.push({ sql, params });
        if (sql.startsWith("select")) {
          return { rows: rows.map((r) => ({ size_bytes: 1000, current_version: 1, ...r })) };
        }
        return { rows: [], rowCount: opts.updateCount ?? 1 };
      }),
    } as never,
    readObject: vi.fn(async () => Buffer.from("%PDF-x")),
    upload: vi.fn(async () => undefined),
    render: vi.fn(async () => renders.shift() as never),
    remove: vi.fn(async () => undefined),
  };
  return { deps, queries };
}

describe("backfillPdfThumbnails", () => {
  it("dry-run : compte sans écrire (ni base, ni S3, ni lecture)", async () => {
    const { deps, queries } = mk([{ id: "a", storage_key: "k/a.pdf" }], []);
    const r = await backfillPdfThumbnails({ apply: false }, deps);
    expect(r).toEqual({ scanned: 1, rendered: 0, failed: 0 });
    expect(deps.upload).not.toHaveBeenCalled();
    expect(deps.readObject).not.toHaveBeenCalled();
    expect(queries.every((q) => q.sql.startsWith("select"))).toBe(true);
  });

  it("apply : écrit, un échec n'arrête pas la suite", async () => {
    const { deps, queries } = mk(
      [
        { id: "a", storage_key: "k/a.pdf" },
        { id: "b", storage_key: "k/b.pdf" },
      ],
      [null, { webp: Buffer.from("w"), pageCount: 4 }],
    );
    const r = await backfillPdfThumbnails({ apply: true }, deps);
    expect(r).toEqual({ scanned: 2, rendered: 1, failed: 1 });
    expect(deps.upload).toHaveBeenCalledTimes(1);
    expect(deps.upload).toHaveBeenCalledWith("k/b.pdf.thumb.webp", expect.any(Buffer), "image/webp");
    const updates = queries.filter((q) => q.sql.startsWith("update"));
    expect(updates).toHaveLength(2);
    expect(updates[0].params).toEqual(["b", "k/b.pdf.thumb.webp", 4, "k/b.pdf"]);
    expect(updates[0].sql).toContain("storage_key = $4");
  });

  it("version remplacée entre-temps : l'update ne touche rien, la miniature est retirée", async () => {
    const { deps, queries } = mk(
      [{ id: "a", storage_key: "k/a.pdf" }],
      [{ webp: Buffer.from("w"), pageCount: 2 }],
      { updateCount: 0 },
    );
    const r = await backfillPdfThumbnails({ apply: true }, deps);
    expect(r.rendered).toBe(0);
    expect(deps.remove).toHaveBeenCalledWith("k/a.pdf.thumb.webp");
    expect(queries.filter((q) => q.sql.startsWith("update"))).toHaveLength(1);
  });

  it("PDF au-delà de 50 Mo : échec sans lecture", async () => {
    const { deps } = mk([{ id: "a", storage_key: "k/a.pdf", size_bytes: 60 * 1024 * 1024 }], []);
    const r = await backfillPdfThumbnails({ apply: true }, deps);
    expect(r.failed).toBe(1);
    expect(deps.readObject).not.toHaveBeenCalled();
  });

  it("la sélection ne vise que les PDF sans miniature (reprise), filtre org et limite", async () => {
    const { deps, queries } = mk([], []);
    await backfillPdfThumbnails({ apply: false, orgId: "o1", limit: 5 }, deps);
    expect(queries[0].sql).toContain("thumbnail_key is null");
    expect(queries[0].sql).toContain("kind = 'pdf'");
    expect(queries[0].params).toEqual(["o1", 5]);
  });

  it("parseArgs", () => {
    expect(parseArgs([])).toEqual({ apply: false });
    expect(parseArgs(["--apply", "--limit", "3", "--org", "x"])).toEqual({ apply: true, limit: 3, orgId: "x" });
  });
});
