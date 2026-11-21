"use client";

import { useRef, useState, useCallback, useMemo } from "react";
import type { GanttEvent, ZoomConfig } from "./types";
import type { FlatEvent } from "./gantt-utils";
import { dateToX } from "./gantt-utils";
import { GanttTimeHeader } from "./gantt-time-header";
import { GanttBar } from "./gantt-bar";
import { GanttMilestone } from "./gantt-milestone";
import { GanttDependencyArrow } from "./gantt-dependency-arrow";
import { useGanttDrag } from "./use-gantt-drag";

interface GanttTimelineProps {
  flatEvents: FlatEvent[];
  zoom: ZoomConfig;
  rangeStart: Date;
  criticalPath: string[];
  selectedId: string | null;
  onSelect: (id: string) => void;
  onDoubleClick: (id: string) => void;
  onUpdateEvent: (id: string, data: Partial<GanttEvent>) => Promise<void>;
  onAddDependency: (sourceId: string, targetId: string) => Promise<void>;
}

const ROW_HEIGHT = 36;
const DAY_MS = 86400000;

function isMilestone(event: GanttEvent): boolean {
  const s = new Date(event.startAt).getTime();
  const e = new Date(event.endAt).getTime();
  return event.allDay && Math.abs(e - s) < DAY_MS;
}

