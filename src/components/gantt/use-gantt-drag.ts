"use client";

import { useState, useCallback, useRef, useEffect } from "react";
import type { GanttDragState, ZoomConfig } from "./types";

interface DragEvent {
  id: string;
  startAt: string;
  endAt: string;
  dependencies: string[];
}

interface UseDragProps {
  zoom: ZoomConfig;
  rangeStart: Date;
  events: DragEvent[];
  onUpdateEvent: (id: string, updates: Record<string, unknown>) => Promise<void>;
  onAddDependency: (sourceId: string, targetId: string) => Promise<void>;
}

export function useGanttDrag({ zoom, rangeStart: _rangeStart, events, onUpdateEvent, onAddDependency }: UseDragProps) {
  const [dragState, setDragState] = useState<GanttDragState | null>(null);
  const [dragDeltaX, setDragDeltaX] = useState(0);
  const [dragLine, setDragLine] = useState<{ x1: number; y1: number; x2: number; y2: number } | null>(null);
  const svgRef = useRef<SVGSVGElement | null>(null);
  const initialMouseX = useRef(0);

  const startDrag = useCallback((
    type: GanttDragState["type"],
    eventId: string,
    startX: number,
    startDate: Date,
    endDate: Date,
    mouseX: number,
    mouseY: number,
  ) => {
    setDragState({ type, eventId, startX, startDate, startEnd: endDate });
    setDragDeltaX(0);
    initialMouseX.current = mouseX;
    if (type === "dependency") {
      setDragLine({ x1: startX, y1: mouseY, x2: startX, y2: mouseY });
    }
  }, []);

  useEffect(() => {
    if (!dragState) return;

    function handleMouseMove(e: MouseEvent) {
      if (!dragState || !svgRef.current) return;

      if (dragState.type === "dependency") {
        const rect = svgRef.current.getBoundingClientRect();
        const scrollParent = svgRef.current.parentElement;
        const currentX = e.clientX - rect.left + (scrollParent?.scrollLeft ?? 0);
        const currentY = e.clientY - rect.top + (scrollParent?.scrollTop ?? 0);
        setDragLine((prev) => prev ? { ...prev, x2: currentX, y2: currentY } : null);
      } else {
        // Real-time visual offset for move/resize
        const deltaX = e.clientX - initialMouseX.current;
        setDragDeltaX(deltaX);
      }
    }

    function handleMouseUp(e: MouseEvent) {
      if (!dragState) return;

      const deltaX = e.clientX - initialMouseX.current;
      const deltaMs = (deltaX / zoom.columnWidth) * zoom.step;

      if (dragState.type === "move" && dragState.startDate && dragState.startEnd) {
        const deltaDays = Math.round(deltaMs / 86400000);
        if (deltaDays !== 0) {
          let newStart = new Date(dragState.startDate);
          newStart.setDate(newStart.getDate() + deltaDays);
          const newEnd = new Date(dragState.startEnd);
          newEnd.setDate(newEnd.getDate() + deltaDays);

          // Enforce: task cannot start before its predecessors end
          const ev = events.find((e) => e.id === dragState.eventId);
          if (ev && ev.dependencies.length > 0) {
            let latestPredEnd = 0;
            for (const depId of ev.dependencies) {
              const pred = events.find((e) => e.id === depId);
              if (pred) {
                const predEnd = new Date(pred.endAt).getTime();
                if (predEnd > latestPredEnd) latestPredEnd = predEnd;
              }
            }
            if (latestPredEnd > 0 && newStart.getTime() < latestPredEnd) {
              // Snap to predecessor end
              const duration = newEnd.getTime() - newStart.getTime();
              newStart = new Date(latestPredEnd);
              newEnd.setTime(latestPredEnd + duration);
            }
          }

          onUpdateEvent(dragState.eventId, {
            startAt: newStart.toISOString(),
            endAt: newEnd.toISOString(),
          });
        }
      } else if (dragState.type === "resize" && dragState.startEnd && dragState.startDate) {
        const deltaDays = Math.round(deltaMs / 86400000);
        if (deltaDays !== 0) {
          const newEnd = new Date(dragState.startEnd);
          newEnd.setDate(newEnd.getDate() + deltaDays);
          if (newEnd > dragState.startDate) {
            onUpdateEvent(dragState.eventId, { endAt: newEnd.toISOString() });
          }
        }
      }

      setDragState(null);
      setDragDeltaX(0);
      setDragLine(null);
    }

    document.addEventListener("mousemove", handleMouseMove);
    document.addEventListener("mouseup", handleMouseUp);
    return () => {
      document.removeEventListener("mousemove", handleMouseMove);
      document.removeEventListener("mouseup", handleMouseUp);
    };
  }, [dragState, zoom, onUpdateEvent, events]);

  const handleDependencyDrop = useCallback((targetEventId: string) => {
    if (dragState?.type === "dependency" && dragState.eventId !== targetEventId) {
      onAddDependency(dragState.eventId, targetEventId);
      setDragState(null);
      setDragDeltaX(0);
      setDragLine(null);
    }
  }, [dragState, onAddDependency]);

  return { dragState, dragDeltaX, dragLine, svgRef, startDrag, handleDependencyDrop };
}
