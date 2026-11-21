"use client";

import { useEffect, useMemo, useRef, useState } from "react";
import { useFormatter, useTranslations } from "next-intl";
import { toast } from "sonner";
import { Ban, Check, ChevronRight, MoreHorizontal, Play, Plus, RotateCcw, X } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { DropdownMenu, DropdownMenuContent, DropdownMenuItem, DropdownMenuTrigger } from "@/components/ui/dropdown-menu";
import { Tip } from "@/components/editor/extensions/database-block/row-tip";
import { ApiError, apiDelete, apiPatch, apiPost } from "@/components/editor/extensions/database-block/api";
import type { RowTaskDto, TaskStatus } from "@/lib/databases/row-tasks";
import type { UseRowTasksResult } from "./use-row-tasks";
import { AssigneePicker, type Person } from "./assignee-picker";

export interface RowTasksProps {
  databaseId: string;
  rowId: string;
  /** Single instance owned by RowAside (the badge reads the same state). */
  rowTasks: UseRowTasksResult;
  /** Called after any task change so the parent refreshes the count and the activity. */
  onChange: () => void;
  /** Task to scroll to and highlight (from the activity timeline). */
  focusTaskId?: string | null;
}

const RANK: Record<TaskStatus, number> = { open: 0, in_progress: 1, done: 2, cancelled: 3 };
const ROW_CLASS = "flex h-12 items-center gap-2 rounded-md px-2 hover:bg-muted/50 focus-within:bg-muted/50";

const isOpenStatus = (s: TaskStatus) => s === "open" || s === "in_progress";

function localDayKey(d = new Date()) {
  const p = (n: number) => String(n).padStart(2, "0");
  return `${d.getFullYear()}-${p(d.getMonth() + 1)}-${p(d.getDate())}`;
}

/** Due dates are calendar days stored at UTC midnight: compare the day part only. */
const dayOf = (dueAt: string) => dueAt.slice(0, 10);

function initials(name: string) {
  return name.trim().split(/\s+/).slice(0, 2).map((w) => w[0]?.toUpperCase() ?? "").join("");
}