export function GanttTimeline({
  flatEvents,
  zoom,
  rangeStart,
  criticalPath,
  selectedId,
  onSelect,
  onDoubleClick,
  onUpdateEvent,
  onAddDependency,
}: GanttTimelineProps) {
  const scrollRef = useRef<HTMLDivElement>(null);
  const [scrollLeft, setScrollLeft] = useState(0);
  const [hoveredBarId, setHoveredBarId] = useState<string | null>(null);

  const allEvents = useMemo(() => flatEvents.map((fe) => fe.event), [flatEvents]);

  const { dragState, dragDeltaX, dragLine, svgRef, startDrag, handleDependencyDrop } = useGanttDrag({
    zoom,
    rangeStart,
    events: allEvents,
    onUpdateEvent: onUpdateEvent as (id: string, updates: Record<string, unknown>) => Promise<void>,
    onAddDependency,
  });

  const rangeEnd = useMemo(() => {
    const d = new Date(rangeStart);
    d.setMonth(d.getMonth() + 3);
    return d;
  }, [rangeStart]);

  const totalMs = rangeEnd.getTime() - rangeStart.getTime();
  const totalColumns = Math.ceil(totalMs / zoom.step);
  const totalWidth = totalColumns * zoom.columnWidth;
  const svgHeight = Math.max(flatEvents.length * ROW_HEIGHT, 100);

  const today = useMemo(() => new Date(), []);
  const todayX = dateToX(today, rangeStart, zoom);

  const eventMap = useMemo(() => {
    const map = new Map<string, { event: GanttEvent; rowIndex: number }>();
    flatEvents.forEach((fe, i) => map.set(fe.event.id, { event: fe.event, rowIndex: i }));
    return map;
  }, [flatEvents]);

  const handleScroll = useCallback(() => {
    if (scrollRef.current) {
      setScrollLeft(scrollRef.current.scrollLeft);
    }
  }, []);

  const handleBarMouseDown = useCallback(
    (e: React.MouseEvent, eventId: string, type: "move" | "resize" | "dependency") => {
      const ev = eventMap.get(eventId);
      if (!ev) return;
      const startDate = new Date(ev.event.startAt);
      const endDate = new Date(ev.event.endAt);
      const barEndX = dateToX(endDate, rangeStart, zoom);
      const rect = svgRef.current?.getBoundingClientRect();
      const scrollParent = svgRef.current?.parentElement;
      const mouseY = rect
        ? e.clientY - rect.top + (scrollParent?.scrollTop ?? 0)
        : ev.rowIndex * ROW_HEIGHT + ROW_HEIGHT / 2;

      startDrag(type, eventId, barEndX, startDate, endDate, e.clientX, mouseY);
    },
    [eventMap, rangeStart, zoom, startDrag, svgRef],
  );

  const criticalPathSet = useMemo(() => new Set(criticalPath), [criticalPath]);

  return (
    <div className="flex-1 overflow-hidden flex flex-col">
      <div
        ref={scrollRef}
        className="overflow-auto flex-1"
        onScroll={handleScroll}
      >
        <GanttTimeHeader
          rangeStart={rangeStart}
          rangeEnd={rangeEnd}
          zoom={zoom}
          scrollLeft={scrollLeft}
        />

        <svg
          ref={svgRef}
          width={totalWidth}
          height={svgHeight}
          className="block"
          style={{ cursor: dragState?.type === "move" ? "grabbing" : dragState?.type === "resize" ? "col-resize" : undefined }}
        >
          {/* Lignes horizontales de grille */}
          {flatEvents.map((_, i) => (
            <line
              key={`grid-h-${i}`}
              x1={0}
              y1={(i + 1) * ROW_HEIGHT}
              x2={totalWidth}
              y2={(i + 1) * ROW_HEIGHT}
              stroke="currentColor"
              strokeOpacity={0.06}
            />
          ))}

          {/* Lignes verticales de grille */}
          {Array.from({ length: totalColumns }, (_, i) => (
            <line
              key={`grid-v-${i}`}
              x1={i * zoom.columnWidth}
              y1={0}
              x2={i * zoom.columnWidth}
              y2={svgHeight}
              stroke="currentColor"
              strokeOpacity={0.04}
            />
          ))}

          {/* Ligne du jour */}
          {todayX > 0 && todayX < totalWidth && (
            <line
              x1={todayX}
              y1={0}
              x2={todayX}
              y2={svgHeight}
              stroke="hsl(var(--primary))"
              strokeWidth={1.5}
              strokeDasharray="4 3"
              strokeOpacity={0.6}
            />
          )}

          {/* Flèches de dépendance */}
          {flatEvents.map(({ event }) =>
            (event.dependencies ?? []).map((depId) => {
              const source = eventMap.get(depId);
              const target = eventMap.get(event.id);
              if (!source || !target) return null;

              const sourceEnd = new Date(source.event.endAt);
              const targetStart = new Date(target.event.startAt);
              const sx = dateToX(sourceEnd, rangeStart, zoom);
              const sy = source.rowIndex * ROW_HEIGHT + ROW_HEIGHT / 2;
              const tx = dateToX(targetStart, rangeStart, zoom);
              const ty = target.rowIndex * ROW_HEIGHT + ROW_HEIGHT / 2;
              const color = source.event.color || "#6b7280";
              const isHighlighted =
                criticalPathSet.has(depId) && criticalPathSet.has(event.id);

              return (
                <GanttDependencyArrow
                  key={`dep-${depId}-${event.id}`}
                  sourceX={sx}
                  sourceY={sy}
                  targetX={tx}
                  targetY={ty}
                  color={color}
                  highlighted={isHighlighted}
                />
              );
            }),
          )}

          {/* Barres et jalons */}
          {flatEvents.map(({ event }, rowIndex) => {
            if (isMilestone(event)) {
              const x = dateToX(new Date(event.startAt), rangeStart, zoom);
              return (
                <GanttMilestone
                  key={event.id}
                  event={event}
                  x={x}
                  y={rowIndex * ROW_HEIGHT}
                  selected={selectedId === event.id}
                  onSelect={onSelect}
                />
              );
            }

            const startDate = new Date(event.startAt);
            const endDate = new Date(event.endAt);
            let x = dateToX(startDate, rangeStart, zoom);
            let xEnd = dateToX(endDate, rangeStart, zoom);

            // Apply real-time drag offset
            const isDragging = dragState?.eventId === event.id;
            if (isDragging && dragState?.type === "move") {
              x += dragDeltaX;
              xEnd += dragDeltaX;
            } else if (isDragging && dragState?.type === "resize") {
              xEnd += dragDeltaX;
            }

            const width = Math.max(xEnd - x, 4);

            return (
              <GanttBar
                key={event.id}
                event={event}
                x={x}
                width={width}
                y={rowIndex * ROW_HEIGHT}
                rowHeight={ROW_HEIGHT}
                selected={selectedId === event.id}
                criticalPathHighlight={criticalPathSet.has(event.id)}
                onSelect={(id) => {
                  if (dragState?.type === "dependency") {
                    handleDependencyDrop(id);
                  } else {
                    onSelect(id);
                  }
                }}
                onDoubleClick={onDoubleClick}
                onMouseDown={handleBarMouseDown}
                onMouseUp={(id) => {
                  if (dragState?.type === "dependency") {
                    handleDependencyDrop(id);
                  }
                }}
                onMouseEnter={(id) => {
                  if (dragState?.type === "dependency" && id !== dragState.eventId) {
                    setHoveredBarId(id);
                  }
                }}
                onMouseLeave={() => setHoveredBarId(null)}
              />
            );
          })}

          {/* Drag dependency line */}
          {dragLine && dragState?.type === "dependency" && (() => {
            // Snap to target bar's left edge if hovering
            let x2 = dragLine.x2;
            let y2 = dragLine.y2;
            if (hoveredBarId) {
              const hovered = eventMap.get(hoveredBarId);
              if (hovered) {
                x2 = dateToX(new Date(hovered.event.startAt), rangeStart, zoom);
                y2 = hovered.rowIndex * ROW_HEIGHT + ROW_HEIGHT / 2;
              }
            }
            return (
              <line
                x1={dragLine.x1}
                y1={dragLine.y1}
                x2={x2}
                y2={y2}
                stroke={hoveredBarId ? "#10b981" : "#3b82f6"}
                strokeWidth={2}
                strokeDasharray={hoveredBarId ? "none" : "6 3"}
                pointerEvents="none"
              />
            );
          })()}
        </svg>
      </div>
    </div>
  );
}
