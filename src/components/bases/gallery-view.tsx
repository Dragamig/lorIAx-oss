"use client";

import { useMemo, useState } from "react";
import { Image as ImageIcon, Loader2, Maximize2, Plus } from "lucide-react";
import { toast } from "sonner";
import { RecordDialog } from "./record-dialog";
import { useRecordSheet } from "./use-record-sheet";
import { useRowWrites } from "./use-row-writes";
import { useViewDisplayConfig } from "./use-view-display-config";
import { DatabaseDisplayControls } from "@/components/editor/extensions/database-block/database-display-controls";
import { apiPost } from "@/components/editor/extensions/database-block/api";
import { useRelationData } from "@/components/editor/extensions/database-block/use-relation-data";
import { getRelationLabels } from "@/components/editor/extensions/database-block/row-display-name";
import type { DbColumn, DbRow } from "@/components/editor/extensions/database-block/types";
import { coverUrl, pickCoverColumn } from "@/lib/bases/gallery";
import { resolveRowHeight, resolveVisibleColumns } from "@/lib/bases/view-config";

interface GalleryViewProps {
  databaseId: string;
  spaceId: string;
  viewId: string;
  viewConfig: Record<string, unknown>;
  columns: DbColumn[];
  rows: DbRow[];
  onRefresh: () => void;
}

const btn =
  "inline-flex items-center gap-1.5 rounded px-2 py-1 text-xs text-neutral-600 hover:bg-neutral-100 focus-visible:outline focus-visible:outline-2 focus-visible:outline-blue-500 disabled:opacity-50 dark:text-neutral-300 dark:hover:bg-neutral-800";

const MAX_FIELDS = { compact: 2, normal: 3, tall: 6 } as const;
const COVER_CLASS = { compact: "h-24", normal: "h-36", tall: "h-48" } as const;

function formatValue(column: DbColumn, v: unknown, relationLabels: string[]): string {
  if (column.type === "checkbox") return v ? "Oui" : "Non";
  if (column.type === "relation") return relationLabels.join(", ");
  if (Array.isArray(v)) return v.map((x) => (typeof x === "object" ? "" : String(x))).filter(Boolean).join(", ");
  return String(v);
}

