import { describe, it, expect, vi } from "vitest";

vi.mock("@/lib/db", () => ({ db: {} }));
vi.mock("@/lib/storage/filesystem", () => ({ writeDocument: vi.fn() }));
vi.mock("@/lib/git/repository", () => ({ commitFile: vi.fn() }));
vi.mock("@/lib/collab/auth-ws", () => ({ checkCollabDocumentEditAccess: vi.fn() }));
vi.mock("@/lib/tasks/sync-document-tasks", () => ({ syncDocumentTasks: vi.fn() }));

import { prosemirrorJsonToMarkdown } from "../markdown-sync";
import { extractMediaRefs } from "@/lib/media/usages";

const ID = "11111111-2222-3333-4444-555555555555";
const DATA = "data:image/png;base64,iVBORw0KGgo=";

const text = (t: string, marks?: unknown[]) => ({ type: "text", text: t, ...(marks ? { marks } : {}) });
const image = (src: string, extra: Record<string, unknown> = {}) => ({
  type: "image",
  attrs: { src, alt: null, title: null, ...extra },
});

describe("prosemirrorJsonToMarkdown : images", () => {
  const doc = {
    type: "doc",
    content: [
      { type: "paragraph", content: [text("Intro")] },
      image(`/api/media/${ID}`, { alt: "Logo" }),
      { type: "paragraph", content: [image("/api/attachments/org1/photo%201.png", { alt: "Photo" })] },
      { type: "paragraph", content: [text("avant "), image(DATA, { alt: "Inline" }), text(" après")] },
      {
        type: "paragraph",
        content: [text("ancien", [{ type: "link", attrs: { href: "/api/attachments/old/doc.pdf" } }])],
      },
    ],
  };

  it("écrit les trois images et conserve le lien", () => {
    const md = prosemirrorJsonToMarkdown(doc);
    expect(md).toContain(`![Logo](/api/media/${ID})`);
    expect(md).toContain("![Photo](/api/attachments/org1/photo%201.png)");
    expect(md).toContain("avant ![Inline]() après");
    expect(md).not.toContain("base64");
    expect(md).toContain("[ancien](/api/attachments/old/doc.pdf)");
  });

  it("images: false reproduit le convertisseur antérieur (images absentes)", () => {
    const md = prosemirrorJsonToMarkdown(doc, { images: false });
    expect(md).not.toContain("![");
    expect(md).toContain("Intro");
    expect(prosemirrorJsonToMarkdown(doc)).toContain("![Logo]");
  });

  it("est relu à l'identique par extractMediaRefs", () => {
    const refs = extractMediaRefs(prosemirrorJsonToMarkdown(doc));
    expect(refs).toContainEqual({ mediaId: ID });
    expect(refs).toContainEqual({ storageKey: "org1/photo 1.png" });
  });

  it("écrit le titre et échappe l'alt", () => {
    const md = prosemirrorJsonToMarkdown({
      type: "doc",
      content: [image("/api/media/" + ID, { alt: "a [b] c", title: 'dit "x"' })],
    });
    expect(md).toContain(`![a \\[b\\] c](/api/media/${ID} "dit \\"x\\"")`);
  });

  it("n'écrit rien pour une image sans src", () => {
    expect(prosemirrorJsonToMarkdown({ type: "doc", content: [image("")] }).trim()).toBe("");
  });
});
