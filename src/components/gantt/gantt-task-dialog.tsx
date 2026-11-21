"use client";

import { useState, useEffect, useCallback, useRef } from "react";
import { X, Link2, Link2Off, UserPlus } from "lucide-react";
import { useTranslations } from "next-intl";
import type { GanttEvent } from "./types";
import { Popover, PopoverContent, PopoverTrigger } from "@/components/ui/popover";
import { Input } from "@/components/ui/input";
import { VizHashAvatar } from "@/components/ui/vizhash-avatar";

interface GanttTaskDialogProps {
  event: GanttEvent;
  allEvents: GanttEvent[];
  onClose: () => void;
  onUpdate: (id: string, data: Partial<GanttEvent>) => Promise<void>;
  onAddDependency: (sourceId: string, targetId: string) => Promise<void>;
  onRemoveDependency: (sourceId: string, targetId: string) => Promise<void>;
  onDelete: (id: string) => Promise<void>;
}

const COLORS = [
  { value: "#3b82f6", key: "blue" },
  { value: "#8b5cf6", key: "purple" },
  { value: "#10b981", key: "green" },
  { value: "#f59e0b", key: "amber" },
  { value: "#ef4444", key: "red" },
  { value: "#ec4899", key: "pink" },
  { value: "#6b7280", key: "gray" },
] as const;

function toLocalDate(iso: string): string {
  const d = new Date(iso);
  if (isNaN(d.getTime())) {
    return new Date().toISOString().split("T")[0];
  }
  return d.toISOString().split("T")[0];
}

function durationDays(start: string, end: string): number {
  const s = new Date(start).getTime();
  const e = new Date(end).getTime();
  return Math.max(1, Math.round((e - s) / 86400000));
}

