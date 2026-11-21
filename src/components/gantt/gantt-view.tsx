"use client";

import { useState, useMemo, useCallback, useEffect } from "react";
import { useLocale, useTranslations } from "next-intl";
import { useGanttData } from "./use-gantt-data";
import { flattenTree } from "./gantt-utils";
import { GanttToolbar } from "./gantt-toolbar";
import { GanttTaskList } from "./gantt-task-list";
import { GanttTimeline } from "./gantt-timeline";
import type { ZoomLevel } from "./types";
import { createZoomConfigs } from "./types";
import { Loader2 } from "lucide-react";
import { GanttTaskDialog } from "./gantt-task-dialog";

interface GanttViewProps {
  calendarId: string;
  height?: number;
  embedded?: boolean;
}

export function GanttView({ calendarId, height, embedded: _embedded = false }: GanttViewProps) {
  const locale = useLocale();
  const t = useTranslations("gantt");
  const [zoom, setZoom] = useState<ZoomLevel>("week");
  const [collapsed, setCollapsed] = useState(new Set<string>());
  const [selectedId, setSelectedId] = useState<string | null>(null);
  const [criticalPath, setCriticalPath] = useState<string[]>([]);
  const [criticalPathActive, setCriticalPathActive] = useState(false);
  const [editingEventId, setEditingEventId] = useState<string | null>(null);

  // Fetch range: large window (6 months before → 6 months after)
  const [fetchStart] = useState(() => {
    const d = new Date(); d.setMonth(d.getMonth() - 6); d.setHours(0, 0, 0, 0); return d;
  });
  const [fetchEnd] = useState(() => {
    const d = new Date(); d.setMonth(d.getMonth() + 6); d.setHours(23, 59, 59, 999); return d;
  });

  const { events, tree, loading, refetch: _refetch, createTask, deleteTask, updateEvent, addDependency, removeDependency, reorderTask } =
    useGanttData(calendarId, fetchStart, fetchEnd);

  const zoomConfigs = useMemo(
    () => createZoomConfigs(locale, t("weekPrefix")),
    [locale, t],
  );

  // Visual range: from earliest event to latest, with padding
  const { rangeStart, rangeEnd: _rangeEnd } = useMemo(() => {
    if (events.length === 0) {
      const s = new Date(); s.setMonth(s.getMonth() - 1); s.setHours(0, 0, 0, 0);
      const e = new Date(); e.setMonth(e.getMonth() + 2); e.setHours(23, 59, 59, 999);
      return { rangeStart: s, rangeEnd: e };
    }
    let minDate = Infinity;
    let maxDate = -Infinity;
    for (const ev of events) {
      const s = new Date(ev.startAt).getTime();
      const e = new Date(ev.endAt).getTime();
      if (s < minDate) minDate = s;
      if (e > maxDate) maxDate = e;
    }
    const s = new Date(minDate); s.setDate(s.getDate() - 7); s.setHours(0, 0, 0, 0);
    const e = new Date(maxDate); e.setDate(e.getDate() + 14); e.setHours(23, 59, 59, 999);
    return { rangeStart: s, rangeEnd: e };
  }, [events]);

  const flatEvents = useMemo(() => flattenTree(tree, collapsed), [tree, collapsed]);

  useEffect(() => {
    function handleKeyDown(e: KeyboardEvent) {
      if (e.target instanceof HTMLInputElement || e.target instanceof HTMLTextAreaElement) return;
      if (e.key === "Escape") setSelectedId(null);
      if ((e.key === "+" || e.key === "=") && !e.ctrlKey) {
        setZoom((z) => z === "month" ? "week" : z === "week" ? "day" : z);
      }
      if (e.key === "-" && !e.ctrlKey) {
        setZoom((z) => z === "day" ? "week" : z === "week" ? "month" : z);
      }
      if (e.key === "ArrowUp" && selectedId) {
        const idx = flatEvents.findIndex((f) => f.event.id === selectedId);
        if (idx > 0) setSelectedId(flatEvents[idx - 1].event.id);
      }
      if (e.key === "ArrowDown" && selectedId) {
        const idx = flatEvents.findIndex((f) => f.event.id === selectedId);
        if (idx < flatEvents.length - 1) setSelectedId(flatEvents[idx + 1].event.id);
      }
    }
    window.addEventListener("keydown", handleKeyDown);
    return () => window.removeEventListener("keydown", handleKeyDown);
  }, [selectedId, flatEvents]);

  const toggleCriticalPath = useCallback(async () => {
    if (criticalPathActive) { setCriticalPathActive(false); setCriticalPath([]); return; }
    const res = await fetch(`/api/calendars/${calendarId}/gantt/critical-path`, {
      method: "POST", headers: { "Content-Type": "application/json" },
    });
    if (res.ok) {
      const data = await res.json();
      setCriticalPath(data.criticalPath);
      setCriticalPathActive(true);
    }
  }, [calendarId, criticalPathActive]);

  const containerClass = `flex flex-col border border-border rounded-lg overflow-hidden bg-card ${!height ? "h-full" : ""}`;
  const containerStyle = height ? { height } : undefined;

  const taskListProps = {
    allEvents: events,
    collapsed,
    onToggleCollapse: (id: string) => {
      setCollapsed((prev) => {
        const next = new Set(prev);
        if (next.has(id)) { next.delete(id); } else { next.add(id); }
        return next;
      });
    },
    selectedId,
    onSelect: setSelectedId,
    onCreateTask: createTask,
    onDeleteTask: deleteTask,
    onAddDependency: addDependency,
    onRemoveDependency: removeDependency,
    onDoubleClick: setEditingEventId,
    onReorder: reorderTask,
  };

  if (loading) {
    return (
      <div className={containerClass} style={containerStyle}>
        <GanttToolbar zoom={zoom} onZoomChange={setZoom} criticalPathActive={false} onToggleCriticalPath={() => {}} />
        <div className="flex-1 flex items-center justify-center">
          <Loader2 className="h-5 w-5 animate-spin text-muted-foreground" />
        </div>
      </div>
    );
  }

  if (events.length === 0) {
    return (
      <div className={containerClass} style={containerStyle}>
        <GanttToolbar zoom={zoom} onZoomChange={setZoom} criticalPathActive={false} onToggleCriticalPath={() => {}} />
        <div className="flex flex-1 overflow-hidden">
          <GanttTaskList flatEvents={[]} {...taskListProps} />
          <div className="flex-1 flex flex-col items-center justify-center gap-3 text-muted-foreground">
            <p className="text-sm">{t("empty.noTasks")}</p>
            <p className="text-xs">{t("empty.addHint")}</p>
          </div>
        </div>
      </div>
    );
  }

  const depCount = events.reduce((sum, e) => sum + ((e.dependencies ?? []).length), 0);
  const milestoneCount = events.filter((e) => {
    const s = new Date(e.startAt).getTime();
    const en = new Date(e.endAt).getTime();
    return e.allDay && Math.abs(en - s) < 86400000;
  }).length;

  return (
    <div className={containerClass} style={containerStyle}>
      <GanttToolbar
        zoom={zoom}
        onZoomChange={setZoom}
        criticalPathActive={criticalPathActive}
        onToggleCriticalPath={toggleCriticalPath}
      />
      <div className="flex flex-1 overflow-hidden">
        <GanttTaskList flatEvents={flatEvents} {...taskListProps} />
        <GanttTimeline
          flatEvents={flatEvents}
          zoom={zoomConfigs[zoom]}
          rangeStart={rangeStart}
          criticalPath={criticalPathActive ? criticalPath : []}
          selectedId={selectedId}
          onSelect={setSelectedId}
          onDoubleClick={setEditingEventId}
          onUpdateEvent={updateEvent}
          onAddDependency={addDependency}
        />
      </div>
      <div className="px-3 py-1 border-t border-border bg-muted/30 flex items-center gap-3 text-[11px] text-muted-foreground">
        <span>{t("status.tasks", { count: events.length })}</span>
        {milestoneCount > 0 && <><span>·</span><span>{t("status.milestones", { count: milestoneCount })}</span></>}
        {depCount > 0 && <><span>·</span><span>{t("status.dependencies", { count: depCount })}</span></>}
      </div>

      {/* Task edit dialog */}
      {editingEventId && (() => {
        const ev = events.find((e) => e.id === editingEventId);
        if (!ev) return null;
        return (
          <GanttTaskDialog
            event={ev}
            allEvents={events}
            onClose={() => setEditingEventId(null)}
            onUpdate={updateEvent}
            onAddDependency={addDependency}
            onRemoveDependency={removeDependency}
            onDelete={deleteTask}
          />
        );
      })()}
    </div>
  );
}
