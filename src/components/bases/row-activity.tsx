"use client";

import { useMemo, useRef, useState } from "react";
import { useLocale, useTranslations } from "next-intl";
import { toast } from "sonner";
import {
  ChevronDown,
  ChevronUp,
  CircleAlert,
  CircleCheck,
  History,
  ListChecks,
  MessageSquare,
  Pencil,
  Plus,
  RotateCcw,
  Trash2,
  Undo2,
  X,
} from "lucide-react";
import { Button } from "@/components/ui/button";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { Skeleton } from "@/components/ui/skeleton";
import { Tip } from "@/components/editor/extensions/database-block/row-tip";
import type { DbColumn } from "@/components/editor/extensions/database-block/types";
import type { RowChangeEntry } from "@/lib/db/schema-row-activity";
import { formatHistoryValue, groupRowActivity, type RowActivityEntry, type RowHistoryGroup } from "./row-activity-model";
import { useRowActivity } from "./use-row-activity";
import { CommentComposer } from "./comment-composer";
import { CommentEntryMenu } from "./comment-entry-menu";
import { apiDelete, apiPatch, apiPost } from "@/components/editor/extensions/database-block/api";
import { parseMentionSegments } from "@/lib/databases/row-comment-mentions";
import type { RowActivityComment, RowActivityTaskEvent } from "@/lib/databases/row-activity-types";
import { usePersonNames } from "./use-person-names";
import type { RelationData } from "@/components/editor/extensions/database-block/use-relation-data";

const TITLE_SENTINEL = "\u0000";

export interface RowActivityProps {
  databaseId: string;
  rowId: string;
  /** Serialized cells of the open row: a change triggers a delayed refresh. */
  revision: string;
  columns: DbColumn[];
  /** Rows of the databases targeted by relation columns, to show linked titles. */
  relationData?: RelationData;
  /** Opens a task of the row (Tasks tab); when absent, task events show a plain title. */
  onOpenTask?: (taskId: string) => void;
}

/** Title of a linked row, same rule as the read-only relation cell of the grid. */
function relationRowTitle(relationData: RelationData | undefined, targetDbId: string | undefined, rowId: string) {
  const target = targetDbId ? relationData?.[targetDbId] : undefined;
  const row = target?.rows.find((r) => r.id === rowId);
  if (!row) return null;
  const labelCol = target?.columns.find((c) => c.type === "text" || c.type === "formula");
  const raw = labelCol ? row.cells?.[labelCol.id] : Object.values(row.cells ?? {})[0];
  return raw != null && String(raw) ? String(raw) : null;
}

