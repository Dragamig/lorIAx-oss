"use client";

import { useMemo } from "react";
import type { ZoomConfig } from "./types";

interface GanttTimeHeaderProps {
  rangeStart: Date;
  rangeEnd: Date;
  zoom: ZoomConfig;
  scrollLeft: number;
}

interface HeaderCell {
  label: string;
  x: number;
  width: number;
  isToday: boolean;
}

function isSameDay(a: Date, b: Date): boolean {
  return (
    a.getFullYear() === b.getFullYear() &&
    a.getMonth() === b.getMonth() &&
    a.getDate() === b.getDate()
  );
}

export function GanttTimeHeader({
  rangeStart,
  rangeEnd,
  zoom,
  scrollLeft,
}: GanttTimeHeaderProps) {
  const today = useMemo(() => new Date(), []);

  const { mainCells, subCells } = useMemo(() => {
    const mains: HeaderCell[] = [];
    const subs: HeaderCell[] = [];
    const totalMs = rangeEnd.getTime() - rangeStart.getTime();
    const totalColumns = Math.ceil(totalMs / zoom.step);

    // Build sub cells (one per step)
    for (let i = 0; i < totalColumns; i++) {
      const date = new Date(rangeStart.getTime() + i * zoom.step);
      const x = i * zoom.columnWidth;
      subs.push({
        label: zoom.subLabel(date),
        x,
        width: zoom.columnWidth,
        isToday: isSameDay(date, today),
      });
    }

    // Build main cells (grouped by main label)
    let currentLabel = "";
    let currentStart = 0;
    let currentWidth = 0;

    for (let i = 0; i < totalColumns; i++) {
      const date = new Date(rangeStart.getTime() + i * zoom.step);
      const label = zoom.mainLabel(date);

      if (label !== currentLabel) {
        if (currentLabel) {
          mains.push({
            label: currentLabel,
            x: currentStart,
            width: currentWidth,
            isToday: false,
          });
        }
        currentLabel = label;
        currentStart = i * zoom.columnWidth;
        currentWidth = zoom.columnWidth;
      } else {
        currentWidth += zoom.columnWidth;
      }
    }
    if (currentLabel) {
      mains.push({
        label: currentLabel,
        x: currentStart,
        width: currentWidth,
        isToday: false,
      });
    }

    return { mainCells: mains, subCells: subs };
  }, [rangeStart, rangeEnd, zoom, today]);

  const totalWidth = subCells.length * zoom.columnWidth;

  return (
    <div
      className="sticky top-0 z-10 bg-card border-b border-border"
      style={{ width: totalWidth }}
    >
      {/* Niveau 1 — labels principaux */}
      <div className="flex h-[26px] border-b border-border/50">
        {mainCells.map((cell, i) => (
          <div
            key={i}
            className="flex items-center justify-center text-[10px] font-medium text-muted-foreground border-r border-border/30 shrink-0 overflow-hidden"
            style={{
              width: cell.width,
              transform: `translateX(${-scrollLeft % cell.width > cell.width / 2 ? 0 : 0}px)`,
            }}
          >
            <span className="truncate px-1">{cell.label}</span>
          </div>
        ))}
      </div>

      {/* Niveau 2 — sous-labels */}
      <div className="flex h-[26px]">
        {subCells.map((cell, i) => (
          <div
            key={i}
            className={`flex items-center justify-center text-[9px] border-r border-border/20 shrink-0 ${
              cell.isToday
                ? "bg-primary/10 text-primary font-semibold"
                : "text-muted-foreground"
            }`}
            style={{ width: cell.width }}
          >
            <span className="truncate">{cell.label}</span>
          </div>
        ))}
      </div>
    </div>
  );
}
