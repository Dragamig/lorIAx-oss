"use client";

import { useRef } from "react";
import { useTranslations } from "next-intl";
import { toast } from "sonner";
import { CellEditor } from "@/components/editor/extensions/database-block/database-cell-editor";
import type { useRelationData } from "@/components/editor/extensions/database-block/use-relation-data";
import type { CellValue, DbColumn, DbRow } from "@/components/editor/extensions/database-block/types";
import type { RecordNav } from "@/lib/bases/record-navigation";
import { deleteRowsRequest, restoreRowsRequest } from "@/lib/bases/delete-rows";
import { RowAside } from "./row-aside";
import { RecordSheet, type RecordSheetStatus } from "./record-sheet";

export interface RecordSlotContext {
  row: DbRow;
  columns: DbColumn[];
  spaceId: string;
}

export interface RecordDeletion {
  /** Called after a deletion or its undo: the host view refreshes its data. */
  onChanged: () => void;
  /** True when the user cannot edit: the button stays visible but disabled. */
  readOnly?: boolean;
}

export interface RecordDialogProps {
  /** Row to edit; the panel is open when non-null (or when status is not ready). */
  row: DbRow | null;
  /** All columns (not only the visible ones): this is where everything is edited. */
  columns: DbColumn[];
  spaceId: string;
  /** When provided (and no `aside`), the activity tab is rendered in the aside slot. */
  databaseId?: string;
  relationData: ReturnType<typeof useRelationData>;
  /** Column used as title (defaults to the first column). */
  titleColumnId?: string;
  /** The sheet passes `{ silent: true }` as 4th argument: it shows its own failure toast naming the column. */
  onWriteCell: (
    rowId: string,
    columnId: string,
    value: CellValue,
    opts?: { silent?: boolean },
  ) => void | Promise<unknown>;
  onClose: () => void;
  status?: RecordSheetStatus;
  nav?: RecordNav | null;
  onNavigate?: (rowId: string) => void;
  onRetry?: () => void;
  entityLabel?: string;
  openInBasesHref?: string;
  /** Delete button (needs `databaseId`). Absent = no button. */
  deletion?: RecordDeletion;
  sections?: (ctx: RecordSlotContext) => React.ReactNode;
  aside?: (ctx: RecordSlotContext) => React.ReactNode;
}

/** Editable record sheet shared by the Kanban, Gallery and Calendar views. */
export function RecordDialog({
  row,
  columns,
  spaceId,
  databaseId,
  relationData,
  titleColumnId,
  onWriteCell,
  onClose,
  status = "ready",
  nav,
  onNavigate,
  onRetry,
  entityLabel,
  openInBasesHref,
  deletion,
  sections,
  aside,
}: RecordDialogProps) {
  const t = useTranslations("recordSheet");
  // Original value per `${rowId}:${columnId}` while a toast is active.
  const originals = useRef<Map<string, CellValue>>(new Map());

  const titleColumn = columns.find((c) => c.id === titleColumnId) ?? columns[0];
  const title = row && titleColumn ? String(row.cells[titleColumn.id] ?? "") : "";
  const open = row !== null || status === "notFound" || status === "loading" || status === "error";

  async function handleWrite(target: DbRow, column: DbColumn, value: CellValue) {
    const rowId = target.id;
    const columnId = column.id;
    const key = `${rowId}:${columnId}`;
    if (!originals.current.has(key)) {
      originals.current.set(key, (target.cells[columnId] ?? null) as CellValue);
    }
    const forget = () => {
      originals.current.delete(key);
    };
    const failed = () => toast.error(t("cellError", { column: column.name }));
    let ok = false;
    try {
      ok = (await onWriteCell(rowId, columnId, value, { silent: true })) !== false;
    } catch {
      ok = false;
    }
    if (!ok) {
      failed();
      return;
    }
    toast.success(t("cellSaved", { column: column.name }), {
      id: `record-${rowId}-${columnId}`,
      onDismiss: forget,
      onAutoClose: forget,
      action: {
        label: t("undo"),
        onClick: async () => {
          const original = (originals.current.get(key) ?? null) as CellValue;
          let undone = false;
          try {
            undone = (await onWriteCell(rowId, columnId, original, { silent: true })) !== false;
          } catch {
            undone = false;
          }
          if (!undone) {
            failed();
            return;
          }
          forget();
          toast(t("cellUndone", { column: column.name }));
        },
      },
    });
  }

  async function handleDelete(target: DbRow): Promise<boolean> {
    if (!databaseId || !deletion) return false;
    let deleted;
    try {
      ({ deleted } = await deleteRowsRequest(databaseId, [target.id]));
    } catch {
      toast.error(t("deleteError"));
      return false;
    }
    onClose();
    deletion.onChanged();
    toast.success(t("deleted"), {
      duration: 8000,
      action: {
        label: t("undo"),
        onClick: async () => {
          try {
            await restoreRowsRequest(databaseId, deleted);
            toast.success(t("restored"));
          } catch {
            toast.error(t("restoreError"));
          }
          deletion.onChanged();
        },
      },
    });
    return true;
  }

  const ctx: RecordSlotContext | null = row ? { row, columns, spaceId } : null;

  return (
    <RecordSheet
      open={open}
      title={title}
      status={status}
      nav={nav ?? undefined}
      entityLabel={entityLabel}
      openInBasesHref={openInBasesHref}
      onClose={onClose}
      onNavigate={onNavigate}
      onRetry={onRetry}
      deletion={
        row && databaseId && deletion
          ? {
              onConfirm: () => handleDelete(row),
              disabledReason: deletion.readOnly ? t("deleteReadOnly") : undefined,
            }
          : undefined
      }
      sections={ctx && sections ? sections(ctx) : undefined}
      aside={
        ctx && aside ? (
          aside(ctx)
        ) : ctx && databaseId ? (
          <RowAside
            key={ctx.row.id}
            databaseId={databaseId}
            rowId={ctx.row.id}
            revision={JSON.stringify(ctx.row.cells)}
            columns={columns}
            relationData={relationData}
          />
        ) : undefined
      }
    >
      {row &&
        (columns.length === 0 ? (
          <p className="text-sm text-muted-foreground">{t("noColumns")}</p>
        ) : (
          <div key={row.id} className="space-y-3">
            {columns.map((col) => (
              <div key={col.id}>
                <div className="mb-1 text-xs font-medium text-muted-foreground">{col.name}</div>
                <div className="min-h-8 rounded-md border border-input bg-muted">
                  <CellEditor
                    column={col}
                    value={(row.cells[col.id] ?? null) as CellValue}
                    spaceId={spaceId}
                    relationData={relationData}
                    onChange={(val) => void handleWrite(row, col, val)}
                  />
                </div>
              </div>
            ))}
          </div>
        ))}
    </RecordSheet>
  );
}
