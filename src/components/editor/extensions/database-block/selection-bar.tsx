"use client";

import { Copy, Trash2, X } from "lucide-react";
import { Tip } from "./row-tip";

const BTN =
  "inline-flex min-h-7 items-center gap-1.5 rounded-md px-2.5 text-[13px] hover:bg-background/20 focus-visible:outline-2 focus-visible:outline-offset-1 focus-visible:outline-ring";

/** Barre d'actions flottante affichée dès qu'au moins une ligne est sélectionnée. */
export function SelectionBar({
  count,
  onDuplicate,
  onDelete,
  onClear,
}: {
  count: number;
  onDuplicate: () => void;
  onDelete: () => void;
  onClear: () => void;
}) {
  if (count === 0) return null;
  return (
    <div
      role="toolbar"
      aria-label="Actions sur la sélection"
      className="absolute bottom-4 left-4 z-20 flex items-center gap-1 whitespace-nowrap rounded-lg bg-foreground py-1.5 pl-3.5 pr-2 text-background shadow-lg"
    >
      <span className="mr-2 text-[13px] font-medium">
        {count} {count > 1 ? "lignes sélectionnées" : "ligne sélectionnée"}
      </span>
      <Tip label="Dupliquer" kbd="Ctrl+D">
        <button type="button" className={BTN} onClick={onDuplicate} aria-label="Dupliquer la sélection">
          <Copy className="h-3.5 w-3.5" aria-hidden="true" />
          Dupliquer
        </button>
      </Tip>
      <Tip label="Supprimer" kbd="Suppr">
        <button type="button" className={`${BTN} text-red-300 dark:text-red-700`} onClick={onDelete} aria-label="Supprimer la sélection">
          <Trash2 className="h-3.5 w-3.5" aria-hidden="true" />
          Supprimer
        </button>
      </Tip>
      <span className="mx-1 h-[18px] w-px bg-background/40" aria-hidden="true" />
      <Tip label="Désélectionner" kbd="Échap">
        <button type="button" className={`${BTN} w-7 justify-center px-0`} onClick={onClear} aria-label="Désélectionner">
          <X className="h-3.5 w-3.5" aria-hidden="true" />
        </button>
      </Tip>
    </div>
  );
}
