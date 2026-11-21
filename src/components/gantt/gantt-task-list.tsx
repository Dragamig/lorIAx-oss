"use client";

import { useState, useRef, useCallback } from "react";
import { Plus } from "lucide-react";
import { useTranslations } from "next-intl";
import type { FlatEvent } from "./gantt-utils";
import type { GanttEvent } from "./types";
import { GanttTaskRow } from "./gantt-task-row";
import { GanttContextMenu } from "./gantt-context-menu";

interface GanttTaskListProps {
  flatEvents: FlatEvent[];
  allEvents: GanttEvent[];
  collapsed: Set<string>;
  onToggleCollapse: (id: string) => void;
  selectedId: string | null;
  onSelect: (id: string) => void;
  onCreateTask: (title: string, parentEventId?: string) => Promise<void>;
  onDeleteTask: (id: string) => Promise<void>;
  onAddDependency: (sourceId: string, targetId: string) => Promise<void>;
  onRemoveDependency: (sourceId: string, targetId: string) => Promise<void>;
  onDoubleClick?: (id: string) => void;
  onReorder?: (draggedId: string, targetId: string, position: "before" | "after" | "child") => void;
}

export function GanttTaskList({
  flatEvents,
  allEvents,
  collapsed,
  onToggleCollapse,
  selectedId,
  onSelect,
  onCreateTask,
  onDeleteTask,
  onAddDependency,
  onRemoveDependency,
  onDoubleClick,
  onReorder,
}: GanttTaskListProps) {
  const t = useTranslations("gantt");
  const [newTaskTitle, setNewTaskTitle] = useState("");
  const [showInput, setShowInput] = useState(false);
  const [contextMenu, setContextMenu] = useState<{
    x: number;
    y: number;
    eventId: string;
  } | null>(null);
  const inputRef = useRef<HTMLInputElement>(null);

  const handleAddTask = useCallback(async () => {
    const title = newTaskTitle.trim();
    if (!title) return;
    await onCreateTask(title);
    setNewTaskTitle("");
    setShowInput(false);
  }, [newTaskTitle, onCreateTask]);

  const handleContextMenu = useCallback(
    (e: React.MouseEvent, eventId: string) => {
      e.preventDefault();
      setContextMenu({ x: e.clientX, y: e.clientY, eventId });
    },
    [],
  );

  const contextEvent = contextMenu
    ? allEvents.find((e) => e.id === contextMenu.eventId)
    : null;

  return (
    <div className="w-60 shrink-0 border-r border-border overflow-y-auto bg-card flex flex-col">
      <div className="h-[52px] flex items-center px-3 border-b border-border bg-muted/30">
        <span className="text-xs font-medium text-muted-foreground uppercase tracking-wider">
          {t("taskList.heading")}
        </span>
      </div>
      <div role="tree" aria-label={t("taskList.ariaLabel")} className="flex-1">
        {flatEvents.map(({ event, depth, hasChildren }) => (
          <div
            key={event.id}
            onContextMenu={(e) => handleContextMenu(e, event.id)}
            onDoubleClick={() => onDoubleClick?.(event.id)}
          >
            <GanttTaskRow
              event={event}
              depth={depth}
              isExpanded={!collapsed.has(event.id)}
              hasChildren={hasChildren}
              onToggleCollapse={onToggleCollapse}
              selected={selectedId === event.id}
              onSelect={onSelect}
              onReorder={onReorder}
            />
          </div>
        ))}
      </div>

      {/* Bouton + Tâche */}
      <div className="border-t border-border p-2">
        {showInput ? (
          <form
            onSubmit={(e) => {
              e.preventDefault();
              handleAddTask();
            }}
            className="flex items-center gap-1"
          >
            <input
              ref={inputRef}
              type="text"
              value={newTaskTitle}
              onChange={(e) => setNewTaskTitle(e.target.value)}
              onBlur={() => {
                if (!newTaskTitle.trim()) setShowInput(false);
              }}
              onKeyDown={(e) => {
                if (e.key === "Escape") {
                  setNewTaskTitle("");
                  setShowInput(false);
                }
              }}
              placeholder={t("taskList.taskNamePlaceholder")}
              className="flex-1 text-xs px-2 py-1 rounded border border-border bg-background focus:outline-none focus:ring-1 focus:ring-primary"
              autoFocus
            />
          </form>
        ) : (
          <button
            onClick={() => setShowInput(true)}
            className="flex items-center gap-1.5 w-full px-2 py-1 text-xs text-muted-foreground hover:text-foreground hover:bg-muted rounded transition-colors"
          >
            <Plus className="h-3.5 w-3.5" />
            {t("taskList.addTask")}
          </button>
        )}
      </div>

      {/* Context menu */}
      {contextMenu && contextEvent && (
        <GanttContextMenu
          x={contextMenu.x}
          y={contextMenu.y}
          eventId={contextMenu.eventId}
          event={contextEvent}
          allEvents={allEvents}
          onClose={() => setContextMenu(null)}
          onAddSubtask={async () => {
            try {
              const title = t("subtaskTitlePrefix", { parentTitle: contextEvent.title });
              await onCreateTask(title, contextMenu.eventId);
            } catch (error) {
              // Failed to create subtask, error logged upstream
            }
          }}
          onAddDependency={onAddDependency}
          onRemoveDependency={onRemoveDependency}
          onDelete={() => onDeleteTask(contextMenu.eventId)}
        />
      )}
    </div>
  );
}
