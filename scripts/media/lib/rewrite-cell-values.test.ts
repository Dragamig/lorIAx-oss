import { describe, expect, it } from "vitest";
import type { LookupResult, MediaLite } from "./plan";
import { rewriteAttachmentCell, rewriteImageCell } from "./rewrite-cell-values";

const ID1 = "11111111-1111-4111-8111-111111111111";
const ID2 = "22222222-2222-4222-8222-222222222222";
const m1: MediaLite = { id: ID1, storageKey: "k1", filename: "a.pdf", mimeType: "application/pdf", sizeBytes: 10 };
const m2: MediaLite = { id: ID2, storageKey: "k2", filename: "b.png", mimeType: "image/png", sizeBytes: 20 };

const byKey = (k: string): LookupResult =>
  k === "k1" ? { status: "found", media: m1 } : k === "k2" ? { status: "found", media: m2 } : k === "dup" ? { status: "ambiguous" } : { status: "not_found" };

const ctx = {
  lookupByKey: byKey,
  lookupByNameSizeInSpace: (f: { filename: string; mimeType: string; size: number }): LookupResult =>
    f.filename === "a.pdf" ? { status: "found", media: m1 } : f.filename === "twin.pdf" ? { status: "ambiguous" } : { status: "not_found" },
};

describe("rewriteImageCell", () => {
  it("réécrit une clé résolue", () => {
    expect(rewriteImageCell("/api/attachments/k1", byKey)).toEqual({ next: `/api/media/${ID1}`, outcome: "rewritten" });
  });
  it("clé introuvable ou ambiguë : valeur intacte", () => {
    expect(rewriteImageCell("/api/attachments/zz", byKey)).toEqual({ next: "/api/attachments/zz", outcome: "key_not_found" });
    expect(rewriteImageCell("/api/attachments/dup", byKey)).toEqual({ next: "/api/attachments/dup", outcome: "ambiguous" });
  });
  it("externe, data, vide, déjà neuf, invalide : inchangé", () => {
    expect(rewriteImageCell("https://x.fr/a.png", byKey).outcome).toBe("unchanged");
    expect(rewriteImageCell("data:image/png;base64,AAA", byKey).outcome).toBe("unchanged");
    expect(rewriteImageCell(null, byKey).outcome).toBe("unchanged");
    expect(rewriteImageCell("", byKey).outcome).toBe("unchanged");
    expect(rewriteImageCell(`/api/media/${ID1}`, byKey).outcome).toBe("already_new");
    expect(rewriteImageCell(42, byKey)).toEqual({ next: 42, outcome: "unparseable" });
  });
  it("idempotent", () => {
    const once = rewriteImageCell("/api/attachments/k1", byKey).next;
    expect(rewriteImageCell(once, byKey).next).toBe(once);
  });
});

describe("rewriteAttachmentCell", () => {
  it("résout { key } et reprend nom et taille du média", () => {
    const r = rewriteAttachmentCell([{ key: "k1", filename: "old.pdf", mimeType: "x", size: 1 }], ctx);
    expect(r.next).toEqual([{ key: "k1", mediaId: ID1, filename: "old.pdf", mimeType: "application/pdf", size: 10 }]);
    expect(r.outcomes).toEqual(["rewritten"]);
  });
  it("conserve les champs additionnels et reprend le nom du média si absent", () => {
    const r = rewriteAttachmentCell([{ key: "k1", uploadedAt: "2026-01-01", extra: { a: 1 } }], ctx);
    expect(r.next).toEqual([
      { key: "k1", uploadedAt: "2026-01-01", extra: { a: 1 }, mediaId: ID1, filename: "a.pdf", mimeType: "application/pdf", size: 10 },
    ]);
  });
  it("clé introuvable ou ambiguë : pièce conservée", () => {
    const a = { key: "zz", filename: "a" };
    const b = { key: "dup", filename: "b" };
    const r = rewriteAttachmentCell([a, b], ctx);
    expect(r.next).toEqual([a, b]);
    expect(r.outcomes).toEqual(["key_not_found", "ambiguous"]);
  });
  it("sans key : résolue par nom, type et taille si unique", () => {
    const r = rewriteAttachmentCell([{ filename: "a.pdf", mimeType: "application/pdf", size: 10 }], ctx);
    expect((r.next as Array<{ mediaId: string }>)[0].mediaId).toBe(ID1);
  });
  it("sans key : deux correspondances ou données insuffisantes : intacte", () => {
    const twin = { filename: "twin.pdf", mimeType: "application/pdf", size: 5 };
    const thin = { filename: "a.pdf" };
    const r = rewriteAttachmentCell([twin, thin], ctx);
    expect(r.next).toEqual([twin, thin]);
    expect(r.outcomes).toEqual(["ambiguous", "key_not_found"]);
  });
  it("tableau mêlant formes : ordre et effectif conservés", () => {
    const neu = { mediaId: ID2, filename: "b.png", mimeType: "image/png", size: 20 };
    const r = rewriteAttachmentCell([neu, { key: "k1" }, "bizarre", { key: "zz" }], ctx);
    const out = r.next as unknown[];
    expect(out).toHaveLength(4);
    expect(out[0]).toBe(neu);
    expect((out[1] as { mediaId: string }).mediaId).toBe(ID1);
    expect(out[2]).toBe("bizarre");
    expect(out[3]).toEqual({ key: "zz" });
    expect(r.outcomes).toEqual(["already_new", "rewritten", "unparseable", "key_not_found"]);
  });
  it("null, vide, non tableau", () => {
    expect(rewriteAttachmentCell(null, ctx).outcomes).toEqual(["unchanged"]);
    expect(rewriteAttachmentCell([], ctx).outcomes).toEqual(["unchanged"]);
    expect(rewriteAttachmentCell("x", ctx)).toEqual({ next: "x", outcomes: ["unparseable"] });
  });
  it("idempotent", () => {
    const once = rewriteAttachmentCell([{ key: "k1" }, { key: "zz" }], ctx).next;
    const twice = rewriteAttachmentCell(once, ctx);
    expect(twice.next).toBe(once);
  });
});
