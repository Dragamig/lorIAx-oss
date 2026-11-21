"use client";

import { Zap, BarChart3 } from "lucide-react";
import { useTranslations } from "next-intl";
import type { ZoomLevel } from "./types";

interface GanttToolbarProps {
  zoom: ZoomLevel;
  onZoomChange: (zoom: ZoomLevel) => void;
  criticalPathActive: boolean;
  onToggleCriticalPath: () => void;
}

const ZOOM_LEVELS: ZoomLevel[] = ["day", "week", "month"];

export function GanttToolbar({
  zoom,
  onZoomChange,
  criticalPathActive,
  onToggleCriticalPath,
}: GanttToolbarProps) {
  const t = useTranslations("gantt");

  return (
    <div className="flex items-center gap-2 px-3 py-2 border-b border-border bg-muted/30">
      <div className="flex items-center gap-1 mr-2">
        <BarChart3 className="h-4 w-4 text-muted-foreground" />
        <span className="text-sm font-medium">Gantt</span>
      </div>

      <div className="flex items-center rounded-md border border-border bg-background">
        {ZOOM_LEVELS.map((level) => (
          <button
            key={level}
            onClick={() => onZoomChange(level)}
            className={`px-3 py-1 text-xs font-medium transition-colors ${
              zoom === level
                ? "bg-primary text-primary-foreground"
                : "text-muted-foreground hover:text-foreground hover:bg-muted"
            } ${level === "day" ? "rounded-l-md" : ""} ${level === "month" ? "rounded-r-md" : ""}`}
            aria-pressed={zoom === level}
          >
            {t(`zoomLevels.${level}`)}
          </button>
        ))}
      </div>

      <button
        onClick={onToggleCriticalPath}
        className={`flex items-center gap-1.5 px-2.5 py-1 text-xs font-medium rounded-md border transition-colors ${
          criticalPathActive
            ? "border-amber-500 bg-amber-500/10 text-amber-600"
            : "border-border text-muted-foreground hover:text-foreground hover:bg-muted"
        }`}
        aria-pressed={criticalPathActive}
        title={t("toolbar.criticalPath")}
      >
        <Zap className="h-3.5 w-3.5" />
        <span className="hidden sm:inline">{t("toolbar.criticalPath")}</span>
      </button>
    </div>
  );
}