export function RowActivity({ databaseId, rowId, revision, columns, relationData, onOpenTask }: RowActivityProps) {
  const t = useTranslations("rowActivity");
  const locale = useLocale();
  const history = useRowActivity(databaseId, rowId, revision);
  const entries = useMemo(() => groupRowActivity(history.items), [history.items]);
  const [expanded, setExpanded] = useState<Set<string>>(new Set());
  const [confirmOpen, setConfirmOpen] = useState(false);
  const [clearing, setClearing] = useState(false);
  const [editingId, setEditingId] = useState<string | null>(null);
  const commentRefs = useRef(new Map<string, HTMLLIElement>());
  const commentUrl = (id: string) => `/api/databases/${databaseId}/rows/${rowId}/comments/${id}`;

  function focusComment(id: string) {
    requestAnimationFrame(() => commentRefs.current.get(id)?.focus());
  }

  function stopEditing(id: string) {
    setEditingId(null);
    focusComment(id);
  }

  async function saveComment(id: string, body: string, current: string | null) {
    // No change: leave edit mode without a PATCH, so the comment is not marked as edited.
    if (body === (current ?? "").trim()) {
      stopEditing(id);
      return;
    }
    await apiPatch(commentUrl(id), { body });
    toast.success(t("commentEditDone"));
    stopEditing(id);
    void history.reload();
  }

  async function restoreComment(id: string) {
    try {
      await apiPost(`${commentUrl(id)}/restore`, {});
      await history.reload();
    } catch {
      toast.error(t("commentRestoreError"));
    }
  }

  async function deleteComment(id: string) {
    try {
      await apiDelete(commentUrl(id), {});
    } catch {
      toast.error(t("commentDeleteError"));
      return;
    }
    toast.success(t("commentDeleted"), {
      action: { label: t("commentUndo"), onClick: () => void restoreComment(id) },
    });
    await history.reload();
  }

  const personIds = useMemo(() => {
    const ids: string[] = [];
    for (const item of history.items) {
      // Mention names are resolved for eligible ids only (item.mentions), never for body ids.
      if (item.type === "comment") {
        ids.push(...item.mentions);
        continue;
      }
      if (item.type !== "change") continue;
      for (const c of item.changes) {
        if (c.columnType !== "person") continue;
        for (const v of [c.before, c.after]) if (Array.isArray(v)) ids.push(...v.map(String));
      }
    }
    return ids;
  }, [history.items]);
  const personName = usePersonNames(personIds);

  const labels = useMemo(
    () => ({
      locale,
      empty: t("emptyValue"),
      yes: t("yes"),
      no: t("no"),
      files: (n: number) => t("files", { count: n }),
      linked: (n: number) => t("linked", { count: n }),
      people: (n: number) => t("people", { count: n }),
      relationLabel: (columnId: string, targetRowId: string) =>
        relationRowTitle(
          relationData,
          columns.find((c) => c.id === columnId)?.config?.targetDatabaseId,
          targetRowId,
        ),
      personName,
    }),
    [locale, t, relationData, columns, personName],
  );

  function toggle(key: string) {
    setExpanded((prev) => {
      const next = new Set(prev);
      if (next.has(key)) next.delete(key);
      else next.add(key);
      return next;
    });
  }

  function actorName(g: RowHistoryGroup): string {
    if (g.actor?.name) return g.actor.name;
    switch (g.source) {
      case "public_form":
        return t("sourcePublicForm");
      case "sync":
        return t("sourceSync");
      case "relation_sync":
        return t("sourceRelationSync");
      case "restore":
        return g.actorLabel ?? t("sourceRestore");
      case "import":
        return t("sourceImport");
      case "system":
        return t("sourceSystem");
      case "automation":
        return t("sourceAutomation", { name: g.actorLabel ?? "" });
      default:
        return g.actorLabel ?? t("actorUnknown");
    }
  }

  function formatWhen(iso: string): string {
    try {
      return new Intl.DateTimeFormat(locale, { dateStyle: "medium", timeStyle: "short" }).format(new Date(iso));
    } catch {
      return iso;
    }
  }

  async function confirmClear() {
    setClearing(true);
    try {
      await history.clear();
      setConfirmOpen(false);
      toast.success(t("clearDone"));
    } catch {
      toast.error(t("clearError"));
    } finally {
      setClearing(false);
    }
  }

  function changeLine(c: RowChangeEntry, i: number) {
    return (
      <div key={`${c.columnId}-${i}`}>
        <b className="font-semibold">{c.columnName}</b>{" "}
        <s className="text-muted-foreground">{formatHistoryValue(c.before, c.columnType, labels, c.columnId)}</s>{" "}
        {formatHistoryValue(c.after, c.columnType, labels, c.columnId)}
      </div>
    );
  }

  function renderGroup(g: RowHistoryGroup) {
    const who = actorName(g);
    const Icon = g.kind === "created" ? (g.source === "restore" ? Undo2 : Plus) : g.kind === "deleted" ? Trash2 : Pencil;
    const multi = g.kind === "updated" && g.changes.length > 1;
    const open = expanded.has(g.key);
    let summary: string;
    if (g.kind === "created") {
      summary = g.source === "restore" ? t("restoredRow", { actor: who }) : t("createdRow", { actor: who });
    } else if (g.kind === "deleted") {
      summary = t("deletedRow", { actor: who });
    } else if (multi) {
      summary = t("changedFields", { actor: who, count: g.changes.length });
    } else {
      summary = t("changedField", { actor: who, field: g.changes[0]?.columnName ?? "" });
    }
    const single = g.kind === "updated" && !multi ? g.changes[0] : undefined;
    return (
      <li key={g.key} className="relative flex gap-2.5 py-1.5">
        <div className="z-[1] flex size-[25px] flex-none items-center justify-center rounded-full border border-border bg-background text-muted-foreground">
          <Icon className="size-3.5" aria-hidden="true" />
        </div>
        <div className="min-w-0 flex-1 text-[0.8125rem]">
          <div className="flex items-start justify-between gap-2">
            <div className="min-w-0">
              {summary}
              {single && (
                <div>
                  <s className="text-muted-foreground">{formatHistoryValue(single.before, single.columnType, labels, single.columnId)}</s>{" "}
                  {formatHistoryValue(single.after, single.columnType, labels, single.columnId)}
                </div>
              )}
            </div>
            <div className="flex flex-none items-center gap-1">
              <span className="text-xs text-muted-foreground">{formatWhen(g.createdAt)}</span>
              {multi && (
                <Tip label={open ? t("collapse") : t("expand")}>
                  <Button
                    type="button"
                    variant="ghost"
                    size="icon-xs"
                    aria-expanded={open}
                    aria-label={open ? t("collapse") : t("expand")}
                    onClick={() => toggle(g.key)}
                  >
                    {open ? <ChevronUp /> : <ChevronDown />}
                  </Button>
                </Tip>
              )}
            </div>
          </div>
          {multi && open && <div className="mt-1 space-y-1">{g.changes.map(changeLine)}</div>}
        </div>
      </li>
    );
  }

  function actorLabel(actor: { name: string } | null): string {
    return actor?.name || t("actorDeleted");
  }

  function renderMentions(c: RowActivityComment) {
    const eligible = new Set(c.mentions.map((m) => m.toLowerCase()));
    return parseMentionSegments(c.body ?? "").map((seg, i) => {
      if (seg.type === "text") return <span key={i}>{seg.text}</span>;
      if (!eligible.has(seg.userId)) return <span key={i}>@{seg.label}</span>;
      const name = personName(seg.userId);
      if (!name) return <span key={i}>@{t("actorDeleted")}</span>;
      return (
        <span key={i} data-mention="" className="rounded bg-primary/10 px-1 font-medium text-primary">
          @{name}
        </span>
      );
    });
  }

  function renderComment(c: RowActivityComment) {
    const who = actorLabel(c.actor);
    return (
      <li
        key={c.id}
        ref={(el) => {
          if (el) commentRefs.current.set(c.id, el);
          else commentRefs.current.delete(c.id);
        }}
        tabIndex={-1}
        className="relative flex gap-2.5 py-1.5 outline-none focus-visible:ring-3 focus-visible:ring-ring/50"
      >
        <div className="z-[1] flex size-[25px] flex-none items-center justify-center rounded-full border border-border bg-background text-muted-foreground">
          <MessageSquare className="size-3.5" aria-hidden="true" />
        </div>
        <div className="min-w-0 flex-1 text-[0.8125rem]">
          <div className="flex items-start justify-between gap-2">
            <span className={c.deleted ? "font-semibold text-muted-foreground" : "font-semibold"}>{who}</span>
            <span className="flex flex-none items-center gap-1">
              <span className="text-xs text-muted-foreground">{formatWhen(c.createdAt)}</span>
              {editingId !== c.id && history.permission && history.viewerId && (
                <CommentEntryMenu
                  comment={c}
                  viewerId={history.viewerId}
                  permission={history.permission}
                  onEdit={() => setEditingId(c.id)}
                  onDelete={() => deleteComment(c.id)}
                />
              )}
            </span>
          </div>
          {c.deleted ? (
            <p className="mt-0.5 italic text-muted-foreground">{t("commentDeleted")}</p>
          ) : editingId === c.id ? (
            <CommentComposer
              databaseId={databaseId}
              rowId={rowId}
              permission={history.permission}
              edit={{
                initialBody: c.body ?? "",
                onSave: (body) => saveComment(c.id, body, c.body),
                onCancel: () => stopEditing(c.id),
              }}
            />
          ) : (
            <p className="mt-0.5 whitespace-pre-wrap break-words">
              {renderMentions(c)}
              {c.editedAt && <span className="ml-1 text-xs text-muted-foreground">{t("commentEdited")}</span>}
            </p>
          )}
        </div>
      </li>
    );
  }

  function renderTaskEvent(e: RowActivityTaskEvent) {
    const title = e.taskTitle?.trim() || t("taskTitleFallback");
    const key =
      e.type === "task_created" ? "taskCreatedEvent" : e.type === "task_completed" ? "taskCompletedEvent" : "taskReopenedEvent";
    const Icon = e.type === "task_completed" ? CircleCheck : e.type === "task_reopened" ? RotateCcw : ListChecks;
    const label = t("taskEventOpen", { title });
    const titleNode = onOpenTask ? (
      <Tip label={label}>
        <button
          type="button"
          aria-label={label}
          className="inline cursor-pointer rounded-sm font-semibold text-primary underline-offset-2 hover:underline focus-visible:ring-3 focus-visible:ring-ring/50 focus-visible:outline-none"
          onClick={() => onOpenTask(e.taskId)}
        >
          {title}
        </button>
      </Tip>
    ) : (
      <b className="font-semibold">{title}</b>
    );
    // The title is a node (link or bold): format around a sentinel, then interleave.
    const [before, after = ""] = t(key, { actor: actorLabel(e.actor), title: TITLE_SENTINEL }).split(TITLE_SENTINEL);
    const sentence = (
      <>
        {before}
        {titleNode}
        {after}
      </>
    );
    return (
      <li key={e.id} className="relative flex gap-2.5 py-1.5">
        <div className="z-[1] flex size-[25px] flex-none items-center justify-center rounded-full border border-border bg-background text-muted-foreground">
          <Icon className="size-3.5" aria-hidden="true" />
        </div>
        <div className="flex min-w-0 flex-1 items-start justify-between gap-2 text-[0.8125rem]">
          <div className="min-w-0">{sentence}</div>
          <span className="flex-none text-xs text-muted-foreground">{formatWhen(e.createdAt)}</span>
        </div>
      </li>
    );
  }

  function renderEntry(e: RowActivityEntry) {
    if (e.type === "change-group") return renderGroup(e);
    if (e.type === "comment") return renderComment(e);
    return renderTaskEvent(e);
  }

  return (
    <section aria-label={t("title")} className="min-w-0">
      {history.canClear && (
        <div className="mb-2 flex items-center justify-end gap-2">
          <Tip label={t("clearAction")}>
            <Button
              type="button"
              variant="ghost"
              size="icon-sm"
              aria-label={t("clearAction")}
              onClick={() => setConfirmOpen(true)}
            >
              <Trash2 />
            </Button>
          </Tip>
        </div>
      )}

      <CommentComposer
        databaseId={databaseId}
        rowId={rowId}
        permission={history.permission}
        onPublished={() => void history.reload()}
        onUndo={async (commentId) => {
          await apiDelete(`/api/databases/${databaseId}/rows/${rowId}/comments/${commentId}`, {});
          await history.reload();
        }}
      />

      {history.status === "loading" && (
        <div role="status" aria-busy="true" aria-label={t("loading")} className="space-y-3">
          {[0, 1, 2].map((i) => (
            <div key={i} className="flex gap-2.5">
              <Skeleton className="size-[25px] flex-none rounded-full" />
              <Skeleton className="h-9 flex-1" />
            </div>
          ))}
        </div>
      )}

      {history.status === "empty" && (
        <div className="flex flex-col items-center gap-2 rounded-lg border border-dashed border-border px-4 py-6 text-center text-sm text-muted-foreground">
          <History className="size-5" aria-hidden="true" />
          <p>{t("empty")}</p>
        </div>
      )}

      {history.status === "error" && (
        <div role="alert" className="flex flex-col items-center gap-2 rounded-lg border border-border px-4 py-6 text-center text-sm">
          <CircleAlert className="size-5 text-destructive" aria-hidden="true" />
          <p className="font-medium">{t("errorTitle")}</p>
          <Tip label={t("retry")}>
            <Button type="button" variant="outline" size="sm" aria-label={t("retry")} onClick={() => void history.retry()}>
              <RotateCcw />
              {t("retry")}
            </Button>
          </Tip>
        </div>
      )}

      {history.status === "ready" && (
        <>
          <ol className="relative m-0 list-none p-0 before:absolute before:bottom-1.5 before:left-3 before:top-1.5 before:w-px before:bg-border before:content-['']">
            {entries.map(renderEntry)}
          </ol>
          {history.moreError && (
            <p role="alert" className="mt-2 text-xs text-destructive">
              {t("errorTitle")}
            </p>
          )}
          {history.nextCursor && (
            <div className="mt-2 flex justify-center">
              <Tip label={t("loadMore")}>
                <Button
                  type="button"
                  variant="outline"
                  size="sm"
                  aria-label={t("loadMore")}
                  disabled={history.loadingMore}
                  onClick={() => void history.loadMore()}
                >
                  <ChevronDown />
                  {t("loadMore")}
                </Button>
              </Tip>
            </div>
          )}
        </>
      )}

      <Dialog open={confirmOpen} onOpenChange={(o) => !clearing && setConfirmOpen(o)}>
        <DialogContent showCloseButton={false}>
          <DialogHeader>
            <DialogTitle>{t("clearTitle")}</DialogTitle>
            <DialogDescription>{t("clearBody")}</DialogDescription>
          </DialogHeader>
          <DialogFooter>
            <Tip label={t("clearCancel")}>
              <Button type="button" variant="outline" aria-label={t("clearCancel")} disabled={clearing} onClick={() => setConfirmOpen(false)}>
                <X />
                {t("clearCancel")}
              </Button>
            </Tip>
            <Tip label={t("clearConfirm")}>
              <Button type="button" variant="destructive" aria-label={t("clearConfirm")} disabled={clearing} onClick={() => void confirmClear()}>
                <Trash2 />
                {t("clearConfirm")}
              </Button>
            </Tip>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </section>
  );
}
