"use client";

import { useTranslations, useFormatter } from "next-intl";
import type { GanttEvent } from "./types";

interface GanttBarProps {
  event: GanttEvent;
  x: number;
  width: number;
  y: number;
  rowHeight: number;
  selected: boolean;
  criticalPathHighlight: boolean;
  onSelect: (id: string) => void;
  onDoubleClick?: (id: string) => void;
  onMouseDown?: (e: React.MouseEvent, eventId: string, type: "move" | "resize" | "dependency") => void;
  onMouseUp?: (eventId: string) => void;
  onMouseEnter?: (eventId: string) => void;
  onMouseLeave?: () => void;
}

function hexToRgba(hex: string, alpha: number): string {
  const clean = hex.replace("#", "");
  const r = parseInt(clean.substring(0, 2), 16);
  const g = parseInt(clean.substring(2, 4), 16);
  const b = parseInt(clean.substring(4, 6), 16);
  return `rgba(${r}, ${g}, ${b}, ${alpha})`;
}

export function GanttBar({
  event,
  x,
  width,
  y,
  rowHeight,
  selected,
  criticalPathHighlight,
  onSelect,
  onDoubleClick,
  onMouseDown,
  onMouseUp,
  onMouseEnter,
  onMouseLeave,
}: GanttBarProps) {
  const t = useTranslations("gantt");
  const format = useFormatter();

  const barHeight = 20;
  const barY = y + (rowHeight - barHeight) / 2;
  const color = event.color || "#6b7280";
  const progressWidth = Math.max(0, (width * event.progress) / 100);
  const minWidth = Math.max(width, 4);

  const startDate = format.dateTime(new Date(event.startAt), { day: "numeric", month: "long" });
  const endDate = format.dateTime(new Date(event.endAt), { day: "numeric", month: "long" });
  const ariaLabel = t("bar.ariaLabel", {
    title: event.title,
    startDate,
    endDate,
    progress: event.progress,
  });

  return (
    <g
      role="img"
      aria-label={ariaLabel}
      className="cursor-grab"
      onClick={() => onSelect(event.id)}
      onDoubleClick={(e) => { e.stopPropagation(); onDoubleClick?.(event.id); }}
      onMouseDown={(e) => {
        if (e.button !== 0) return;
        e.stopPropagation();
        onMouseDown?.(e, event.id, "move");
      }}
      onMouseUp={() => onMouseUp?.(event.id)}
      onMouseEnter={() => onMouseEnter?.(event.id)}
      onMouseLeave={() => onMouseLeave?.()}
    >
      {/* Barre de fond (couleur atténuée) */}
      <rect
        x={x}
        y={barY}
        width={minWidth}
        height={barHeight}
        rx={3}
        ry={3}
        fill={hexToRgba(color, 0.3)}
        stroke={selected ? color : criticalPathHighlight ? "#f59e0b" : "transparent"}
        strokeWidth={selected || criticalPathHighlight ? 1.5 : 0}
      />

      {/* Barre de progression */}
      {progressWidth > 0 && (
        <rect
          x={x}
          y={barY}
          width={Math.min(progressWidth, minWidth)}
          height={barHeight}
          rx={3}
          ry={3}
          fill={color}
          style={{ clipPath: `inset(0 ${minWidth - Math.min(progressWidth, minWidth)}px 0 0)` }}
        />
      )}

      {/* Texte du titre (si la barre est assez large) */}
      {minWidth > 60 && (
        <text
          x={x + 6}
          y={barY + barHeight / 2}
          dominantBaseline="central"
          className="fill-foreground text-[10px] pointer-events-none"
          style={{ fontSize: 10 }}
        >
          {event.title.length > Math.floor(minWidth / 6)
            ? event.title.substring(0, Math.floor(minWidth / 6) - 1) + "…"
            : event.title}
        </text>
      )}

      {/* Poignée de redimensionnement (bord droit) */}
      <rect
        x={x + minWidth - 6}
        y={barY}
        width={6}
        height={barHeight}
        fill="transparent"
        className="cursor-col-resize"
        onMouseDown={(e) => {
          e.stopPropagation();
          onMouseDown?.(e, event.id, "resize");
        }}
      />

      {/* Cercle de création de dépendance (bord droit) */}
      <circle
        cx={x + minWidth}
        cy={barY + barHeight / 2}
        r={6}
        fill={color}
        stroke="white"
        strokeWidth={2}
        className="cursor-crosshair opacity-30 hover:opacity-100 transition-opacity"
        onMouseDown={(e) => {
          e.stopPropagation();
          onMouseDown?.(e, event.id, "dependency");
        }}
      />
    </g>
  );
}
