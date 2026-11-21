"use client";

import { type ReactNode } from "react";
import { cn } from "@/lib/utils";

interface StudioShellProps {
  topbar: ReactNode;
  rail?: ReactNode;
  panel?: ReactNode;
  /** Full-width bar rendered below the main flex row (e.g. timeline, status bar). */
  bottombar?: ReactNode;
  children: ReactNode;
  className?: string;
}

export function StudioShell({
  topbar,
  rail,
  panel,
  bottombar,
  children,
  className,
}: StudioShellProps) {
  return (
    <div className={cn("flex flex-col h-full bg-background", className)}>
      {topbar}
      <div className="flex flex-1 min-h-0">
        {rail}
        {panel}
        <main className="flex-1 min-w-0 min-h-0">{children}</main>
      </div>
      {bottombar}
    </div>
  );
}
