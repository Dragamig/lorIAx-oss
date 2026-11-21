import { Node, mergeAttributes } from "@tiptap/core";
import { ReactNodeViewRenderer } from "@tiptap/react";
import { createLazyNodeView } from "./lazy-node-view";

const LazyChronoBlockView = createLazyNodeView(
  () => import("./chrono-block").then((m) => ({ default: m.ChronoBlockView })),
  "Chrono"
);

/**
 * Bloc chronomètre (`/chrono`).
 *
 * Collab-safe : l'état persistant ne contient PAS de compteur qui tick. On
 * stocke uniquement `accumulatedMs` (durée figée aux arrêts) et `startedAt`
 * (timestamp epoch du dernier démarrage, ou null à l'arrêt). La durée affichée
 * est dérivée localement (accumulatedMs + now - startedAt) — aucune écriture
 * d'attribut pendant que le chrono tourne, donc pas de conflit Yjs.
 */
export const ChronoBlock = Node.create({
  name: "chronoBlock",
  group: "block",
  atom: true,
  draggable: true,

  addAttributes() {
    return {
      running: { default: false },
      accumulatedMs: { default: 0 },
      startedAt: { default: null as number | null },
      label: { default: "" },
      frozen: { default: false },
    };
  },

  parseHTML() {
    return [{ tag: 'div[data-type="chrono-block"]' }];
  },

  renderHTML({ HTMLAttributes }) {
    return [
      "div",
      mergeAttributes(HTMLAttributes, { "data-type": "chrono-block" }),
    ];
  },

  addNodeView() {
    return ReactNodeViewRenderer(LazyChronoBlockView, {
      stopEvent: ({ event }) => {
        const target = event.target as HTMLElement;
        return !!target.closest("input, button, select, textarea, [role='button']");
      },
    });
  },
});
