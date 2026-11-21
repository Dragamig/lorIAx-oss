"use client";

import { useState, useMemo, useCallback, useEffect } from "react";
import dynamic from "next/dynamic";
import {
  Calendar as CalIcon,
  ChevronLeft,
  ChevronRight,
  Plus,
  Loader2,
  BarChart3,
  Video,
} from "lucide-react";
import { useTranslations, useFormatter } from "next-intl";
import { useSearchParams } from "next/navigation";

const GanttView = dynamic(
  () => import("@/components/gantt/gantt-view").then((m) => ({ default: m.GanttView })),
  {
    ssr: false,
    loading: () => (
      <div className="flex items-center justify-center h-[400px]">
        <Loader2 className="h-5 w-5 animate-spin" />
      </div>
    ),
  }
);
import { Button } from "@/components/ui/button";
import { toast } from "sonner";
import { useIsMobile } from "@/hooks/use-mobile";
import { useCalendars, useCalendarEvents } from "@/hooks/use-calendar";
import CalendarSidebarPanel from "@/components/calendar/calendar-sidebar-panel";
import EventFormDialog, {
  type EventFormData,
} from "@/components/calendar/event-form-dialog";
import MonthView from "@/components/calendar/month-view";
import WeekView from "@/components/calendar/week-view";
import DayView from "@/components/calendar/day-view";
import AgendaView from "@/components/calendar/agenda-view";
import type { CalendarEvent } from "@/types";

type ViewType = "month" | "week" | "day" | "agenda" | "gantt";

function getDateRange(date: Date, view: ViewType): { start: Date; end: Date } {
  const year = date.getFullYear();
  const month = date.getMonth();

  switch (view) {
    case "month":
      return {
        start: new Date(year, month - 1, 1),
        end: new Date(year, month + 2, 0),
      };
    case "week": {
      const day = date.getDay();
      const diff = day === 0 ? -6 : 1 - day;
      const weekStart = new Date(date);
      weekStart.setDate(date.getDate() + diff);
      weekStart.setHours(0, 0, 0, 0);
      const weekEnd = new Date(weekStart);
      weekEnd.setDate(weekStart.getDate() + 7);
      return { start: weekStart, end: weekEnd };
    }
    case "day":
      return {
        start: new Date(year, month, date.getDate()),
        end: new Date(year, month, date.getDate() + 1),
      };
    case "agenda":
      return {
        start: new Date(year, month, date.getDate()),
        end: new Date(year, month, date.getDate() + 30),
      };
    case "gantt":
      return {
        start: new Date(year, month, 1),
        end: new Date(year, month + 3, 0),
      };
    default:
      return { start: new Date(year, month, 1), end: new Date(year, month + 1, 0) };
  }
}

function navigateDate(date: Date, view: ViewType, direction: number): Date {
  const d = new Date(date);
  switch (view) {
    case "month":
      d.setMonth(d.getMonth() + direction);
      break;
    case "week":
      d.setDate(d.getDate() + 7 * direction);
      break;
    case "day":
    case "agenda":
      d.setDate(d.getDate() + direction);
      break;
    case "gantt":
      d.setMonth(d.getMonth() + direction);
      break;
  }
  return d;
}

