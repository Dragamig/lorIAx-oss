import { Table } from "@tiptap/extension-table";
import { ReactNodeViewRenderer } from "@tiptap/react";
import { TableBlockView } from "./table-block-view";

export const TableExtended = Table.extend({
  addAttributes() {
    return {
      ...this.parent?.(),
      tablePreset: {
        default: "default",
        parseHTML: (element: HTMLElement) =>
          element.getAttribute("data-table-preset") || "default",
        renderHTML: (attributes: Record<string, unknown>) => ({
          "data-table-preset": attributes.tablePreset || "default",
        }),
      },
    };
  },

  addNodeView() {
    return ReactNodeViewRenderer(TableBlockView, {
      // tbody : le contentDOM doit être à l'intérieur du <table> rendu par le
      // NodeView pour que les <tr> forment une vraie grille et que le plugin
      // columnResizing (colgroup) fonctionne.
      contentDOMElementTag: "tbody",
      stopEvent: ({ event }) => {
        const target = event.target as HTMLElement;
        return !!target.closest(
          "button, select, [role='button'], .table-block-toolbar, .table-block-add-col, .table-block-add-row"
        );
      },
    });
  },
});
