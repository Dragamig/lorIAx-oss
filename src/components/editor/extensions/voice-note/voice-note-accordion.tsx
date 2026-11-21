"use client";

import { useId, useState, type ReactNode } from "react";
import { ChevronDown, ChevronRight } from "lucide-react";

interface VoiceNoteAccordionProps {
  title: string;
  /** Mention discrete alignee a droite du titre (nombre de mots, etat). */
  hint?: string;
  defaultOpen?: boolean;
  children: ReactNode;
}

/**
 * Section repliable du bloc note vocale. Repliee par defaut : le bloc doit
 * rester discret dans un document qu'on relit.
 */
export function VoiceNoteAccordion({
  title,
  hint,
  defaultOpen = false,
  children,
}: VoiceNoteAccordionProps) {
  const [open, setOpen] = useState(defaultOpen);
  const panelId = useId();

  return (
    <div className="overflow-hidden rounded-lg border border-border/60">
      <button
        type="button"
        onClick={() => setOpen((previous) => !previous)}
        aria-expanded={open}
        aria-controls={panelId}
        className="flex w-full items-center gap-2.5 bg-muted/50 px-3 py-2.5 text-left text-[13.5px] font-semibold transition-colors hover:bg-muted"
      >
        {open ? (
          <ChevronDown className="h-3.5 w-3.5 shrink-0 text-muted-foreground" aria-hidden="true" />
        ) : (
          <ChevronRight className="h-3.5 w-3.5 shrink-0 text-muted-foreground" aria-hidden="true" />
        )}
        <span className="truncate">{title}</span>
        {hint && (
          <span className="ml-auto shrink-0 text-xs font-medium tabular-nums text-muted-foreground">
            {hint}
          </span>
        )}
      </button>
      {open && (
        <div
          id={panelId}
          className="flex flex-col gap-3 border-t border-border/60 p-3.5"
        >
          {children}
        </div>
      )}
    </div>
  );
}
