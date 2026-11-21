"use client";

import type { DbColumn, DbRow } from "./types";
import { normalizeOptions } from "./options";

// ─── Kanban View ─────────────────────────────────────────────────────────────
// Vue en lecture seule : regroupe les lignes par la 1re colonne « Choix ».
// (Le déplacement de carte entre colonnes n'est pas encore implémenté.)

export function KanbanView({
  columns,
  rows,
}: {
  columns: DbColumn[];
  rows: DbRow[];
}) {
  // Find the first select column for grouping
  const groupColumn = columns.find((c) => c.type === "select");

  if (!groupColumn) {
    return (
      <div className="p-6 text-center text-sm text-muted-foreground">
        Ajoutez une colonne de type &laquo; Choix &raquo; pour utiliser la vue Kanban.
      </div>
    );
  }

  // Options select : chaînes ou objets { label, color } (templates) — normalisées
  // en libellés, sinon les entêtes de colonnes Kanban rendraient un objet (#66).
  const options: string[] = normalizeOptions(groupColumn.config?.options);
  const groups: Record<string, DbRow[]> = { "": [] };
  options.forEach((opt) => { groups[opt] = []; });

  const isMultiple = !!groupColumn.config?.multiple;

  rows.forEach((row) => {
    const cellValue = row.cells?.[groupColumn.id];

    if (isMultiple && Array.isArray(cellValue)) {
      if (cellValue.length === 0) {
        groups[""].push(row);
      } else {
        cellValue.forEach((val: string) => {
          if (!groups[val]) groups[val] = [];
          groups[val].push(row);
        });
      }
    } else {
      const val = String(cellValue ?? "");
      if (!groups[val]) groups[val] = [];
      groups[val].push(row);
    }
  });

  const groupKeys = [...options, ""];

  return (
    <div className="flex gap-3 p-3 overflow-x-auto min-h-[200px]">
      {groupKeys.map((group) => {
        const groupRows = groups[group] || [];
        return (
          <div key={group || "__none"} className="flex flex-col w-56 shrink-0">
            <div className="flex items-center gap-2 px-2 py-1.5 mb-2">
              <span className="text-xs font-medium truncate">
                {group || "Sans catégorie"}
              </span>
              <span className="text-xs text-muted-foreground">
                {groupRows.length}
              </span>
            </div>
            <div className="flex flex-col gap-1.5 flex-1">
              {groupRows.map((row) => (
                <div
                  key={row.id}
                  className="bg-card border border-border rounded-md p-2.5 text-xs space-y-1 hover:border-primary/30 transition-colors"
                >
                  {columns
                    .filter((c) => c.id !== groupColumn.id)
                    .slice(0, 4)
                    .map((col) => {
                      const val = row.cells?.[col.id];
                      if (val == null || val === "") return null;
                      return (
                        <div key={col.id} className="flex items-baseline gap-1.5">
                          <span className="text-muted-foreground shrink-0">{col.name}:</span>
                          <span className="truncate">
                            {col.type === "checkbox" ? (val ? "Oui" : "Non") : String(val)}
                          </span>
                        </div>
                      );
                    })}
                </div>
              ))}
              {groupRows.length === 0 && (
                <div className="text-xs text-muted-foreground text-center py-4 border border-dashed border-border rounded">
                  Vide
                </div>
              )}
            </div>
          </div>
        );
      })}
    </div>
  );
}
