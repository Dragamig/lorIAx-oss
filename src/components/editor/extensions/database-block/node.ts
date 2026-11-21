import { Node, mergeAttributes } from "@tiptap/core";
import { ReactNodeViewRenderer } from "@tiptap/react";
import { createLazyNodeView } from "../lazy-node-view";

const LazyDatabaseBlockView = createLazyNodeView(
  () => import("./index").then((m) => ({ default: m.DatabaseBlockView })),
  "Base de données"
);

export const DatabaseBlock = Node.create({
  name: "databaseBlock",
  group: "block",
  atom: true,
  draggable: true,

  addAttributes() {
    return {
      databaseId: {
        default: null,
        parseHTML: (element: HTMLElement) =>
          element.getAttribute("databaseId") ||
          element.getAttribute("databaseid") ||
          element.getAttribute("data-database-id"),
      },
      databaseName: {
        default: "Nouvelle base",
        parseHTML: (element: HTMLElement) =>
          element.getAttribute("databaseName") ||
          element.getAttribute("databasename") ||
          element.getAttribute("data-database-name"),
      },
      viewMode: {
        default: "table",
        parseHTML: (element: HTMLElement) =>
          element.getAttribute("viewMode") ||
          element.getAttribute("viewmode") ||
          element.getAttribute("data-view-mode"),
      },
      intent: {
        default: null,
        rendered: false,
      },
      // Mode « base liée » : intégration en lecture seule d'une base existante,
      // avec tri/filtre propres à ce document (stockés dans le nœud, sans
      // modifier la base source ni ses vues).
      readOnly: {
        default: false,
        parseHTML: (element: HTMLElement) =>
          element.getAttribute("data-read-only") === "true",
        renderHTML: (attrs) => (attrs.readOnly ? { "data-read-only": "true" } : {}),
      },
      linked: {
        default: false,
        parseHTML: (element: HTMLElement) =>
          element.getAttribute("data-linked") === "true",
        renderHTML: (attrs) => (attrs.linked ? { "data-linked": "true" } : {}),
      },
      // Tri/filtre locaux sérialisés (JSON) — propres à cette intégration.
      localSorts: {
        default: null,
        parseHTML: (element: HTMLElement) => element.getAttribute("data-local-sorts"),
        renderHTML: (attrs) =>
          attrs.localSorts ? { "data-local-sorts": attrs.localSorts as string } : {},
      },
      localFilters: {
        default: null,
        parseHTML: (element: HTMLElement) => element.getAttribute("data-local-filters"),
        renderHTML: (attrs) =>
          attrs.localFilters ? { "data-local-filters": attrs.localFilters as string } : {},
      },
    };
  },

  parseHTML() {
    return [{ tag: 'div[data-type="database-block"]' }];
  },

  renderHTML({ HTMLAttributes }) {
    return [
      "div",
      mergeAttributes(HTMLAttributes, { "data-type": "database-block" }),
    ];
  },

  addNodeView() {
    return ReactNodeViewRenderer(LazyDatabaseBlockView, {
      stopEvent: ({ event }) => {
        const target = event.target as HTMLElement;
        return !!target.closest("input, button, select, textarea, [role='button'], [contenteditable], table");
      },
    });
  },
});
