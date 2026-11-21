"use client";

import { useMemo } from "react";
import { useLocale } from "next-intl";
import type { ZoomConfig } from "./types";
import { durationDays } from "./gantt-utils";

export interface TimeColumn {
  date: Date;
  label: string;
  subLabel: string;
  isToday: boolean;
  x: number;
  width: number;
}

export function useGanttZoom(rangeStart: Date, rangeEnd: Date, zoom: ZoomConfig) {
  const locale = useLocale();
  const totalDays = durationDays(rangeStart, rangeEnd);
  const totalWidth = totalDays * zoom.columnWidth;

  const columns = useMemo(() => {
    const cols: TimeColumn[] = [];
    const today = new Date();
    today.setHours(0, 0, 0, 0);

    const fmtWeekdayShort = new Intl.DateTimeFormat(locale, { weekday: "short" });
    const fmtWeekdayNarrow = new Intl.DateTimeFormat(locale, { weekday: "narrow" });
    const fmtMonthShort = new Intl.DateTimeFormat(locale, { month: "short" });

    for (let i = 0; i < totalDays; i++) {
      const date = new Date(rangeStart);
      date.setDate(date.getDate() + i);
      date.setHours(0, 0, 0, 0);

      const isToday = date.getTime() === today.getTime();
      const x = i * zoom.columnWidth;

      let label = "";
      let subLabel = "";

      if (zoom.level === "day") {
        label = fmtWeekdayShort.format(date);
        subLabel = `${date.getDate()}/${date.getMonth() + 1}`;
      } else if (zoom.level === "week") {
        subLabel = fmtWeekdayNarrow.format(date);
        // Show week number on Mondays
        if (date.getDay() === 1 || i === 0) {
          const weekNum = getWeekNumber(date);
          label = `W${weekNum}`;
        }
      } else {
        // month
        subLabel = String(date.getDate());
        if (date.getDate() === 1 || i === 0) {
          label = fmtMonthShort.format(date);
        }
      }

      cols.push({ date, label, subLabel, isToday, x, width: zoom.columnWidth });
    }
    return cols;
  }, [rangeStart, totalDays, zoom, locale]);

  return { totalWidth, totalDays, columns };
}

function getWeekNumber(date: Date): number {
  const d = new Date(date);
  d.setHours(0, 0, 0, 0);
  d.setDate(d.getDate() + 3 - ((d.getDay() + 6) % 7));
  const week1 = new Date(d.getFullYear(), 0, 4);
  return 1 + Math.round(((d.getTime() - week1.getTime()) / 86400000 - 3 + ((week1.getDay() + 6) % 7)) / 7);
}