export function GalleryView({ databaseId, spaceId, viewId, viewConfig, columns, rows, onRefresh }: GalleryViewProps) {
  const [busy, setBusy] = useState(false);
  const { display, changeDisplay } = useViewDisplayConfig(databaseId, viewId, viewConfig);
  const { mergedRows, writeCell } = useRowWrites(databaseId, rows);
  const relationData = useRelationData(columns);

  const titleColumn = columns[0];
  const coverColumn = pickCoverColumn(columns);
  const rowHeight = resolveRowHeight(display);
  const fieldColumns = resolveVisibleColumns(columns, display).filter(
    (c) => c.id !== titleColumn?.id && c.id !== coverColumn?.id,
  );
  const orderedIds = useMemo(() => mergedRows.map((r) => r.id), [mergedRows]);
  const { openRow, status, nav, openRecord, closeRecord, navigate } = useRecordSheet({ rows: mergedRows, orderedIds });

  async function addRow() {
    setBusy(true);
    try {
      await apiPost(`/api/databases/${databaseId}/rows`, { cells: {} });
      toast.success("Fiche créée");
      onRefresh();
    } catch {
      toast.error("Échec de la création de la fiche");
    } finally {
      setBusy(false);
    }
  }

  return (
    <div className="flex min-h-0 flex-1 flex-col">
      <div className="flex items-center gap-2 border-b border-neutral-200 px-3 py-1.5 text-xs text-neutral-500 dark:border-neutral-800">
        <ImageIcon className="h-3.5 w-3.5" aria-hidden />
        <span>{coverColumn ? `Couverture : ${coverColumn.name}` : "Sans couverture"}</span>
        <button
          type="button"
          disabled={busy}
          onClick={() => void addRow()}
          title="Ajouter une fiche"
          aria-label="Ajouter une fiche"
          className={`${btn} border border-neutral-200 dark:border-neutral-700`}
        >
          {busy ? <Loader2 className="h-3.5 w-3.5 animate-spin" aria-hidden /> : <Plus className="h-3.5 w-3.5" aria-hidden />}
          Fiche
        </button>
        <div className="ml-auto">
          <DatabaseDisplayControls columns={columns} config={display} onChange={(n) => void changeDisplay(n)} />
        </div>
      </div>

      <div className="min-h-0 flex-1 overflow-y-auto p-3" aria-busy={busy}>
        {mergedRows.length === 0 ? (
          <div className="mx-auto mt-8 max-w-sm rounded-lg border border-dashed border-neutral-300 p-6 text-center dark:border-neutral-700" data-testid="gallery-empty">
            <ImageIcon className="mx-auto mb-2 h-6 w-6 text-neutral-400" aria-hidden />
            <h2 className="text-sm font-medium">Aucune fiche</h2>
            <p className="mt-1 text-xs text-neutral-500">Ajoutez une première fiche à cette galerie.</p>
          </div>
        ) : (
          <div
            className="grid gap-3"
            style={{ gridTemplateColumns: "repeat(auto-fill, minmax(14rem, 1fr))" }}
            data-testid="gallery-grid"
            data-row-height={rowHeight}
          >
            {mergedRows.map((row) => {
              const title = titleColumn ? String(row.cells[titleColumn.id] ?? "") : "";
              const url = coverColumn ? coverUrl(row.cells[coverColumn.id]) : null;
              const fields = fieldColumns
                .map((c) => ({ c, v: row.cells[c.id] }))
                .filter(({ v }) => v != null && v !== "" && !(Array.isArray(v) && v.length === 0))
                .slice(0, MAX_FIELDS[rowHeight]);
              return (
                <article
                  key={row.id}
                  tabIndex={0}
                  onClick={() => openRecord(row.id)}
                  onKeyDown={(e) => {
                    if (e.target === e.currentTarget && e.key === "Enter") { e.preventDefault(); openRecord(row.id); }
                  }}
                  aria-label={title || "Sans titre"}
                  className="cursor-pointer overflow-hidden rounded-lg border border-neutral-200 bg-white text-xs shadow-sm hover:border-blue-400 focus-visible:outline focus-visible:outline-2 focus-visible:outline-blue-500 dark:border-neutral-700 dark:bg-neutral-900"
                >
                  {url && (
                    // eslint-disable-next-line @next/next/no-img-element
                    <img
                      src={url}
                      alt=""
                      loading="lazy"
                      className={`${COVER_CLASS[rowHeight]} w-full object-cover`}
                      onError={(e) => { e.currentTarget.style.display = "none"; }}
                    />
                  )}
                  <div className="space-y-1 p-2.5">
                    <div className="flex items-start gap-1">
                      <span className="min-w-0 flex-1 truncate text-sm font-medium">{title || "Sans titre"}</span>
                      <button
                        type="button"
                        onClick={(e) => { e.stopPropagation(); openRecord(row.id); }}
                        title="Ouvrir la fiche"
                        aria-label={`Ouvrir la fiche ${title || "Sans titre"}`}
                        className={`${btn} -my-1 px-1`}
                      >
                        <Maximize2 className="h-3.5 w-3.5" aria-hidden />
                      </button>
                    </div>
                    {fields.map(({ c, v }) => (
                      <div key={c.id} className="flex gap-1.5">
                        <span className="shrink-0 text-neutral-500">{c.name} :</span>
                        <span className={rowHeight === "tall" ? "break-words" : "truncate"}>
                          {formatValue(c, v, c.type === "relation" ? getRelationLabels(v, relationData[c.config?.targetDatabaseId ?? ""]) : [])}
                        </span>
                      </div>
                    ))}
                  </div>
                </article>
              );
            })}
          </div>
        )}
      </div>

      <RecordDialog
        row={openRow}
        databaseId={databaseId}
        columns={columns}
        spaceId={spaceId}
        relationData={relationData}
        titleColumnId={titleColumn?.id}
        onWriteCell={writeCell}
        status={status === "closed" ? "ready" : status}
        nav={nav}
        onNavigate={navigate}
        onClose={closeRecord}
      />
    </div>
  );
}
