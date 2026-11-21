"use client";

import { Node, mergeAttributes } from "@tiptap/core";
import type { NodeViewProps } from "@tiptap/core";
import { ReactNodeViewRenderer, NodeViewContent, NodeViewWrapper } from "@tiptap/react";
import { useCallback } from "react";
import { ChevronRight } from "lucide-react";

/**
 * Bloc dépliable (« toggle ») — structure à trois nœuds, alignée sur le HTML
 * natif `<details>`/`<summary>` :
 *   details          → conteneur, attribut `open`, node-view avec bouton de bascule
 *   detailsSummary   → titre cliquable (inline), rendu `<summary>`
 *   detailsContent   → corps repliable (block+), rendu `<div data-type="detailsContent">`
 *
 * Round-trip markdown : sérialisé en HTML (html:true côté tiptap-markdown), donc
 * relisible par les comptes-rendus de réunion qui émettent déjà du `<details>`.
 */

// Types tiptap-markdown (état du sérialiseur prosemirror-markdown)
type MdState = {
  write: (s: string) => void;
  ensureNewLine: () => void;
  renderInline: (node: unknown) => void;
  renderContent: (node: unknown) => void;
};
type MdNode = unknown;

const DetailsView = ({ node, updateAttributes, editor }: NodeViewProps) => {
  const open = node.attrs.open !== false;
  const editable = editor?.isEditable;

  const toggle = useCallback(() => {
    updateAttributes({ open: !open });
  }, [open, updateAttributes]);

  return (
    <NodeViewWrapper className="details-block" data-open={open ? "true" : "false"}>
      <button
        type="button"
        className="details-toggle"
        contentEditable={false}
        onClick={toggle}
        aria-expanded={open}
        title={open ? "Replier" : "Déplier"}
        tabIndex={editable ? 0 : -1}
      >
        <ChevronRight className="h-4 w-4" />
      </button>
      <NodeViewContent className="details-inner" />
    </NodeViewWrapper>
  );
};

export const DetailsContent = Node.create({
  name: "detailsContent",
  group: "block",
  content: "block+",
  defining: true,

  parseHTML() {
    return [{ tag: 'div[data-type="detailsContent"]' }];
  },

  renderHTML({ HTMLAttributes }) {
    return ["div", mergeAttributes(HTMLAttributes, { "data-type": "detailsContent" }), 0];
  },

  addStorage() {
    return {
      markdown: {
        serialize(state: MdState, node: MdNode) {
          // Ligne vide après la balise ouvrante pour que markdown-it re-parse
          // le contenu interne comme markdown (et non comme HTML brut).
          state.write('<div data-type="detailsContent">');
          state.ensureNewLine();
          state.write("\n");
          state.renderContent(node);
          state.ensureNewLine();
          state.write("</div>");
          state.ensureNewLine();
        },
        parse: {},
      },
    };
  },
});

export const DetailsSummary = Node.create({
  name: "detailsSummary",
  content: "inline*",
  defining: true,
  selectable: false,

  parseHTML() {
    return [{ tag: "summary" }];
  },

  renderHTML({ HTMLAttributes }) {
    return ["summary", mergeAttributes(HTMLAttributes), 0];
  },

  addStorage() {
    return {
      markdown: {
        serialize(state: MdState, node: MdNode) {
          state.write("<summary>");
          state.renderInline(node);
          state.write("</summary>");
          state.ensureNewLine();
          state.write("\n");
        },
        parse: {},
      },
    };
  },
});

export const Details = Node.create({
  name: "details",
  group: "block",
  content: "detailsSummary detailsContent",
  defining: true,
  isolating: true,

  addAttributes() {
    return {
      open: {
        default: true,
        parseHTML: (element: HTMLElement) => element.getAttribute("open") !== null,
        renderHTML: (attributes: Record<string, unknown>) =>
          attributes.open ? { open: "" } : {},
      },
    };
  },

  parseHTML() {
    return [{ tag: "details" }];
  },

  renderHTML({ HTMLAttributes }) {
    return ["details", mergeAttributes(HTMLAttributes), 0];
  },

  addNodeView() {
    return ReactNodeViewRenderer(DetailsView, {
      stopEvent: ({ event }) => {
        if (!(event.target instanceof HTMLElement)) return false;
        const target = event.target as HTMLElement;
        return !!target.closest(".details-toggle");
      },
    });
  },

  addStorage() {
    return {
      markdown: {
        serialize(state: MdState, node: MdNode) {
          state.write("<details>");
          state.ensureNewLine();
          state.renderContent(node);
          state.write("</details>");
          state.ensureNewLine();
          state.write("\n");
        },
        parse: {},
      },
    };
  },
});
