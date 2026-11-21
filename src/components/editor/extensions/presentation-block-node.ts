import { Node, mergeAttributes } from "@tiptap/core";
import { ReactNodeViewRenderer } from "@tiptap/react";
import { createLazyNodeView } from "./lazy-node-view";

const LazyPresentationBlockView = createLazyNodeView(
  () => import("./presentation-block").then((m) => ({ default: m.PresentationBlockView })),
  "Présentation"
);

/**
 * Nœud atomique : seuls l'identifiant et le titre vivent dans le document.
 * Le diaporama lui-même est stocké hors du document Yjs, la CRDT n'a donc
 * jamais de contenu de présentation à fusionner.
 */
export const PresentationBlock = Node.create({
  name: "presentationBlock",
  group: "block",
  atom: true,
  draggable: true,

  /**
   * Sérialisation Markdown.
   *
   * Sans elle, l'export d'un document écrivait le HTML brut du nœud, attributs
   * internes et identifiant de présentation compris. Un export doit être
   * lisible et ne rien divulguer de la mécanique : une citation portant le
   * titre suffit, la présentation elle-même n'ayant pas de représentation
   * textuelle.
   */
  addStorage() {
    return {
      markdown: {
        serialize(
          state: { write: (s: string) => void; closeBlock: (node: unknown) => void },
          node: { attrs: Record<string, string> }
        ) {
          const title = node.attrs.title?.trim();
          state.write(`> Présentation${title ? ` : ${title}` : ""}\n`);
          state.closeBlock(node);
        },
        parse: {
          // Aucune reconversion : une citation reste une citation à la
          // relecture, le bloc ne se reconstruit pas depuis du texte.
        },
      },
    };
  },

  addAttributes() {
    return {
      presentationId: { default: null },
      title: { default: "Nouvelle présentation" },
    };
  },

  parseHTML() {
    return [{ tag: 'div[data-type="presentation-block"]' }];
  },

  renderHTML({ HTMLAttributes }) {
    return ["div", mergeAttributes(HTMLAttributes, { "data-type": "presentation-block" })];
  },

  addNodeView() {
    return ReactNodeViewRenderer(LazyPresentationBlockView, {
      stopEvent: ({ event }) =>
        !!(event.target as Element).closest("input, button, a, [role='button']"),
    });
  },
});
