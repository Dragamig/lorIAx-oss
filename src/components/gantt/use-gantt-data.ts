"use client";

import { useState, useEffect, useCallback } from "react";
import type { GanttEvent } from "./types";
import { buildEventTree } from "./gantt-utils";

interface UseGanttDataReturn {
  events: GanttEvent[];
  tree: GanttEvent[];
  loading: boolean;
  refetch: () => Promise<void>;
  createTask: (title: string, parentEventId?: string) => Promise<void>;
  deleteTask: (id: string) => Promise<void>;
  updateEvent: (id: string, data: Partial<GanttEvent>) => Promise<void>;
  addDependency: (sourceId: string, targetId: string) => Promise<void>;
  removeDependency: (sourceId: string, targetId: string) => Promise<void>;
  reorderTask: (draggedId: string, targetId: string, position: "before" | "after" | "child") => void;
}

export function useGanttData(
  calendarId: string,
  rangeStart: Date,
  rangeEnd: Date,
): UseGanttDataReturn {
  const [events, setEvents] = useState<GanttEvent[]>([]);
  const [loading, setLoading] = useState(true);

  const fetchEvents = useCallback(async () => {
    setLoading(true);
    try {
      const params = new URLSearchParams({
        start: rangeStart.toISOString(),
        end: rangeEnd.toISOString(),
      });
      const res = await fetch(`/api/calendars/${calendarId}/events/gantt?${params}`);
      if (res.ok) {
        const data = await res.json();
        setEvents(data.events ?? []);
      }
    } finally {
      setLoading(false);
    }
  }, [calendarId, rangeStart, rangeEnd]);

  useEffect(() => {
    fetchEvents();
  }, [fetchEvents]);

  const createTask = useCallback(
    async (title: string, parentEventId?: string) => {
      const now = new Date();
      const startAt = new Date(now.getFullYear(), now.getMonth(), now.getDate(), 0, 0, 0);
      const endAt = new Date(startAt);
      endAt.setDate(endAt.getDate() + 3);

      const res = await fetch(`/api/calendars/${calendarId}/events`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          title,
          startAt: startAt.toISOString(),
          endAt: endAt.toISOString(),
          allDay: true,
          parentEventId: parentEventId || undefined,
        }),
      });
      if (res.ok) {
        await fetchEvents();
      }
    },
    [calendarId, fetchEvents],
  );

  const deleteTask = useCallback(
    async (id: string) => {
      const res = await fetch(`/api/events/${id}`, { method: "DELETE" });
      if (res.ok) {
        setEvents((prev) => prev.filter((e) => e.id !== id));
      }
    },
    [],
  );

  const updateEvent = useCallback(
    async (id: string, data: Partial<GanttEvent>) => {
      const res = await fetch(`/api/events/${id}`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(data),
      });
      if (res.ok) {
        setEvents((prev) =>
          prev.map((e) => (e.id === id ? { ...e, ...data } : e)),
        );
      }
    },
    [],
  );

  const addDependency = useCallback(
    async (sourceId: string, targetId: string) => {
      const res = await fetch(`/api/calendars/${calendarId}/gantt/dependencies`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ sourceEventId: sourceId, targetEventId: targetId }),
      });
      if (res.ok) {
        // Auto-shift target if it starts before source ends (finish-to-start)
        setEvents((prev) => {
          const source = prev.find((e) => e.id === sourceId);
          const target = prev.find((e) => e.id === targetId);
          if (source && target) {
            const sourceEnd = new Date(source.endAt).getTime();
            const targetStart = new Date(target.startAt).getTime();
            if (targetStart < sourceEnd) {
              const duration = new Date(target.endAt).getTime() - targetStart;
              const newStart = new Date(sourceEnd);
              const newEnd = new Date(sourceEnd + duration);
              // Persist the shift to the server
              fetch(`/api/events/${targetId}`, {
                method: "PATCH",
                headers: { "Content-Type": "application/json" },
                body: JSON.stringify({
                  startAt: newStart.toISOString(),
                  endAt: newEnd.toISOString(),
                }),
              });
              return prev.map((e) => {
                if (e.id === targetId) {
                  return {
                    ...e,
                    startAt: newStart.toISOString(),
                    endAt: newEnd.toISOString(),
                    dependencies: [...(e.dependencies ?? []), sourceId],
                  };
                }
                return e;
              });
            }
          }
          return prev.map((e) =>
            e.id === targetId
              ? { ...e, dependencies: [...(e.dependencies ?? []), sourceId] }
              : e,
          );
        });
      }
    },
    [calendarId],
  );

  const removeDependency = useCallback(
    async (sourceId: string, targetId: string) => {
      const res = await fetch(`/api/calendars/${calendarId}/gantt/dependencies`, {
        method: "DELETE",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ sourceEventId: sourceId, targetEventId: targetId }),
      });
      if (res.ok) {
        setEvents((prev) =>
          prev.map((e) =>
            e.id === targetId
              ? { ...e, dependencies: (e.dependencies ?? []).filter((d) => d !== sourceId) }
              : e,
          ),
        );
      }
    },
    [calendarId],
  );

  const reorderTask = useCallback(
    (draggedId: string, targetId: string, position: "before" | "after" | "child") => {
      setEvents((prev) => {
        const dragged = prev.find((e) => e.id === draggedId);
        const target = prev.find((e) => e.id === targetId);
        if (!dragged || !target) return prev;

        // Determine new parentEventId
        let newParentId: string | null;
        if (position === "child") {
          newParentId = targetId;
        } else {
          newParentId = target.parentEventId;
        }

        // Update parentEventId optimistically
        const updated = prev.map((e) =>
          e.id === draggedId ? { ...e, parentEventId: newParentId } : e,
        );

        // Reorder within same level: move dragged before/after target
        const siblings = updated.filter((e) => e.parentEventId === newParentId);
        const _others = updated.filter((e) => e.parentEventId !== newParentId || e.id === draggedId);
        const filteredSiblings = siblings.filter((e) => e.id !== draggedId);
        const targetIdx = filteredSiblings.findIndex((e) => e.id === targetId);
        if (targetIdx >= 0 && position !== "child") {
          const insertIdx = position === "after" ? targetIdx + 1 : targetIdx;
          filteredSiblings.splice(insertIdx, 0, updated.find((e) => e.id === draggedId)!);
          // Rebuild full list: others + reordered siblings
          const reordered = updated.filter((e) => e.parentEventId !== newParentId && e.id !== draggedId);
          reordered.push(...filteredSiblings);
          // Persist parentEventId change
          if (newParentId !== dragged.parentEventId) {
            fetch(`/api/events/${draggedId}`, {
              method: "PATCH",
              headers: { "Content-Type": "application/json" },
              body: JSON.stringify({ parentEventId: newParentId }),
            });
          }
          return reordered;
        }

        // Persist parentEventId change
        if (newParentId !== dragged.parentEventId) {
          fetch(`/api/events/${draggedId}`, {
            method: "PATCH",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify({ parentEventId: newParentId }),
          });
        }

        return updated;
      });
    },
    [],
  );

  const tree = buildEventTree(events);

  return { events, tree, loading, refetch: fetchEvents, createTask, deleteTask, updateEvent, addDependency, removeDependency, reorderTask };
}
