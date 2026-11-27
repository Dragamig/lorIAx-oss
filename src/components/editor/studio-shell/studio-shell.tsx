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
  /** Classes de la rangée centrale (par exemple pour l'empiler sur petit écran). */
  rowClassName?: string;
  mainClassName?: string;
}

export function StudioShell({
  topbar,
  rail,
  panel,
  bottombar,
  children,
  className,
  rowClassName,
  mainClassName,
}: StudioShellProps) {
  return (
    <div className={cn("flex flex-col h-full bg-background", className)}>
      {topbar}
      <div className={cn("flex flex-1 min-h-0", rowClassName)}>
        {rail}
        {panel}
        <main className={cn("flex-1 min-w-0 min-h-0", mainClassName)}>{children}</main>
      </div>
      {bottombar}
    </div>
  );
}
