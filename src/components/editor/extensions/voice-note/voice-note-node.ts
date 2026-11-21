import { Node, mergeAttributes } from "@tiptap/core";
import { ReactNodeViewRenderer } from "@tiptap/react";
import { createLazyNodeView } from "../lazy-node-view";

const LazyVoiceNoteBlockView = createLazyNodeView(
  () =>
    import("./voice-note-block").then((m) => ({ default: m.VoiceNoteBlockView })),
  "Note vocale"
);

/**
 * Bloc « Note vocale ». Le node ne porte qu'un identifiant : tout l'état
 * (statut, transcript, comptes rendus) vit dans la table `voice_notes`, ce qui
 * permet au bloc de retrouver le bon écran après fermeture du document.
 */
export const VoiceNoteBlock = Node.create({
  name: "voiceNoteBlock",
  group: "block",
  atom: true,
  draggable: true,

  addAttributes() {
    return {
      voiceNoteId: { default: "" },
      // Garde anti-doublon : mémorise que les actions de la synthèse ont déjà
      // été converties en tâches, pour distinguer « convertir » de « reconvertir ».
      actionsConvertedAt: {
        default: null,
        parseHTML: (element) =>
          element.getAttribute("data-actions-converted-at") || null,
        renderHTML: (attributes) => {
          if (!attributes.actionsConvertedAt) return {};
          return { "data-actions-converted-at": attributes.actionsConvertedAt };
        },
      },
    };
  },

  parseHTML() {
    return [{ tag: 'div[data-type="voice-note-block"]' }];
  },

  renderHTML({ HTMLAttributes }) {
    return [
      "div",
      mergeAttributes(HTMLAttributes, { "data-type": "voice-note-block" }),
    ];
  },

  addNodeView() {
    return ReactNodeViewRenderer(LazyVoiceNoteBlockView, {
      stopEvent: ({ event }) => {
        const target = event.target;
        return (
          target instanceof HTMLElement &&
          !!target.closest("input, button, select, textarea, audio, a, [role='button']")
        );
      },
    });
  },
});
