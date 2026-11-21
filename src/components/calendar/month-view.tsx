"use client";

import { useMemo } from "react";
import { useTranslations, useFormatter } from "next-intl";
import type { CalendarEvent, Calendar } from "@/types";

interface MonthViewProps {
  currentDate: Date;
  events: CalendarEvent[];
  calendars: Calendar[];
  visibleCalendarIds: Set<string>;
  onEventClick: (event: CalendarEvent) => void;
  onDateClick: (date: Date) => void;
}

function getMonthGrid(date: Date): Date[][] {
  const year = date.getFullYear();
  const month = date.getMonth();
  const firstDay = new Date(year, month, 1);
  // Monday = 0, Sunday = 6
  let startOffset = firstDay.getDay() - 1;
  if (startOffset < 0) startOffset = 6;

  const start = new Date(year, month, 1 - startOffset);
  const weeks: Date[][] = [];

  for (let w = 0; w < 6; w++) {
    const week: Date[] = [];
    for (let d = 0; d < 7; d++) {
      const day = new Date(start);
      day.setDate(start.getDate() + w * 7 + d);
      week.push(day);
    }
    weeks.push(week);
  }

  // Remove last week if entirely in next month
  const lastWeek = weeks[weeks.length - 1];
  if (lastWeek[0].getMonth() !== month) weeks.pop();

  return weeks;
}

function isSameDay(a: Date, b: Date): boolean {
  return (
    a.getFullYear() === b.getFullYear() &&
    a.getMonth() === b.getMonth() &&
    a.getDate() === b.getDate()
  );
}

function isToday(date: Date): boolean {
  return isSameDay(date, new Date());
}

// Reference week (a Monday-to-Sunday week) for computing weekday labels
// Use a fixed reference: week of Mon 2 – Sun 8 Jan 2023
const REF_WEEK_MONDAY = new Date(2023, 0, 2); // Monday

export default function MonthView({
  currentDate,
  events,
  calendars,
  visibleCalendarIds,
  onEventClick,
  onDateClick,
}: MonthViewProps) {
  const t = useTranslations("calendar");
  const format = useFormatter();
  const weeks = getMonthGrid(currentDate);
  const currentMonth = currentDate.getMonth();

  // Compute locale-aware weekday labels (Mon–Sun order)
  const dayNames = useMemo(() => {
    return Array.from({ length: 7 }, (_, i) => {
      const d = new Date(REF_WEEK_MONDAY);
      d.setDate(REF_WEEK_MONDAY.getDate() + i);
      return format.dateTime(d, { weekday: "short" });
    });
  }, [format]);

  const calColorMap = new Map(calendars.map((c) => [c.id, c.color]));

  const getEventsForDay = (day: Date) => {
    return events.filter((e) => {
      if (!visibleCalendarIds.has(e.calendarId)) return false;
      const start = new Date(e.startAt);
      const end = new Date(e.endAt);
      return (
        isSameDay(start, day) ||
        (day >= start && day <= end)
      );
    });
  };

  return (
    <div className="flex flex-col flex-1 overflow-hidden">
      {/* Day headers */}
      <div className="grid grid-cols-7 border-b border-border">
        {dayNames.map((name) => (
          <div
            key={name}
            className="text-center text-xs font-medium text-muted-foreground py-2"
          >
            {name}
          </div>
        ))}
      </div>

      {/* Grid */}
      <div className="grid grid-rows-auto flex-1">
        {weeks.map((week, wi) => (
          <div key={wi} className="grid grid-cols-7 border-b border-border last:border-b-0 min-h-[100px]">
            {week.map((day, di) => {
              const dayEvents = getEventsForDay(day);
              const isCurrentMonth = day.getMonth() === currentMonth;
              const maxShow = 3;
              const overflow = dayEvents.length - maxShow;

              return (
                <div
                  key={di}
                  className={`border-r border-border last:border-r-0 p-1 cursor-pointer hover:bg-accent/30 transition-colors ${
                    isCurrentMonth ? "" : "bg-muted/30"
                  }`}
                  onClick={() => onDateClick(day)}
                >
                  <div
                    className={`text-xs font-medium mb-0.5 w-6 h-6 flex items-center justify-center rounded-full ${
                      isToday(day)
                        ? "bg-primary text-primary-foreground"
                        : isCurrentMonth
                        ? "text-foreground"
                        : "text-muted-foreground"
                    }`}
                  >
                    {day.getDate()}
                  </div>
                  <div className="space-y-0.5">
                    {dayEvents.slice(0, maxShow).map((event, ei) => (
                      <button
                        key={`${event.id}-${ei}`}
                        onClick={(e) => {
                          e.stopPropagation();
                          onEventClick(event);
                        }}
                        className="w-full text-left text-[11px] leading-tight px-1 py-0.5 rounded truncate hover:opacity-80"
                        style={{
                          backgroundColor: (event.color || calColorMap.get(event.calendarId) || "#3b82f6") + "20",
                          color: event.color || calColorMap.get(event.calendarId) || "#3b82f6",
                          borderLeft: `2px solid ${event.color || calColorMap.get(event.calendarId) || "#3b82f6"}`,
                        }}
                      >
                        {event.title}
                      </button>
                    ))}
                    {overflow > 0 && (
                      <span className="text-[10px] text-muted-foreground px-1">
                        {t("monthView.moreEvents", { count: overflow })}
                      </span>
                    )}
                  </div>
                </div>
              );
            })}
          </div>
        ))}
      </div>
    </div>
  );
}
