"use client";

import { NodeViewWrapper, NodeViewContent } from "@tiptap/react";
import type { NodeViewProps } from "@tiptap/react";
import { useCallback, useMemo } from "react";
import { Table as TableIcon, Trash2, Plus, X, ChevronDown } from "lucide-react";
import {
  TABLE_PRESETS,
  parsePresets,
  serializePresets,
  togglePreset,
} from "./table-presets";
import { Button } from "@/components/ui/button";
import {
  DropdownMenu,
  DropdownMenuCheckboxItem,
  DropdownMenuContent,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";

export function TableBlockView({
  node,
  updateAttributes,
  editor,
  selected,
  deleteNode,
}: NodeViewProps) {
  const editable = editor?.isEditable;
  const presets = useMemo(
    () => parsePresets(node.attrs.tablePreset),
    [node.attrs.tablePreset]
  );

  // Largeurs de colonnes calculées depuis les attributs `colwidth` des cellules
  // de la 1re ligne. Indispensable : en remplaçant la TableView native de
  // prosemirror-tables par ce NodeView React, on perd la gestion du <colgroup>
  // dont dépend le plugin columnResizing. On le reconstruit ici pour que le
  // redimensionnement natif s'applique réellement (avec table-layout: fixed).
  const colWidths = useMemo(() => {
    const widths: (number | null)[] = [];
    const firstRow = node.firstChild;
    if (!firstRow) return widths;
    firstRow.forEach((cell) => {
      const colspan = (cell.attrs.colspan as number) || 1;
      const colwidth = cell.attrs.colwidth as number[] | null;
      for (let i = 0; i < colspan; i++) {
        widths.push(colwidth && colwidth[i] ? colwidth[i] : null);
      }
    });
    return widths;
  }, [node]);

  const handleTogglePreset = useCallback(
    (key: string) => {
      const next = togglePreset(presets, key);
      updateAttributes({ tablePreset: serializePresets(next) });
    },
    [presets, updateAttributes]
  );

  const handleAddColumn = useCallback(() => {
    editor?.chain().focus().addColumnAfter().run();
  }, [editor]);

  const handleAddRow = useCallback(() => {
    editor?.chain().focus().addRowAfter().run();
  }, [editor]);

  const handleDeleteRow = useCallback(() => {
    editor?.chain().focus().deleteRow().run();
  }, [editor]);

  const handleDeleteColumn = useCallback(() => {
    editor?.chain().focus().deleteColumn().run();
  }, [editor]);

  const wrapperClasses = [
    "table-block-wrapper",
    selected ? "is-selected" : "",
    ...presets.map((p) => `table-preset-${p}`),
  ]
    .filter(Boolean)
    .join(" ");

  return (
    <NodeViewWrapper className={wrapperClasses}>
      <div className="table-block">
        {/* Toolbar — visible on hover or selection, hidden when not editable.
            contentEditable={false} sur les seuls contrôles : le contenu du
            tableau (NodeViewContent) doit rester éditable. */}
        {editable && (
          <div
            className={`table-block-toolbar ${selected ? "is-visible" : ""}`}
            contentEditable={false}
          >
            <div className="flex items-center gap-2">
              <TableIcon className="h-3.5 w-3.5 text-muted-foreground" />

              {/* Presets dropdown */}
              <DropdownMenu>
                <DropdownMenuTrigger render={
                  <Button variant="ghost" size="xs" title="Styles du tableau">
                    <span className="text-[11px]">Styles</span>
                    <ChevronDown className="h-3 w-3" />
                  </Button>
                } />
                <DropdownMenuContent align="start">
                  {TABLE_PRESETS.map((preset) => (
                    <DropdownMenuCheckboxItem
                      key={preset.key}
                      checked={presets.includes(preset.key)}
                      onCheckedChange={() => handleTogglePreset(preset.key)}
                    >
                      <span className="text-[11px]">{preset.label}</span>
                    </DropdownMenuCheckboxItem>
                  ))}
                </DropdownMenuContent>
              </DropdownMenu>
            </div>

            <div className="flex items-center gap-1">
              {/* Row/column actions when cursor is in table */}
              <Button variant="ghost" size="xs" onClick={handleDeleteColumn} title="Supprimer la colonne">
                <X className="h-3 w-3" />
                <span className="text-[11px]">Col</span>
              </Button>
              <Button variant="ghost" size="xs" onClick={handleDeleteRow} title="Supprimer la ligne">
                <X className="h-3 w-3" />
                <span className="text-[11px]">Ligne</span>
              </Button>
              <div className="w-px h-4 bg-border mx-0.5" />
              <Button
                variant="ghost"
                size="icon-sm"
                onClick={deleteNode}
                className="hover:text-destructive hover:bg-destructive/10"
                title="Supprimer le tableau"
              >
                <Trash2 className="h-3.5 w-3.5" />
              </Button>
            </div>
          </div>
        )}

        {/* Table content rendered by TipTap — vrai <table> pour l'affichage
            grille et le redimensionnement de colonnes. */}
        <div className="table-block-content">
          <div className="table-block-scroll">
            <table className="table-block-table">
              <colgroup>
                {colWidths.map((w, i) => (
                  <col
                    key={i}
                    style={w ? { width: `${w}px` } : undefined}
                  />
                ))}
              </colgroup>
              <NodeViewContent<"tbody"> as="tbody" />
            </table>
          </div>

          {/* Add column button (right edge) */}
          {editable && (
            <button
              onClick={handleAddColumn}
              contentEditable={false}
              className={`table-block-add-col ${selected ? "is-visible" : ""}`}
              title="Ajouter une colonne"
            >
              <Plus className="h-3.5 w-3.5" />
            </button>
          )}
        </div>

        {/* Add row button (bottom edge) */}
        {editable && (
          <button
            onClick={handleAddRow}
            contentEditable={false}
            className={`table-block-add-row ${selected ? "is-visible" : ""}`}
            title="Ajouter une ligne"
          >
            <Plus className="h-3.5 w-3.5" />
          </button>
        )}
      </div>
    </NodeViewWrapper>
  );
}
