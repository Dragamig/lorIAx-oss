"use client";

import { useTranslations, useFormatter } from "next-intl";
import type { GanttEvent } from "./types";

interface GanttMilestoneProps {
  event: GanttEvent;
  x: number;
  y: number;
  selected: boolean;
  onSelect: (id: string) => void;
}

export function GanttMilestone({
  event,
  x,
  y,
  selected,
  onSelect,
}: GanttMilestoneProps) {
  const t = useTranslations("gantt");
  const format = useFormatter();

  const size = 8;
  const centerY = y + 18; // centered in row (36px / 2)

  const points = [
    `${x},${centerY - size}`,
    `${x + size},${centerY}`,
    `${x},${centerY + size}`,
    `${x - size},${centerY}`,
  ].join(" ");

  const dateLabel = format.dateTime(new Date(event.startAt), {
    day: "numeric",
    month: "long",
  });

  return (
    <g
      role="img"
      aria-label={t("milestone.ariaLabel", { title: event.title, date: dateLabel })}
      className="cursor-pointer"
      onClick={() => onSelect(event.id)}
    >
      <polygon
        points={points}
        fill="#eab308"
        stroke={selected ? "#a16207" : "#ca8a04"}
        strokeWidth={selected ? 2 : 1}
      />
      <text
        x={x + size + 4}
        y={centerY}
        dominantBaseline="central"
        className="fill-muted-foreground text-[10px] pointer-events-none"
        style={{ fontSize: 10 }}
      >
        {event.title}
      </text>
    </g>
  );
}