export function RowTasks({ databaseId, rowId, rowTasks, onChange, focusTaskId }: RowTasksProps) {
  const t = useTranslations("rowTasks");
  const format = useFormatter();
  const { status, tasks, permission, reload, setTasks } = rowTasks;
  const canWrite = permission !== "viewer";
  const base = `/api/databases/${databaseId}/rows/${rowId}/tasks`;

  const [formOpen, setFormOpen] = useState(false);
  const [title, setTitle] = useState("");
  const [due, setDue] = useState("");
  const [assignee, setAssignee] = useState<Person | null>(null);
  const [titleError, setTitleError] = useState(false);
  const [saving, setSaving] = useState(false);
  const inFlight = useRef(new Set<string>());
  const focusedRef = useRef<string | null>(null);
  const [showCancelled, setShowCancelled] = useState(false);
  const titleRef = useRef<HTMLInputElement>(null);
  const addRef = useRef<HTMLButtonElement>(null);

  const { active, cancelled } = useMemo(() => {
    const sorted = [...tasks].sort((a, b) => RANK[a.status] - RANK[b.status]);
    return { active: sorted.filter((x) => x.status !== "cancelled"), cancelled: sorted.filter((x) => x.status === "cancelled") };
  }, [tasks]);

  // Scroll to and focus the task coming from the timeline (reveal the cancelled group if needed).
  useEffect(() => {
    if (!focusTaskId || status !== "ready" || focusedRef.current === focusTaskId) return;
    const el = Array.from(document.querySelectorAll<HTMLElement>("[data-task-id]")).find((n) => n.dataset.taskId === focusTaskId);
    if (el) {
      focusedRef.current = focusTaskId;
      el.scrollIntoView?.({ block: "nearest" });
      el.focus();
    }
  }, [focusTaskId, status, cancelled, showCancelled]);
  const cancelledOpen = showCancelled || (!!focusTaskId && cancelled.some((x) => x.id === focusTaskId));

  function openForm() {
    if (canWrite) setFormOpen(true);
  }

  useEffect(() => {
    if (formOpen) titleRef.current?.focus();
  }, [formOpen]);

  function closeForm() {
    setFormOpen(false);
    setTitle("");
    setDue("");
    setAssignee(null);
    setTitleError(false);
    addRef.current?.focus();
  }

  async function setStatus(task: RowTaskDto, next: TaskStatus, message: string) {
    if (inFlight.current.has(task.id)) return;
    inFlight.current.add(task.id);
    const previous = task.status;
    try {
      const res = await apiPatch<{ task: RowTaskDto }>(`${base}/${task.id}`, { status: next });
      setTasks((prev) => prev.map((x) => (x.id === task.id ? res.task : x)));
    } catch {
      toast.error(t("toastError"));
      return;
    } finally {
      inFlight.current.delete(task.id);
    }
    onChange();
    toast.success(message, {
      action: {
        label: t("undo"),
        onClick: () => {
          void (async () => {
            try {
              const res = await apiPatch<{ task: RowTaskDto }>(`${base}/${task.id}`, { status: previous });
              setTasks((prev) => prev.map((x) => (x.id === task.id ? res.task : x)));
              onChange();
              toast.success(t("toastUndone"));
            } catch {
              toast.error(t("toastError"));
            }
          })();
        },
      },
    });
  }

  function toggle(task: RowTaskDto) {
    if (!canWrite) return;
    if (task.status === "done") void setStatus(task, "open", t("toastReopened"));
    else void setStatus(task, "done", t("toastDone"));
  }

  async function submit() {
    if (saving) return;
    const trimmed = title.trim();
    if (!trimmed) {
      setTitleError(true);
      titleRef.current?.focus();
      return;
    }
    setSaving(true);
    try {
      const res = await apiPost<{ task: RowTaskDto }>(base, {
        title: trimmed,
        dueAt: due ? `${due}T00:00:00.000Z` : null,
        assigneeId: assignee?.id ?? null,
      });
      setTasks((prev) => [...prev, res.task]);
      closeForm();
      onChange();
      toast.success(t("toastCreated"), {
        action: {
          label: t("undo"),
          onClick: () => {
            void (async () => {
              try {
                await apiDelete(`${base}/${res.task.id}`, undefined);
                setTasks((prev) => prev.filter((x) => x.id !== res.task.id));
                onChange();
                toast.success(t("toastRemoved"));
              } catch {
                toast.error(t("toastError"));
              }
            })();
          },
        },
      });
    } catch (e) {
      toast.error(e instanceof ApiError && e.status === 422 ? t("ineligible") : t("toastError"));
    } finally {
      setSaving(false);
    }
  }

  function onFormKeyDown(e: React.KeyboardEvent) {
    if (e.key === "Escape") {
      e.preventDefault();
      e.stopPropagation();
      e.nativeEvent.stopImmediatePropagation();
      closeForm();
    } else if (e.key === "Enter" && !e.nativeEvent.isComposing && e.keyCode !== 229 && (e.target as HTMLElement).tagName !== "BUTTON") {
      e.preventDefault();
      void submit();
    }
  }

  const todayKey = localDayKey();

  function renderRow(task: RowTaskDto) {
    const overdue = isOpenStatus(task.status) && task.dueAt !== null && dayOf(task.dueAt) < todayKey;
    const done = task.status === "done";
    const assigneeName = task.assignee ? task.assignee.name || t("assigneeNone") : null;
    const checkLabel = done ? t("markOpen", { title: task.title }) : t("markDone", { title: task.title });
    const statusLabel = {
      open: t("statusOpen"),
      in_progress: t("statusInProgress"),
      done: t("statusDone"),
      cancelled: t("statusCancelled"),
    }[task.status];
    return (
      <li
        key={task.id}
        data-testid="row-task"
        data-task-id={task.id}
        tabIndex={-1}
        className={`${ROW_CLASS} outline-none focus-visible:ring-2 focus-visible:ring-ring`}
      >
        <Tip label={canWrite ? checkLabel : t("readOnly")}>
          <button
            type="button"
            role="checkbox"
            aria-checked={done}
            aria-disabled={!canWrite}
            aria-label={checkLabel}
            onClick={() => toggle(task)}
            className={`flex size-6 shrink-0 items-center justify-center rounded border focus-visible:ring-2 focus-visible:ring-ring ${
              done ? "border-primary bg-primary text-primary-foreground" : "border-input"
            } ${canWrite ? "" : "cursor-not-allowed opacity-50"}`}
          >
            {done && <Check className="size-3.5" aria-hidden="true" />}
          </button>
        </Tip>
        <div className="flex min-w-0 flex-1 flex-col justify-center leading-tight">
          <span
            data-testid="row-task-title"
            title={task.title}
            className={`truncate text-sm ${done || task.status === "cancelled" ? "text-muted-foreground line-through" : ""}`}
          >
            {task.title}
          </span>
          <span className="flex h-4 items-center gap-1.5 truncate text-xs text-muted-foreground">
            <span className="shrink-0">{statusLabel}</span>
            {task.dueAt && (
              <span className={`truncate ${overdue ? "font-medium text-destructive" : ""}`}>
                <span aria-hidden="true">· </span>
                {overdue && <span>{t("overdue")} · </span>}
                {t("dueOn", { date: format.dateTime(new Date(`${dayOf(task.dueAt)}T12:00:00`), { dateStyle: "medium" }) })}
              </span>
            )}
          </span>
        </div>
        {assigneeName !== null && (
          <span className="flex max-w-28 shrink-0 items-center gap-1.5 text-xs text-muted-foreground" title={assigneeName}>
            <span
              aria-hidden="true"
              className="flex size-5 shrink-0 items-center justify-center rounded-full bg-muted text-[10px] font-medium text-foreground"
            >
              {initials(task.assignee?.name ?? "") || "?"}
            </span>
            <span className="truncate">{assigneeName}</span>
          </span>
        )}
        {canWrite && (
          <DropdownMenu>
            <Tip label={t("menu")}>
              <DropdownMenuTrigger
                render={
                  <Button type="button" variant="ghost" size="icon-xs" aria-label={t("menu")}>
                    <MoreHorizontal />
                  </Button>
                }
              />
            </Tip>
            <DropdownMenuContent align="end" className="w-48">
              {task.status === "open" && (
                <DropdownMenuItem onClick={() => void setStatus(task, "in_progress", t("toastInProgress"))}>
                  <Play aria-hidden="true" />
                  <span>{t("setInProgress")}</span>
                </DropdownMenuItem>
              )}
              {isOpenStatus(task.status) && (
                <DropdownMenuItem onClick={() => void setStatus(task, "cancelled", t("toastCancelled"))}>
                  <Ban aria-hidden="true" />
                  <span>{t("cancelTask")}</span>
                </DropdownMenuItem>
              )}
              {(task.status === "done" || task.status === "cancelled") && (
                <DropdownMenuItem onClick={() => void setStatus(task, "open", t("toastReopened"))}>
                  <RotateCcw aria-hidden="true" />
                  <span>{t("reopen")}</span>
                </DropdownMenuItem>
              )}
            </DropdownMenuContent>
          </DropdownMenu>
        )}
      </li>
    );
  }

  const addButton = (
    <Tip label={canWrite ? t("add") : t("addDisabledViewer")}>
      <Button
        ref={addRef}
        type="button"
        variant="outline"
        size="sm"
        aria-label={t("add")}
        aria-disabled={!canWrite}
        className={canWrite ? "" : "cursor-not-allowed opacity-50"}
        onClick={openForm}
      >
        <Plus aria-hidden="true" />
        <span>{t("add")}</span>
      </Button>
    </Tip>
  );

  if (status === "loading") {
    return (
      <div className="p-3 text-sm text-muted-foreground" role="status" data-testid="row-tasks">
        {t("loading")}
      </div>
    );
  }
  if (status === "error") {
    return (
      <div className="flex flex-col items-start gap-2 p-3" data-testid="row-tasks">
        <p role="alert" className="text-sm text-destructive">{t("errorTitle")}</p>
        <Button type="button" variant="outline" size="sm" aria-label={t("retry")} onClick={() => void reload()}>
          <RotateCcw aria-hidden="true" />
          <span>{t("retry")}</span>
        </Button>
      </div>
    );
  }

  return (
    <div className="flex flex-col gap-2 p-3" data-testid="row-tasks">
      {tasks.length === 0 && !formOpen && <p className="py-4 text-center text-sm text-muted-foreground">{t("empty")}</p>}
      {active.length > 0 && <ul className="flex flex-col">{active.map(renderRow)}</ul>}
      {cancelled.length > 0 && (
        <div>
          <button
            type="button"
            aria-expanded={cancelledOpen}
            onClick={() => setShowCancelled(!cancelledOpen)}
            className="flex min-h-6 items-center gap-1 rounded text-xs text-muted-foreground focus-visible:ring-2 focus-visible:ring-ring"
          >
            <ChevronRight className={`size-3.5 transition-transform ${cancelledOpen ? "rotate-90" : ""}`} aria-hidden="true" />
            {t("cancelledGroup", { count: cancelled.length })}
          </button>
          {cancelledOpen && <ul className="flex flex-col">{cancelled.map(renderRow)}</ul>}
        </div>
      )}
      {formOpen ? (
        <form
          className="flex flex-col gap-2 rounded-md border p-2"
          onKeyDown={onFormKeyDown}
          onSubmit={(e) => {
            e.preventDefault();
            void submit();
          }}
        >
          <label className="flex flex-col gap-1 text-xs text-muted-foreground">
            {t("titleLabel")}
            <Input
              ref={titleRef}
              value={title}
              aria-invalid={titleError}
              maxLength={500}
              placeholder={t("titlePlaceholder")}
              onChange={(e) => {
                setTitle(e.target.value);
                if (titleError) setTitleError(false);
              }}
            />
          </label>
          {titleError && (
            <p role="alert" className="text-xs text-destructive">{t("titleRequired")}</p>
          )}
          <div className="flex gap-2">
            <label className="flex flex-1 flex-col gap-1 text-xs text-muted-foreground">
              {t("dueLabel")}
              <Input type="date" value={due} onChange={(e) => setDue(e.target.value)} />
            </label>
            <div className="flex flex-1 flex-col gap-1 text-xs text-muted-foreground">
              {t("assigneeLabel")}
              <AssigneePicker databaseId={databaseId} value={assignee} onChange={setAssignee} />
            </div>
          </div>
          <div className="flex justify-end gap-2">
            <Tip label={t("cancel")} kbd="Échap">
              <Button type="button" variant="ghost" size="sm" aria-label={t("cancel")} onClick={closeForm}>
                <X aria-hidden="true" />
                <span>{t("cancel")}</span>
              </Button>
            </Tip>
            <Tip label={t("submit")} kbd="Entrée">
              <Button type="submit" size="sm" aria-label={t("submit")} disabled={saving}>
                <Check aria-hidden="true" />
                <span>{t("submit")}</span>
              </Button>
            </Tip>
          </div>
        </form>
      ) : (
        <div className="flex">{addButton}</div>
      )}
    </div>
  );
}
