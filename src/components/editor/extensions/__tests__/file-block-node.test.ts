// @vitest-environment jsdom
import { describe, expect, it, vi } from "vitest";
import { Editor } from "@tiptap/core";
import StarterKit from "@tiptap/starter-kit";
import { Markdown } from "tiptap-markdown";
import { FileBlock } from "../file-block-node";
import { ImageWithMissingState } from "../image-with-missing-state";

vi.mock("@/lib/db", () => ({ db: {} }));
import { extractMediaRefs } from "@/lib/media/usages";
import { serializeAtomicNode } from "@/lib/documents/atomic-markdown";

const ID = "0b1c2d3e-0000-4000-8000-000000000000";

function make(content: string | object) {
  return new Editor({
    extensions: [
      StarterKit,
      ImageWithMissingState.configure({ allowBase64: true }),
      FileBlock,
      Markdown.configure({ html: true }),
    ],
    content,
  });
}
const md = (e: Editor) =>
  (e.storage as unknown as { markdown: { getMarkdown(): string } }).markdown.getMarkdown();
const fileNodes = (e: Editor) =>
  (e.getJSON().content ?? []).filter((n) => n.type === "fileBlock");

function doc(attrs: Record<string, unknown>) {
  return {
    type: "doc",
    content: [
      { type: "paragraph", content: [{ type: "text", text: "avant" }] },
      { type: "fileBlock", attrs },
      { type: "paragraph", content: [{ type: "text", text: "après" }] },
    ],
  };
}

describe("FileBlock markdown", () => {
  it("aller-retour stable et sans perte", () => {
    const attrs = { mediaId: ID, filename: "rapport.pdf", mimeType: "application/pdf", size: 1234, preview: true };
    const e1 = make(doc(attrs));
    const m1 = md(e1);
    const e2 = make(m1);
    expect(fileNodes(e2)[0].attrs).toEqual(attrs);
    expect(md(e2)).toBe(m1);
    expect(m1).toContain(`/api/media/${ID}`);
    expect(extractMediaRefs(m1)).toEqual([{ mediaId: ID }]);
  });

  it("nom hostile (guillemets, chevrons, crochets, retours, 500 caractères)", () => {
    const filename = `a"b<c>d]e[f\n\nsuite & ${"x".repeat(500)}`;
    const e1 = make(doc({ mediaId: ID, filename, mimeType: "application/pdf", size: 1, preview: false }));
    const m1 = md(e1);
    const e2 = make(m1);
    expect(fileNodes(e2)[0].attrs?.filename).toBe(filename);
    expect(md(e2)).toBe(m1);
    const texts = (e2.getJSON().content ?? []).filter((n) => n.type === "paragraph");
    expect(texts).toHaveLength(2);
  });

  it("preview absent vaut false", () => {
    const e = make(`<div data-type="file-block" data-media-id="${ID}" data-filename="a.txt"></div>`);
    expect(fileNodes(e)[0].attrs).toMatchObject({ mediaId: ID, preview: false, size: 0 });
  });

  it("mediaId invalide : aucun nœud", () => {
    const e = make(`<div data-type="file-block" data-media-id="pas-un-uuid" data-filename="a.txt"></div>`);
    expect(fileNodes(e)).toHaveLength(0);
    const e2 = make(`<div data-type="file-block" data-filename="a.txt"></div>`);
    expect(fileNodes(e2)).toHaveLength(0);
  });

  it("image data: et bloc Fichier survivent ensemble", () => {
    const e1 = make({
      type: "doc",
      content: [
        { type: "paragraph", content: [{ type: "image", attrs: { src: "data:image/png;base64,AAAA", alt: "x" } }] },
        { type: "fileBlock", attrs: { mediaId: ID, filename: "a.pdf", mimeType: "application/pdf", size: 5, preview: false } },
        { type: "paragraph", content: [{ type: "image", attrs: { src: `/api/media/${ID}`, alt: "y" } }] },
      ],
    });
    const m1 = md(e1);
    const e2 = make(m1);
    expect(md(e2)).toBe(m1);
    const types = (e2.getJSON().content ?? []).map((n) => n.type);
    expect(types).toEqual(["image", "fileBlock", "image"]);
    expect(md(e2)).toContain("data:image/png;base64,AAAA");
  });

  it("document sans bloc Fichier inchangé", () => {
    const m = "# Titre\n\nUn paragraphe.";
    expect(md(make(m))).toBe(m);
  });

  it("chemin collaboratif : même balise que l'éditeur", () => {
    const attrs = { mediaId: ID, filename: "a.pdf", mimeType: "application/pdf", size: 5, preview: false };
    const e = make(doc(attrs));
    expect(md(e)).toContain(serializeAtomicNode({ type: "fileBlock", attrs })!);
  });

  it("parseHTML met l'UUID en minuscules", () => {
    const e = make(`<div data-type="file-block" data-media-id="${ID.toUpperCase()}"></div>`);
    expect(fileNodes(e)[0].attrs?.mediaId).toBe(ID);
  });
});
