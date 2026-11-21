export interface GanttEvent {
  id: string;
  title: string;
  startAt: string; // ISO date
  endAt: string;   // ISO date
  allDay: boolean;
  color: string | null;
  progress: number; // 0-100
  parentEventId: string | null;
  dependencies: string[]; // IDs of events this depends on (incoming)
  children?: GanttEvent[];
  assigneeId?: string | null;
  assignee?: { id: string; name: string; email: string; avatarUrl: string | null } | null;
}

export type ZoomLevel = "day" | "week" | "month";

export interface ZoomConfig {
  level: ZoomLevel;
  columnWidth: number;   // px per unit
  unit: "hour" | "day" | "week";
  mainLabel: (d: Date) => string;
  subLabel: (d: Date) => string;
  step: number; // ms per column
}

const HOUR_MS = 3600000;
const DAY_MS = 86400000;
const WEEK_MS = 7 * DAY_MS;

export function createZoomConfigs(
  locale: string,
  weekPrefix: string = "W",
): Record<ZoomLevel, ZoomConfig> {
  const fmtMonthLong = new Intl.DateTimeFormat(locale, { month: "long" });
  const fmtWeekdayShort = new Intl.DateTimeFormat(locale, { weekday: "short" });

  return {
    day: {
      level: "day",
      columnWidth: 40,
      unit: "hour",
      mainLabel: (d: Date) =>
        `${fmtWeekdayShort.format(d)} ${d.getDate()} ${fmtMonthLong.format(d)}`,
      subLabel: (d: Date) => `${d.getHours()}h`,
      step: HOUR_MS,
    },
    week: {
      level: "week",
      columnWidth: 36,
      unit: "day",
      mainLabel: (d: Date) => {
        const weekNum = getWeekNumber(d);
        return `${weekPrefix}${weekNum} — ${fmtMonthLong.format(d)}`;
      },
      subLabel: (d: Date) =>
        `${fmtWeekdayShort.format(d)} ${d.getDate()}`,
      step: DAY_MS,
    },
    month: {
      level: "month",
      columnWidth: 12,
      unit: "week",
      mainLabel: (d: Date) =>
        `${fmtMonthLong.format(d)} ${d.getFullYear()}`,
      subLabel: (d: Date) => `${weekPrefix}${getWeekNumber(d)}`,
      step: WEEK_MS,
    },
  };
}

export function getWeekNumber(d: Date): number {
  const date = new Date(Date.UTC(d.getFullYear(), d.getMonth(), d.getDate()));
  date.setUTCDate(date.getUTCDate() + 4 - (date.getUTCDay() || 7));
  const yearStart = new Date(Date.UTC(date.getUTCFullYear(), 0, 1));
  return Math.ceil(((date.getTime() - yearStart.getTime()) / DAY_MS + 1) / 7);
}

export interface GanttDragState {
  type: "move" | "resize" | "dependency";
  eventId: string;
  startX: number;
  startDate?: Date;
  startEnd?: Date;
}
