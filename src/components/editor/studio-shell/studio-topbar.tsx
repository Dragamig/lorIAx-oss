"use client";

import { type ReactNode } from "react";
import { cn } from "@/lib/utils";

interface StudioTopbarProps {
  left?: ReactNode;
  center?: ReactNode;
  right?: ReactNode;
  title?: string;
  onTitleChange?: (v: string) => void;
  className?: string;
}

export function StudioTopbar({
  left,
  center,
  right,
  title,
  onTitleChange,
  className,
}: StudioTopbarProps) {
  return (
    <div
      className={cn(
        "h-11 flex items-center gap-2 px-3 bg-card border-b border-border flex-shrink-0",
        className
      )}
    >
      {left && <div className="flex items-center gap-1">{left}</div>}

      {title !== undefined && (
        <div className="min-w-0 flex-1 flex items-center">
          {onTitleChange ? (
            <input
              type="text"
              value={title}
              onChange={(e) => onTitleChange(e.target.value)}
              aria-label="Titre"
              className="bg-transparent text-sm font-medium focus:outline-none focus:ring-1 focus:ring-ring rounded px-1 min-w-0 flex-1"
            />
          ) : (
            <span className="text-sm font-medium truncate">
              {title}
            </span>
          )}
        </div>
      )}

      {center && (
        <div className="flex-1 flex items-center justify-center">{center}</div>
      )}

      {right && (
        <div className="ml-auto flex items-center gap-1">{right}</div>
      )}
    </div>
  );
}