export default function CalendarPage() {
  const t = useTranslations("calendar");
  const format = useFormatter();
  const isMobile = useIsMobile();
  const searchParams = useSearchParams();
  const [view, setView] = useState<ViewType>("month");
  const [currentDate, setCurrentDate] = useState(new Date());

  // Deep-link de vue : `/calendar?view=week` ouvre directement la vue demandée
  // (utilisé notamment par le tour d'onboarding pour pointer la vue semaine).
  useEffect(() => {
    const requested = searchParams.get("view");
    const allowed: ViewType[] = ["month", "week", "day", "agenda", "gantt"];
    if (requested && (allowed as string[]).includes(requested)) {
      setView(requested as ViewType);
    }
  }, [searchParams]);

  // Sur mobile : forcer la vue Agenda au premier rendu.
  // La forme fonctionnelle lit la vue courante sans en dépendre, pour ne pas
  // re-forcer Agenda chaque fois que l'utilisateur change de vue sur mobile.
  useEffect(() => {
    if (isMobile) {
      setView((v) => (v !== "agenda" && v !== "day" ? "agenda" : v));
    }
  }, [isMobile]);
  const [visibleCalendarIds, setVisibleCalendarIds] = useState<Set<string>>(new Set());
  const [eventDialogOpen, setEventDialogOpen] = useState(false);
  const [selectedEvent, setSelectedEvent] = useState<CalendarEvent | null>(null);
  const [selectedDate, setSelectedDate] = useState<Date | null>(null);
  const [_showCreateCalendar, _setShowCreateCalendar] = useState(false);
  const [meetingMode, setMeetingMode] = useState(false);

  const { calendars, loading: _calendarsLoading, refetch: refetchCalendars } = useCalendars();

  // Initialize visible calendars when loaded.
  // La forme fonctionnelle lit l'état courant sans en dépendre : on n'initialise
  // que tant qu'aucun calendrier n'est encore sélectionné.
  useEffect(() => {
    if (calendars.length > 0) {
      setVisibleCalendarIds((prev) =>
        prev.size === 0 ? new Set(calendars.map((c) => c.id)) : prev
      );
    }
  }, [calendars]);

  const dateRange = useMemo(() => getDateRange(currentDate, view), [currentDate, view]);

  const visibleIds = useMemo(() => [...visibleCalendarIds], [visibleCalendarIds]);
  const { events, loading: eventsLoading, refetch: refetchEvents } = useCalendarEvents(
    visibleIds,
    dateRange.start,
    dateRange.end
  );

  // Build title string from currentDate + view using format.dateTime (locale-aware)
  const title = useMemo(() => {
    switch (view) {
      case "month":
        return format.dateTime(currentDate, { month: "long", year: "numeric" });
      case "week": {
        const start = new Date(currentDate);
        const day = start.getDay();
        const diff = day === 0 ? -6 : 1 - day;
        start.setDate(start.getDate() + diff);
        const end = new Date(start);
        end.setDate(start.getDate() + 6);
        if (start.getMonth() === end.getMonth()) {
          return t("titleFormat.weekSameMonth", {
            startDay: start.getDate(),
            endDay: end.getDate(),
            month: format.dateTime(start, { month: "long" }),
            year: start.getFullYear(),
          });
        }
        return t("titleFormat.weekDiffMonth", {
          startDay: start.getDate(),
          startMonth: format.dateTime(start, { month: "long" }),
          endDay: end.getDate(),
          endMonth: format.dateTime(end, { month: "long" }),
          year: end.getFullYear(),
        });
      }
      case "day":
        return format.dateTime(currentDate, { weekday: "long", day: "numeric", month: "long", year: "numeric" });
      case "agenda":
        return t("titleFormat.agendaFrom", {
          day: currentDate.getDate(),
          month: format.dateTime(currentDate, { month: "long" }),
        });
      case "gantt":
        return t("titleFormat.ganttTitle", {
          monthYear: format.dateTime(currentDate, { month: "long", year: "numeric" }),
        });
      default:
        return "";
    }
  }, [currentDate, view, t, format]);

  const toggleCalendarVisibility = useCallback((id: string) => {
    setVisibleCalendarIds((prev) => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });
  }, []);

  const handleEventClick = useCallback((event: CalendarEvent) => {
    setSelectedEvent(event);
    setEventDialogOpen(true);
  }, []);

  const handleDateClick = useCallback((date: Date) => {
    setSelectedDate(date);
    setSelectedEvent(null);
    setEventDialogOpen(true);
  }, []);

  const handleSaveEvent = useCallback(
    async (data: EventFormData) => {
      if (data.isMeeting && !selectedEvent) {
        // Create meeting via meet API
        const res = await fetch("/api/meet/rooms", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({
            title: data.title,
            spaceId: data.meetingSpaceId,
            mode: "scheduled",
            scheduledAt: new Date(data.startAt).toISOString(),
            calendarId: data.calendarId,
          }),
        });

        if (!res.ok) {
          const err = await res.json().catch(() => ({}));
          throw new Error(err.error || t("toasts.meetingError"));
        }

        toast.success(t("toasts.meetingScheduled"));
        refetchEvents();
        return;
      }

      // Regular event creation (existing code)
      const payload = {
        title: data.title,
        description: data.description || undefined,
        location: data.location || undefined,
        startAt: new Date(data.startAt).toISOString(),
        endAt: new Date(data.endAt).toISOString(),
        allDay: data.allDay,
        recurrenceRule: data.recurrenceRule || undefined,
        visibility: data.visibility,
        status: data.status,
        color: data.color || undefined,
      };

      const url = selectedEvent
        ? `/api/events/${selectedEvent.id}`
        : `/api/calendars/${data.calendarId}/events`;
      const method = selectedEvent ? "PATCH" : "POST";

      const res = await fetch(url, {
        method,
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(payload),
      });

      if (!res.ok) {
        const err = await res.json().catch(() => ({}));
        throw new Error(err.error || t("toasts.eventSaveError"));
      }

      toast.success(selectedEvent ? t("toasts.eventUpdated") : t("toasts.eventCreated"));
      refetchEvents();
    },
    [selectedEvent, refetchEvents, t]
  );

  const handleCreateCalendar = useCallback(async () => {
    const name = prompt(t("sidebar.createPrompt"));
    if (!name?.trim()) return;

    const res = await fetch("/api/calendars", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ name: name.trim() }),
    });

    if (!res.ok) {
      toast.error(t("toasts.calendarError"));
      return;
    }

    toast.success(t("toasts.calendarCreated"));
    refetchCalendars();
  }, [refetchCalendars, t]);

  return (
    <div className="flex flex-col h-full">
      {/* Header */}
      <div className="flex items-center gap-3 px-4 py-2 border-b border-border bg-card">
        <CalIcon className="h-5 w-5 text-primary" />
        <h1 className="text-lg font-semibold">{t("title")}</h1>

        <div className="flex-1" />

        {/* Navigation */}
        <Button
          variant="ghost"
          size="icon"
          className="h-7 w-7"
          onClick={() => setCurrentDate((d) => navigateDate(d, view, -1))}
        >
          <ChevronLeft className="h-4 w-4" />
        </Button>
        <Button
          variant="ghost"
          size="sm"
          onClick={() => setCurrentDate(new Date())}
          className="text-xs"
        >
          {t("today")}
        </Button>
        <Button
          variant="ghost"
          size="icon"
          className="h-7 w-7"
          onClick={() => setCurrentDate((d) => navigateDate(d, view, 1))}
        >
          <ChevronRight className="h-4 w-4" />
        </Button>

        <span className="text-sm font-medium min-w-[180px] text-center">
          {title}
        </span>

        {/* View selector */}
        <div className="flex border border-border rounded-md overflow-hidden">
          {(isMobile ? ["agenda", "day"] as const : ["month", "week", "day", "agenda"] as const).map((v) => (
            <button
              key={v}
              onClick={() => setView(v)}
              className={`px-3 py-1 text-xs transition-colors ${
                view === v
                  ? "bg-primary text-primary-foreground"
                  : "hover:bg-accent"
              }`}
            >
              {t(`views.${v}`)}
            </button>
          ))}
          {!isMobile && (
            <button
              onClick={() => setView("gantt")}
              className={`px-3 py-1 text-xs transition-colors flex items-center gap-1 ${
                view === "gantt"
                  ? "bg-primary text-primary-foreground"
                  : "hover:bg-accent"
              }`}
            >
              <BarChart3 className="h-3 w-3" />
              {t("views.gantt")}
            </button>
          )}
        </div>

        {/* New event */}
        <Button
          data-tour="calendar-create-event"
          size="sm"
          onClick={() => {
            setSelectedEvent(null);
            setSelectedDate(null);
            setEventDialogOpen(true);
          }}
        >
          <Plus className="h-4 w-4 md:mr-1" />
          <span className="hidden md:inline">{t("newEvent")}</span>
        </Button>
        <Button
          size="sm"
          variant="outline"
          onClick={() => {
            setMeetingMode(true);
            setSelectedEvent(null);
            setSelectedDate(null);
            setEventDialogOpen(true);
          }}
        >
          <Video className="h-4 w-4 md:mr-1" />
          <span className="hidden md:inline">{t("newMeeting")}</span>
        </Button>
      </div>

      {/* Body */}
      <div className="flex flex-1 overflow-hidden">
        {/* Calendar list sidebar — masquée sur mobile */}
        {!isMobile && (
          <CalendarSidebarPanel
            calendars={calendars}
            visibleIds={visibleCalendarIds}
            onToggleVisibility={toggleCalendarVisibility}
            onCreateCalendar={handleCreateCalendar}
          />
        )}

        {/* Main calendar area */}
        <div className="flex-1 flex flex-col overflow-hidden">
          {eventsLoading && (
            <div className="flex items-center justify-center py-2">
              <Loader2 className="h-4 w-4 animate-spin text-muted-foreground" />
            </div>
          )}

          {view === "month" && (
            <MonthView
              currentDate={currentDate}
              events={events}
              calendars={calendars}
              visibleCalendarIds={visibleCalendarIds}
              onEventClick={handleEventClick}
              onDateClick={handleDateClick}
            />
          )}
          {view === "week" && (
            <WeekView
              currentDate={currentDate}
              events={events}
              calendars={calendars}
              visibleCalendarIds={visibleCalendarIds}
              onEventClick={handleEventClick}
              onDateClick={handleDateClick}
            />
          )}
          {view === "day" && (
            <DayView
              currentDate={currentDate}
              events={events}
              calendars={calendars}
              visibleCalendarIds={visibleCalendarIds}
              onEventClick={handleEventClick}
              onDateClick={handleDateClick}
            />
          )}
          {view === "agenda" && (
            <AgendaView
              currentDate={currentDate}
              events={events}
              calendars={calendars}
              visibleCalendarIds={visibleCalendarIds}
              onEventClick={handleEventClick}
            />
          )}
          {view === "gantt" && (
            <GanttView calendarId={visibleIds[0] || ""} />
          )}
        </div>
      </div>

      {/* Event form dialog */}
      <EventFormDialog
        open={eventDialogOpen}
        onClose={() => {
          setEventDialogOpen(false);
          setSelectedEvent(null);
          setSelectedDate(null);
          setMeetingMode(false);
        }}
        onSave={handleSaveEvent}
        calendars={calendars}
        initialDate={selectedDate || undefined}
        event={selectedEvent}
        defaultMeeting={meetingMode}
      />
    </div>
  );
}
