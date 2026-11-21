import { Node, mergeAttributes } from "@tiptap/core";
import { ReactNodeViewRenderer } from "@tiptap/react";
import { createLazyNodeView } from "./lazy-node-view";

const LazyDesignBlockView = createLazyNodeView(
  () => import("./design-block").then((m) => ({ default: m.DesignBlockView })),
  "Studio"
);

export const DesignBlock = Node.create({
  name: "designBlock",
  group: "block",
  atom: true,
  draggable: true,

  addAttributes() {
    return {
      designId: { default: null },
      title: { default: "" },
      thumbnailUrl: { default: null },
      lockedBy: { default: null },
      lockedAt: { default: null },
    };
  },

  parseHTML() {
    return [
      { tag: 'div[data-type="design-block"]' },
    ];
  },

  renderHTML({ HTMLAttributes }) {
    return [
      "div",
      mergeAttributes(HTMLAttributes, { "data-type": "design-block" }),
    ];
  },

  addNodeView() {
    return ReactNodeViewRenderer(LazyDesignBlockView, {
      stopEvent: ({ event }) => {
        const target = (event.target as HTMLElement | null);
        return !!(target && target.closest("input, button, select, textarea, [role='button']"));
      },
    });
  },
});
