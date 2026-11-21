import { Node, mergeAttributes } from "@tiptap/core";
import { ReactNodeViewRenderer } from "@tiptap/react";
import { createLazyNodeView } from "./lazy-node-view";

const LazySyncedBlockView = createLazyNodeView(
  () => import("./synced-block/synced-block-view").then((m) => ({ default: m.SyncedBlockView })),
  "Bloc synchronisé",
);

// Lit le premier attribut non nul parmi plusieurs variantes de nom (round-trip
// HTML/markdown : les attributs peuvent être lowercasés par le sérialiseur).
function readAttr(element: HTMLElement, ...names: string[]): string | null {
  for (const n of names) {
    const v = element.getAttribute(n);
    if (v != null) return v;
  }
  return null;
}

export const SyncedBlock = Node.create({
  name: "syncedBlock",
  group: "block",
  atom: true,
  draggable: true,

  addAttributes() {
    return {
      sourceDocumentId: {
        default: null,
        parseHTML: (el: HTMLElement) =>
          readAttr(el, "data-source-document-id", "data-source-documentid"),
        renderHTML: (attrs) =>
          attrs.sourceDocumentId
            ? { "data-source-document-id": attrs.sourceDocumentId as string }
            : {},
      },
      sourceTitle: {
        default: "",
        parseHTML: (el: HTMLElement) => readAttr(el, "data-source-title") || "",
        renderHTML: (attrs) =>
          attrs.sourceTitle ? { "data-source-title": attrs.sourceTitle as string } : {},
      },
      sourceSpaceSlug: {
        default: "",
        parseHTML: (el: HTMLElement) => readAttr(el, "data-source-space-slug") || "",
        renderHTML: (attrs) =>
          attrs.sourceSpaceSlug
            ? { "data-source-space-slug": attrs.sourceSpaceSlug as string }
            : {},
      },
      anchor: {
        default: null,
        parseHTML: (el: HTMLElement) => readAttr(el, "data-anchor"),
        renderHTML: (attrs) => (attrs.anchor ? { "data-anchor": attrs.anchor as string } : {}),
      },
      mode: {
        default: "document",
        parseHTML: (el: HTMLElement) => readAttr(el, "data-mode") || "document",
        renderHTML: (attrs) => ({ "data-mode": (attrs.mode as string) || "document" }),
      },
    };
  },

  parseHTML() {
    return [{ tag: 'div[data-type="synced-block"]' }];
  },

  renderHTML({ HTMLAttributes }) {
    return ["div", mergeAttributes(HTMLAttributes, { "data-type": "synced-block" })];
  },

  addNodeView() {
    return ReactNodeViewRenderer(LazySyncedBlockView, {
      stopEvent: ({ event }) => {
        const target = event.target as HTMLElement;
        return !!target.closest(
          "input, button, select, textarea, a, [role='button'], [contenteditable]",
        );
      },
    });
  },
});
