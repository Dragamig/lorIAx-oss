"use client";

import { useState, useId, type ReactNode } from "react";
import { ChevronDown, ChevronRight } from "lucide-react";
import { cn } from "@/lib/utils";

interface PanelSectionProps {
  title: string;
  defaultOpen?: boolean;
  children: ReactNode;
  className?: string;
}

export function PanelSection({
  title,
  defaultOpen = true,
  children,
  className,
}: PanelSectionProps) {
  const [open, setOpen] = useState(defaultOpen);
  const titleId = `panel-section-title-${useId()}`;

  return (
    <div className={cn("flex flex-col", className)}>
      <button
        type="button"
        onClick={() => setOpen((prev) => !prev)}
        aria-expanded={open}
        className="flex items-center justify-between text-xs font-semibold uppercase tracking-wide text-muted-foreground px-2 py-1.5 w-full hover:text-foreground transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-inset"
      >
        <span id={titleId}>{title}</span>
        {open ? (
          <ChevronDown className="size-3.5" />
        ) : (
          <ChevronRight className="size-3.5" />
        )}
      </button>
      {open && (
        <div role="region" aria-labelledby={titleId}>
          {children}
        </div>
      )}
    </div>
  );
}
