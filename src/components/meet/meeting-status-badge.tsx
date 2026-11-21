"use client";

import { useTranslations } from "next-intl";
import { cn } from "@/lib/utils";

type MeetStatus =
  | "scheduled"
  | "active"
  | "ended"
  | "transcribing"
  | "summarizing"
  | "mapping"
  | "completed"
  | "failed";

const STATUS_CLASSES: Record<MeetStatus, string> = {
  scheduled: "bg-blue-100 text-blue-700 dark:bg-blue-900/30 dark:text-blue-400",
  active: "bg-green-100 text-green-700 dark:bg-green-900/30 dark:text-green-400",
  ended: "bg-gray-100 text-gray-600 dark:bg-gray-800 dark:text-gray-400",
  transcribing: "bg-amber-100 text-amber-700 dark:bg-amber-900/30 dark:text-amber-400",
  summarizing: "bg-amber-100 text-amber-700 dark:bg-amber-900/30 dark:text-amber-400",
  mapping: "bg-amber-100 text-amber-700 dark:bg-amber-900/30 dark:text-amber-400",
  completed: "bg-green-100 text-green-700 dark:bg-green-900/30 dark:text-green-400",
  failed: "bg-red-100 text-red-700 dark:bg-red-900/30 dark:text-red-400",
};

const ANIMATED_STATUSES: MeetStatus[] = ["active", "transcribing", "summarizing", "mapping"];

export function MeetingStatusBadge({ status }: { status: string }) {
  const t = useTranslations("meet.statuses");
  const validStatus: MeetStatus = (status in STATUS_CLASSES ? status : "scheduled") as MeetStatus;
  const className = STATUS_CLASSES[validStatus];

  return (
    <span
      className={cn(
        "inline-flex items-center gap-1 rounded-full px-2 py-0.5 text-xs font-medium",
        className
      )}
    >
      {ANIMATED_STATUSES.includes(validStatus) && (
        <span className="relative flex h-2 w-2">
          <span className="absolute inline-flex h-full w-full animate-ping rounded-full bg-current opacity-75" />
          <span className="relative inline-flex h-2 w-2 rounded-full bg-current" />
        </span>
      )}
      {t(validStatus)}
    </span>
  );
}
