"use client";

import { useState } from "react";
import { ChevronRight, GripVertical } from "lucide-react";
import { useTranslations } from "next-intl";
import type { GanttEvent } from "./types";

interface GanttTaskRowProps {
  event: GanttEvent;
  depth: number;
  isExpanded: boolean;
  hasChildren: boolean;
  onToggleCollapse: (id: string) => void;
  selected: boolean;
  onSelect: (id: string) => void;
  onReorder?: (draggedId: string, targetId: string, position: "before" | "after" | "child") => void;
}

export function GanttTaskRow({
  event,
  depth,
  isExpanded,
  hasChildren,
  onToggleCollapse,
  selected,
  onSelect,
  onReorder,
}: GanttTaskRowProps) {
  const t = useTranslations("gantt");
  const paddingLeft = 8 + depth * 16;
  const [dropPosition, setDropPosition] = useState<"before" | "after" | "child" | null>(null);
  const progressLabel =
    event.progress === 100
      ? t("taskRow.done")
      : event.progress > 0
        ? `${event.progress}%`
        : null;

  return (
    <div
      role="treeitem"
      aria-expanded={hasChildren ? isExpanded : undefined}
      aria-level={depth + 1}
      aria-selected={selected}
      draggable
      onDragStart={(e) => {
        e.dataTransfer.setData("text/plain", event.id);
        e.dataTransfer.effectAllowed = "move";
      }}
      onDragOver={(e) => {
        e.preventDefault();
        e.dataTransfer.dropEffect = "move";
        const rect = e.currentTarget.getBoundingClientRect();
        const y = e.clientY - rect.top;
        const third = rect.height / 3;
        if (y < third) setDropPosition("before");
        else if (y > third * 2) setDropPosition("after");
        else setDropPosition("child");
      }}
      onDragLeave={() => setDropPosition(null)}
      onDrop={(e) => {
        e.preventDefault();
        const draggedId = e.dataTransfer.getData("text/plain");
        if (draggedId && draggedId !== event.id && dropPosition && onReorder) {
          onReorder(draggedId, event.id, dropPosition);
        }
        setDropPosition(null);
      }}
      className={`flex items-center h-9 text-sm cursor-pointer select-none border-b transition-colors ${
        dropPosition === "before"
          ? "border-t-2 border-t-primary border-b-border/50"
          : dropPosition === "after"
            ? "border-b-2 border-b-primary"
            : dropPosition === "child"
              ? "bg-primary/10 border-b-border/50"
              : selected
                ? "bg-accent/50 border-b-border/50"
                : "hover:bg-muted/50 border-b-border/50"
      }`}
      style={{ paddingLeft }}
      onClick={() => onSelect(event.id)}
    >
      {/* Grip handle */}
      <GripVertical className="h-3 w-3 text-muted-foreground/40 shrink-0 mr-0.5 cursor-grab" />

      {hasChildren ? (
        <button
          className="flex items-center justify-center h-5 w-5 rounded hover:bg-muted mr-1 shrink-0"
          onClick={(e) => {
            e.stopPropagation();
            onToggleCollapse(event.id);
          }}
          aria-label={isExpanded ? t("taskRow.collapseAria") : t("taskRow.expandAria")}
        >
          <ChevronRight
            className={`h-3.5 w-3.5 text-muted-foreground transition-transform ${
              isExpanded ? "rotate-90" : ""
            }`}
          />
        </button>
      ) : (
        <span className="w-5 mr-1 shrink-0" />
      )}

      <span
        className="h-2.5 w-2.5 rounded-full shrink-0 mr-2"
        style={{ backgroundColor: event.color || "#6b7280" }}
      />

      <span className="truncate flex-1 text-foreground">{event.title}</span>

      {progressLabel && (
        <span
          className={`ml-2 mr-2 text-[10px] font-medium px-1.5 py-0.5 rounded-full shrink-0 ${
            event.progress === 100
              ? "bg-green-100 text-green-700 dark:bg-green-900/30 dark:text-green-400"
              : "bg-muted text-muted-foreground"
          }`}
        >
          {progressLabel}
        </span>
      )}
    </div>
  );
}
