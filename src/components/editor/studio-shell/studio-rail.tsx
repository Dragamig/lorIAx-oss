"use client";

import { type ReactNode } from "react";
import { cn } from "@/lib/utils";

interface RailItem {
  id: string;
  icon: ReactNode;
  label: string;
}

interface StudioRailProps {
  items: RailItem[];
  activeId?: string;
  onSelect: (id: string) => void;
  className?: string;
}

export function StudioRail({
  items,
  activeId,
  onSelect,
  className,
}: StudioRailProps) {
  return (
    <div
      role="toolbar"
      aria-orientation="vertical"
      className={cn(
        "w-[52px] flex flex-col items-center gap-1 py-2 bg-card border-r border-border flex-shrink-0",
        className
      )}
    >
      {items.map((item) => {
        const isActive = activeId === item.id;
        return (
          <button
            key={item.id}
            type="button"
            onClick={() => onSelect(item.id)}
            aria-label={item.label}
            title={item.label}
            aria-pressed={isActive}
            className={cn(
              "size-10 rounded-md flex items-center justify-center transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring",
              isActive
                ? "bg-accent text-accent-foreground"
                : "text-muted-foreground hover:bg-accent/50 hover:text-foreground"
            )}
          >
            {item.icon}
          </button>
        );
      })}
    </div>
  );
}