export function GanttTaskDialog({
  event,
  allEvents,
  onClose,
  onUpdate,
  onAddDependency,
  onRemoveDependency,
  onDelete,
}: GanttTaskDialogProps) {
  const t = useTranslations("gantt");
  const [title, setTitle] = useState(event.title);
  const [startDate, setStartDate] = useState(toLocalDate(event.startAt));
  const [days, setDays] = useState(durationDays(event.startAt, event.endAt));
  const [color, setColor] = useState(event.color || "#3b82f6");
  const [progress, setProgress] = useState(event.progress);
  const [saving, setSaving] = useState(false);
  const [assigneeId, setAssigneeId] = useState<string | null>(event.assignee?.id ?? null);
  const [assigneeName, setAssigneeName] = useState<string | null>(event.assignee?.name ?? null);
  const [assigneeQuery, setAssigneeQuery] = useState("");
  const [assigneeResults, setAssigneeResults] = useState<{ id: string; name: string; email: string; avatarUrl: string | null }[]>([]);
  const [assigneeOpen, setAssigneeOpen] = useState(false);
  const assigneeInputRef = useRef<HTMLInputElement>(null);
  const assigneeButtonRefs = useRef<(HTMLButtonElement | null)[]>([]);

  const endDate = (() => {
    const d = new Date(startDate);
    d.setDate(d.getDate() + days);
    return d.toISOString().split("T")[0];
  })();

  const incomingDeps = allEvents.filter((e) => (event.dependencies ?? []).includes(e.id));
  const outgoingDeps = allEvents.filter((e) => (e.dependencies ?? []).includes(event.id));
  const existingDepIds = new Set([...(event.dependencies ?? []), ...outgoingDeps.map((e) => e.id), event.id]);
  const availableForDep = allEvents.filter((e) => !existingDepIds.has(e.id));

  useEffect(() => {
    function onKeyDown(e: KeyboardEvent) {
      if (e.key === "Escape") onClose();
    }
    document.addEventListener("keydown", onKeyDown);
    return () => document.removeEventListener("keydown", onKeyDown);
  }, [onClose]);

  useEffect(() => {
    if (!assigneeOpen || assigneeQuery.length < 1) {
      setAssigneeResults([]);
      return;
    }
    const timer = setTimeout(() => {
      fetch(`/api/users/search?q=${encodeURIComponent(assigneeQuery)}&limit=6`)
        .then((r) => r.json())
        .then(setAssigneeResults)
        .catch(() => setAssigneeResults([]));
    }, 200);
    return () => clearTimeout(timer);
  }, [assigneeQuery, assigneeOpen]);

  useEffect(() => {
    assigneeButtonRefs.current = assigneeButtonRefs.current.slice(0, assigneeResults.length);
  }, [assigneeResults]);

  function handleAssigneeInputKeyDown(e: React.KeyboardEvent<HTMLInputElement>) {
    if (e.key === "ArrowDown" && assigneeResults.length > 0) {
      e.preventDefault();
      assigneeButtonRefs.current[0]?.focus();
    }
  }

  function handleAssigneeButtonKeyDown(
    e: React.KeyboardEvent<HTMLButtonElement>,
    index: number,
    user: { id: string; name: string; email: string; avatarUrl: string | null }
  ) {
    if (e.key === "ArrowDown") {
      e.preventDefault();
      assigneeButtonRefs.current[index + 1]?.focus();
    } else if (e.key === "ArrowUp") {
      e.preventDefault();
      if (index === 0) assigneeInputRef.current?.focus();
      else assigneeButtonRefs.current[index - 1]?.focus();
    } else if (e.key === "Enter") {
      e.preventDefault();
      setAssigneeId(user.id);
      setAssigneeName(user.name);
      setAssigneeOpen(false);
      setAssigneeQuery("");
    }
  }

  const handleSave = useCallback(async () => {
    setSaving(true);
    try {
      const start = new Date(startDate);
      start.setHours(0, 0, 0, 0);
      const end = new Date(start);
      end.setDate(end.getDate() + days);

      await onUpdate(event.id, {
        title,
        startAt: start.toISOString(),
        endAt: end.toISOString(),
        color,
        progress,
        assigneeId,
      });
      onClose();
    } finally {
      setSaving(false);
    }
  }, [event.id, title, startDate, days, color, progress, assigneeId, onUpdate, onClose]);

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/50" onClick={onClose}>
      <div
        className="bg-card border border-border rounded-lg shadow-xl w-full max-w-md max-h-[90vh] overflow-y-auto"
        onClick={(e) => e.stopPropagation()}
      >
        {/* Header */}
        <div className="flex items-center justify-between px-4 py-3 border-b border-border">
          <h3 className="text-sm font-semibold">{t("taskDialog.title")}</h3>
          <button onClick={onClose} className="text-muted-foreground hover:text-foreground">
            <X className="h-4 w-4" />
          </button>
        </div>

        <div className="p-4 space-y-4">
          {/* Nom */}
          <div>
            <label className="text-xs text-muted-foreground">{t("taskDialog.name")}</label>
            <input
              type="text"
              value={title}
              onChange={(e) => setTitle(e.target.value)}
              className="mt-1 w-full text-sm px-3 py-1.5 rounded border border-border bg-background focus:outline-none focus:ring-1 focus:ring-primary"
            />
          </div>

          {/* Dates */}
          <div className="grid grid-cols-3 gap-3">
            <div>
              <label className="text-xs text-muted-foreground">{t("taskDialog.startDate")}</label>
              <input
                type="date"
                value={startDate}
                onChange={(e) => setStartDate(e.target.value)}
                className="mt-1 w-full text-sm px-2 py-1.5 rounded border border-border bg-background focus:outline-none focus:ring-1 focus:ring-primary"
              />
            </div>
            <div>
              <label className="text-xs text-muted-foreground">{t("taskDialog.duration")}</label>
              <input
                type="number"
                min={1}
                value={days}
                onChange={(e) => setDays(Math.max(1, parseInt(e.target.value) || 1))}
                className="mt-1 w-full text-sm px-2 py-1.5 rounded border border-border bg-background focus:outline-none focus:ring-1 focus:ring-primary"
              />
            </div>
            <div>
              <label className="text-xs text-muted-foreground">{t("taskDialog.endDate")}</label>
              <input
                type="date"
                value={endDate}
                readOnly
                className="mt-1 w-full text-sm px-2 py-1.5 rounded border border-border bg-muted text-muted-foreground"
              />
            </div>
          </div>

          {/* Progression */}
          <div>
            <label className="text-xs text-muted-foreground">{t("taskDialog.progress", { value: progress })}</label>
            <input
              type="range"
              min={0}
              max={100}
              step={5}
              value={progress}
              onChange={(e) => setProgress(parseInt(e.target.value))}
              className="mt-1 w-full"
            />
          </div>

          {/* Couleur */}
          <div>
            <label className="text-xs text-muted-foreground">{t("taskDialog.color")}</label>
            <div className="flex gap-2 mt-1">
              {COLORS.map((c) => (
                <button
                  key={c.value}
                  onClick={() => setColor(c.value)}
                  className={`h-6 w-6 rounded-full border-2 transition-transform ${
                    color === c.value ? "border-foreground scale-110" : "border-transparent"
                  }`}
                  style={{ backgroundColor: c.value }}
                  title={t(`colors.${c.key}`)}
                />
              ))}
            </div>
          </div>

          {/* Dépendances amont */}
          <div>
            <label className="text-xs text-muted-foreground flex items-center gap-1">
              <Link2 className="h-3 w-3" /> {t("taskDialog.incomingDeps")}
            </label>
            <div className="mt-1 space-y-1">
              {incomingDeps.length === 0 && (
                <p className="text-[10px] text-muted-foreground/60 italic">{t("taskDialog.noDeps")}</p>
              )}
              {incomingDeps.map((dep) => (
                <div key={dep.id} className="flex items-center gap-2 text-xs">
                  <span className="h-2 w-2 rounded-full shrink-0" style={{ backgroundColor: dep.color || "#6b7280" }} />
                  <span className="flex-1 truncate">{dep.title}</span>
                  <button
                    className="text-muted-foreground hover:text-destructive"
                    onClick={() => onRemoveDependency(dep.id, event.id)}
                    title={t("taskDialog.removeDepAria")}
                  >
                    <Link2Off className="h-3 w-3" />
                  </button>
                </div>
              ))}
              {availableForDep.length > 0 && (
                <select
                  className="mt-1 w-full text-xs px-2 py-1 rounded border border-border bg-background"
                  value=""
                  onChange={(e) => {
                    if (e.target.value) onAddDependency(e.target.value, event.id);
                  }}
                >
                  <option value="">{t("taskDialog.addDepOption")}</option>
                  {availableForDep.map((task) => (
                    <option key={task.id} value={task.id}>{task.title}</option>
                  ))}
                </select>
              )}
            </div>
          </div>

          {/* Dépendances aval */}
          <div>
            <label className="text-xs text-muted-foreground flex items-center gap-1">
              <Link2 className="h-3 w-3" /> {t("taskDialog.outgoingDeps")}
            </label>
            <div className="mt-1 space-y-1">
              {outgoingDeps.length === 0 && (
                <p className="text-[10px] text-muted-foreground/60 italic">{t("taskDialog.noDeps")}</p>
              )}
              {outgoingDeps.map((dep) => (
                <div key={dep.id} className="flex items-center gap-2 text-xs">
                  <span className="h-2 w-2 rounded-full shrink-0" style={{ backgroundColor: dep.color || "#6b7280" }} />
                  <span className="flex-1 truncate">{dep.title}</span>
                  <button
                    className="text-muted-foreground hover:text-destructive"
                    onClick={() => onRemoveDependency(event.id, dep.id)}
                    title={t("taskDialog.removeDepAria")}
                  >
                    <Link2Off className="h-3 w-3" />
                  </button>
                </div>
              ))}
            </div>
          </div>

          {/* Responsable */}
          <div className="space-y-1">
            <label className="text-xs font-medium text-muted-foreground">{t("taskDialog.assignee")}</label>
            <Popover open={assigneeOpen} onOpenChange={setAssigneeOpen}>
              <PopoverTrigger render={
                <button
                  type="button"
                  className="flex items-center gap-2 w-full px-3 py-2 rounded-md border border-input hover:bg-accent text-sm transition-colors text-left"
                />
              }>
                {assigneeName ? (
                  <>
                    <VizHashAvatar email={assigneeName} size={20} className="rounded-full shrink-0" />
                    <span className="truncate">{assigneeName}</span>
                  </>
                ) : (
                  <>
                    <UserPlus className="h-4 w-4 text-muted-foreground shrink-0" />
                    <span className="text-muted-foreground">{t("taskDialog.noAssignee")}</span>
                  </>
                )}
              </PopoverTrigger>
              <PopoverContent className="w-64 p-2">
                <p className="text-xs font-medium text-muted-foreground mb-2">{t("taskDialog.assignTo")}</p>
                <Input
                  ref={assigneeInputRef}
                  placeholder={t("taskDialog.searchAssignee")}
                  value={assigneeQuery}
                  onChange={(e) => setAssigneeQuery(e.target.value)}
                  onKeyDown={handleAssigneeInputKeyDown}
                  className="h-7 text-sm mb-2"
                  autoFocus
                />
                {assigneeResults.length > 0 && (
                  <ul className="space-y-0.5" role="listbox">
                    {assigneeResults.map((u, index) => (
                      <li key={u.id} role="option" aria-selected={false}>
                        <button
                          ref={(el) => { assigneeButtonRefs.current[index] = el; }}
                          type="button"
                          onClick={() => { setAssigneeId(u.id); setAssigneeName(u.name); setAssigneeOpen(false); setAssigneeQuery(""); }}
                          onKeyDown={(e) => handleAssigneeButtonKeyDown(e, index, u)}
                          className="w-full flex items-center gap-2 px-2 py-1.5 rounded text-sm hover:bg-accent focus:bg-accent focus:outline-none transition-colors text-left"
                        >
                          <VizHashAvatar email={u.email} size={20} className="rounded-full shrink-0" />
                          <span className="truncate">{u.name}</span>
                        </button>
                      </li>
                    ))}
                  </ul>
                )}
                {assigneeName && (
                  <button
                    type="button"
                    onClick={() => { setAssigneeId(null); setAssigneeName(null); setAssigneeOpen(false); }}
                    className="w-full mt-1 px-2 py-1 text-xs text-muted-foreground hover:text-foreground transition-colors text-left"
                  >
                    {t("taskDialog.removeAssignee")}
                  </button>
                )}
              </PopoverContent>
            </Popover>
          </div>
        </div>

        {/* Footer */}
        <div className="flex items-center justify-between px-4 py-3 border-t border-border">
          <button
            onClick={() => { onDelete(event.id); onClose(); }}
            className="text-xs text-destructive hover:underline"
          >
            {t("taskDialog.delete")}
          </button>
          <div className="flex gap-2">
            <button
              onClick={onClose}
              className="px-3 py-1.5 text-xs rounded border border-border hover:bg-muted transition-colors"
            >
              {t("taskDialog.cancel")}
            </button>
            <button
              onClick={handleSave}
              disabled={saving || !title.trim()}
              className="px-3 py-1.5 text-xs rounded bg-primary text-primary-foreground hover:bg-primary/90 transition-colors disabled:opacity-50"
            >
              {saving ? "..." : t("taskDialog.save")}
            </button>
          </div>
        </div>
      </div>
    </div>
  );
}
