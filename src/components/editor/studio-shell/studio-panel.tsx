"use client";

import { type ReactNode } from "react";
import { cn } from "@/lib/utils";

interface StudioPanelProps {
  width?: number;
  children: ReactNode;
  className?: string;
}

export function StudioPanel({
  width = 280,
  children,
  className,
}: StudioPanelProps) {
  return (
    <div
      style={{ width }}
      className={cn(
        "bg-card border-r border-border overflow-y-auto flex flex-col flex-shrink-0",
        className
      )}
    >
      {children}
    </div>
  );
}
