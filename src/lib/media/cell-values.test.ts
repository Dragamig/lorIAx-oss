import { describe, it, expect } from "vitest";
import { normalizeAttachments, normalizeImageCell } from "./cell-values";

const ID = "3f2a1b4c-5d6e-4f70-8a9b-0c1d2e3f4a5b";

describe("normalizeAttachments", () => {
  it("ne lève jamais sur les entrées bizarres", () => {
    for (const v of [null, undefined, "x", 3, {}, [null], [{}], [{ key: "" }], [[1]], [12]]) {
      expect(() => normalizeAttachments(v)).not.toThrow();
    }
    expect(normalizeAttachments(null)).toEqual({ items: [], invalid: 0 });
    expect(normalizeAttachments("x").invalid).toBe(1);
    expect(normalizeAttachments([null, 4]).invalid).toBe(2);
  });

  it("objet sans key ou key vide : hérité non résolvable", () => {
    const r = normalizeAttachments([{ filename: "a.pdf" }, { key: "", filename: "b.pdf" }]);
    expect(r.invalid).toBe(0);
    expect(r.items).toHaveLength(2);
    for (const it of r.items) expect(it).toMatchObject({ kind: "legacy", resolvable: false });
    expect(r.items[0].kind === "legacy" && r.items[0].value.filename).toBe("a.pdf");
  });

  it("tableau mixte, ordre conservé", () => {
    const r = normalizeAttachments([
      { mediaId: ID, filename: "n.png", mimeType: "image/png", size: 5 },
      { key: "uuid/x.pdf", filename: "x.pdf", mimeType: "application/pdf", size: 9 },
    ]);
    expect(r.items[0]).toEqual({
      kind: "media",
      value: { mediaId: ID, filename: "n.png", mimeType: "image/png", size: 5 },
    });
    expect(r.items[1]).toMatchObject({ kind: "legacy", resolvable: true });
  });

  it("size en chaîne ou négatif : 0", () => {
    const r = normalizeAttachments([
      { mediaId: ID, size: "12" },
      { mediaId: ID, size: -4 },
      { key: "k", size: "x" },
    ]);
    expect(r.items[0].kind === "media" && r.items[0].value.size).toBe(0);
    expect(r.items[1].kind === "media" && r.items[1].value.size).toBe(0);
    expect(r.items[2].kind === "legacy" && r.items[2].value.size).toBe(0);
  });

  it("size absent reste absent pour une pièce héritée", () => {
    const r = normalizeAttachments([{ key: "k" }]);
    expect(r.items[0].kind === "legacy" && "size" in r.items[0].value).toBe(false);
  });
});

describe("normalizeImageCell", () => {
  it("formes reconnues", () => {
    expect(normalizeImageCell(`/api/media/${ID}`)).toEqual({ kind: "media", mediaId: ID });
    expect(normalizeImageCell(`/api/media/${ID}?v=1`)).toEqual({ kind: "media", mediaId: ID });
    expect(normalizeImageCell("/api/attachments/org%20a/x%2By.png")).toEqual({
      kind: "legacyKey",
      key: "org a/x+y.png",
    });
    expect(normalizeImageCell("https://x/y.png")).toEqual({ kind: "external", url: "https://x/y.png" });
    expect(normalizeImageCell("data:image/png;base64,AAA")).toMatchObject({ kind: "data" });
  });

  it("vide et invalide", () => {
    expect(normalizeImageCell(null)).toEqual({ kind: "empty" });
    expect(normalizeImageCell("  ")).toEqual({ kind: "empty" });
    for (const v of ["javascript:alert(1)", "data:text/html,<b>", 12, {}, "/api/attachments/", "/api/media/not-a-uuid"]) {
      expect(normalizeImageCell(v)).toEqual({ kind: "invalid" });
    }
  });
});
