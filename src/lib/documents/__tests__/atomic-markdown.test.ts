import { describe, it, expect, vi } from "vitest";

vi.mock("@/lib/db", () => ({ db: {} }));
vi.mock("@/lib/storage/filesystem", () => ({ writeDocument: vi.fn() }));
vi.mock("@/lib/git/repository", () => ({ commitFile: vi.fn() }));
vi.mock("@/lib/collab/auth-ws", () => ({ checkCollabDocumentEditAccess: vi.fn() }));
vi.mock("@/lib/tasks/sync-document-tasks", () => ({ syncDocumentTasks: vi.fn() }));

import { serializeAtomicNode, isAtomicNodeType } from "../atomic-markdown";
import { prosemirrorJsonToMarkdown } from "@/lib/collab/markdown-sync";

const ID = "11111111-2222-3333-4444-555555555555";

describe("serializeAtomicNode", () => {
  it("écrit la balise d'un bloc atomique avec ses attributs non nuls", () => {
    const out = serializeAtomicNode({
      type: "whiteboardBlock",
      attrs: { canvasId: ID, title: "", thumbnailUrl: null },
    });
    expect(out).toBe(`<div canvasid="${ID}" title="" data-type="whiteboard-block"></div>`);
  });

  it("échappe les guillemets et ignore les objets", () => {
    const out = serializeAtomicNode({
      type: "spreadsheetBlock",
      attrs: { sheetId: ID, title: 'a "b" <c>', extra: { x: 1 } },
    });
    expect(out).toContain('title="a &quot;b&quot; &lt;c&gt;"');
    expect(out).not.toContain("extra");
  });

  it("sérialise les inlines wikiLink et templateVariable", () => {
    expect(serializeAtomicNode({ type: "wikiLink", attrs: { target: "A", label: "B" } })).toBe("[[A|B]]");
    expect(serializeAtomicNode({ type: "wikiLink", attrs: { target: "A", label: "A" } })).toBe("[[A]]");
    expect(serializeAtomicNode({ type: "templateVariable", attrs: { key: "nom" } })).toBe("{{nom}}");
  });

  it("rend null pour un nœud ordinaire", () => {
    expect(serializeAtomicNode({ type: "paragraph" })).toBeNull();
    expect(isAtomicNodeType("paragraph")).toBe(false);
    expect(isAtomicNodeType("mindmapBlock")).toBe(true);
  });
});

describe("chemin collaboratif", () => {
  it("inclut les balises des blocs atomiques dans le markdown", () => {
    const md = prosemirrorJsonToMarkdown({
      type: "doc",
      content: [
        { type: "paragraph", content: [{ type: "text", text: "Avant" }] },
        { type: "mindmapBlock", attrs: { canvasId: ID } },
        {
          type: "paragraph",
          content: [
            { type: "text", text: "Voir " },
            { type: "wikiLink", attrs: { target: "Page", label: "Page" } },
          ],
        },
      ],
    });
    expect(md).toContain(`canvasid="${ID}" data-type="mindmap-block"`);
    expect(md).toContain("Voir [[Page]]");
    expect(md).toContain("Avant");
  });
});
