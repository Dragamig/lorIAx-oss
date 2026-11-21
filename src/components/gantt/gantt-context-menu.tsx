"use client";

import { useEffect, useRef, useState } from "react";
import { Link2, Link2Off, FolderPlus, Trash2, ChevronRight } from "lucide-react";
import { useTranslations } from "next-intl";
import type { GanttEvent } from "./types";

interface GanttContextMenuProps {
  x: number;
  y: number;
  eventId: string;
  event: GanttEvent;
  allEvents: GanttEvent[];
  onClose: () => void;
  onAddSubtask: () => void;
  onAddDependency: (sourceId: string, targetId: string) => Promise<void>;
  onRemoveDependency: (sourceId: string, targetId: string) => Promise<void>;
  onDelete: () => void;
}

export function GanttContextMenu({
  x,
  y,
  eventId,
  event,
  allEvents,
  onClose,
  onAddSubtask,
  onAddDependency,
  onRemoveDependency,
  onDelete,
}: GanttContextMenuProps) {
  const t = useTranslations("gantt");
  const menuRef = useRef<HTMLDivElement>(null);
  const [showDepPicker, setShowDepPicker] = useState(false);
  const [showRemoveDep, setShowRemoveDep] = useState(false);

  useEffect(() => {
    function handleClickOutside(e: MouseEvent) {
      if (menuRef.current && !menuRef.current.contains(e.target as Node)) onClose();
    }
    function handleKeyDown(e: KeyboardEvent) {
      if (e.key === "Escape") onClose();
    }
    document.addEventListener("mousedown", handleClickOutside);
    document.addEventListener("keydown", handleKeyDown);
    return () => {
      document.removeEventListener("mousedown", handleClickOutside);
      document.removeEventListener("keydown", handleKeyDown);
    };
  }, [onClose]);

  // Tasks available as dependency sources (not self, not already a dependency)
  const existingDeps = new Set(event.dependencies ?? []);
  const availableTasks = allEvents.filter(
    (e) => e.id !== eventId && !existingDeps.has(e.id),
  );
  const currentDeps = allEvents.filter((e) => existingDeps.has(e.id));

  // Clamp menu position to viewport
  const menuStyle: React.CSSProperties = {
    left: Math.min(x, window.innerWidth - 240),
    top: Math.min(y, window.innerHeight - 300),
  };

  return (
    <div
      ref={menuRef}
      className="fixed z-50 bg-popover border border-border rounded-lg shadow-xl py-1 min-w-[200px]"
      style={menuStyle}
    >
      {/* Add dependency submenu */}
      <div className="relative">
        <button
          className="w-full flex items-center gap-2 px-3 py-1.5 text-xs hover:bg-accent transition-colors text-left"
          onClick={() => {
            setShowDepPicker(!showDepPicker);
            setShowRemoveDep(false);
          }}
        >
          <Link2 className="h-3.5 w-3.5 text-muted-foreground" />
          <span className="flex-1">{t("contextMenu.linkDependency")}</span>
          <ChevronRight className={`h-3 w-3 text-muted-foreground transition-transform ${showDepPicker ? "rotate-90" : ""}`} />
        </button>
        {showDepPicker && (
          <div className="border-t border-border/50 max-h-40 overflow-y-auto">
            {availableTasks.length === 0 ? (
              <div className="px-3 py-2 text-[10px] text-muted-foreground italic">
                {t("contextMenu.noTasksAvailable")}
              </div>
            ) : (
              availableTasks.map((task) => (
                <button
                  key={task.id}
                  className="w-full flex items-center gap-2 pl-8 pr-3 py-1.5 text-xs hover:bg-accent transition-colors text-left"
                  onClick={async () => {
                    await onAddDependency(task.id, eventId);
                    onClose();
                  }}
                >
                  <span
                    className="h-2 w-2 rounded-full shrink-0"
                    style={{ backgroundColor: task.color || "#6b7280" }}
                  />
                  <span className="truncate">{task.title}</span>
                </button>
              ))
            )}
          </div>
        )}
      </div>

      {/* Remove dependency submenu */}
      {currentDeps.length > 0 && (
        <div className="relative">
          <button
            className="w-full flex items-center gap-2 px-3 py-1.5 text-xs hover:bg-accent transition-colors text-left"
            onClick={() => {
              setShowRemoveDep(!showRemoveDep);
              setShowDepPicker(false);
            }}
          >
            <Link2Off className="h-3.5 w-3.5 text-muted-foreground" />
            <span className="flex-1">{t("contextMenu.removeDependency")}</span>
            <ChevronRight className={`h-3 w-3 text-muted-foreground transition-transform ${showRemoveDep ? "rotate-90" : ""}`} />
          </button>
          {showRemoveDep && (
            <div className="border-t border-border/50 max-h-40 overflow-y-auto">
              {currentDeps.map((dep) => (
                <button
                  key={dep.id}
                  className="w-full flex items-center gap-2 pl-8 pr-3 py-1.5 text-xs hover:bg-accent transition-colors text-left text-orange-600 dark:text-orange-400"
                  onClick={async () => {
                    await onRemoveDependency(dep.id, eventId);
                    onClose();
                  }}
                >
                  <span
                    className="h-2 w-2 rounded-full shrink-0"
                    style={{ backgroundColor: dep.color || "#6b7280" }}
                  />
                  <span className="truncate">{dep.title}</span>
                </button>
              ))}
            </div>
          )}
        </div>
      )}

      {/* Add subtask */}
      <button
        className="w-full flex items-center gap-2 px-3 py-1.5 text-xs hover:bg-accent transition-colors text-left"
        onClick={() => {
          onAddSubtask();
          onClose();
        }}
      >
        <FolderPlus className="h-3.5 w-3.5 text-muted-foreground" />
        {t("contextMenu.addSubtask")}
      </button>

      <div className="border-t border-border my-1" />

      {/* Delete */}
      <button
        className="w-full flex items-center gap-2 px-3 py-1.5 text-xs hover:bg-accent transition-colors text-left text-destructive"
        onClick={() => {
          onDelete();
          onClose();
        }}
      >
        <Trash2 className="h-3.5 w-3.5" />
        {t("contextMenu.delete")}
      </button>
    </div>
  );
}
