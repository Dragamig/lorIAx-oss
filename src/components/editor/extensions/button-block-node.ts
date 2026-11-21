import { Node, mergeAttributes } from "@tiptap/core";
import { ReactNodeViewRenderer } from "@tiptap/react";
import { createLazyNodeView } from "./lazy-node-view";

const LazyButtonBlockView = createLazyNodeView(
  () => import("./button-block").then((m) => ({ default: m.ButtonBlockView })),
  "Bouton"
);

/**
 * Bloc bouton d'automatisation / workflow (`/bouton`).
 *
 * Deux modes (attr `mode`) :
 * - `database` (historique) : bouton lié à une automation d'une base. Déclenche
 *   POST /api/databases/[databaseId]/automations/[automationId]/trigger.
 * - `workflow` (W1) : bouton lié à un workflow AUTONOME de l'espace (sans base).
 *   Déclenche POST /api/automations/[automationId]/trigger avec { documentId }.
 *
 * En mode édition, un popover permet de choisir le type, la cible et le libellé.
 * État purement déclaratif (mode / databaseId / automationId / libellé) → pas de
 * compteur qui tick, donc collab-safe comme les autres blocs atomiques.
 */
export const AutomationButtonBlock = Node.create({
  name: "automationButton",
  group: "block",
  atom: true,
  draggable: true,

  addAttributes() {
    return {
      // "database" (historique, défaut rétro-compat) ou "workflow" (autonome).
      mode: {
        default: "database" as "database" | "workflow",
        parseHTML: (element: HTMLElement) =>
          element.getAttribute("mode") || element.getAttribute("data-mode") || "database",
      },
      databaseId: {
        default: null as string | null,
        parseHTML: (element: HTMLElement) =>
          element.getAttribute("databaseId") ||
          element.getAttribute("databaseid") ||
          element.getAttribute("data-database-id"),
      },
      automationId: {
        default: null as string | null,
        parseHTML: (element: HTMLElement) =>
          element.getAttribute("automationId") ||
          element.getAttribute("automationid") ||
          element.getAttribute("data-automation-id"),
      },
      automationName: {
        default: "",
        parseHTML: (element: HTMLElement) =>
          element.getAttribute("automationName") ||
          element.getAttribute("automationname") ||
          element.getAttribute("data-automation-name") ||
          "",
      },
      label: {
        default: "",
        parseHTML: (element: HTMLElement) =>
          element.getAttribute("label") || element.getAttribute("data-label") || "",
      },
    };
  },

  parseHTML() {
    return [{ tag: 'div[data-type="automation-button"]' }];
  },

  renderHTML({ HTMLAttributes }) {
    return [
      "div",
      mergeAttributes(HTMLAttributes, { "data-type": "automation-button" }),
    ];
  },

  addNodeView() {
    return ReactNodeViewRenderer(LazyButtonBlockView, {
      stopEvent: ({ event }) => {
        const target = event.target as HTMLElement;
        return !!target.closest("input, button, select, textarea, [role='button']");
      },
    });
  },
});
