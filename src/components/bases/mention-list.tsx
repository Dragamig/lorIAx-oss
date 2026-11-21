"use client";

import { Loader2 } from "lucide-react";
import { cn } from "@/lib/utils";

export interface MentionCandidate {
  id: string;
  name: string;
  avatarUrl: string | null;
}

export interface MentionListProps {
  /** Identifiant du listbox (cible de aria-controls). */
  id: string;
  items: MentionCandidate[];
  activeIndex: number;
  loading: boolean;
  labels: { list: string; loading: string; empty: string };
  onPick: (candidate: MentionCandidate) => void;
  onHover: (index: number) => void;
}

export function mentionOptionId(listId: string, index: number): string {
  return `${listId}-opt-${index}`;
}

/** Liste de suggestions de mention : listbox pilotée par le textarea (aria-activedescendant). */
export function MentionList({ id, items, activeIndex, loading, labels, onPick, onHover }: MentionListProps) {
  return (
    <div className="absolute inset-x-0 bottom-full z-20 mb-1 overflow-hidden rounded-lg border border-border bg-popover text-popover-foreground shadow-md">
      <ul id={id} role="listbox" aria-label={labels.list} className="m-0 max-h-48 list-none overflow-y-auto p-1">
        {items.map((c, i) => (
          <li
            key={c.id}
            id={mentionOptionId(id, i)}
            role="option"
            aria-selected={i === activeIndex}
            className={cn(
              "flex min-h-6 cursor-pointer items-center gap-2 rounded-md px-2 py-1 text-[0.8125rem]",
              i === activeIndex && "bg-accent text-accent-foreground",
            )}
            // Garde le focus dans le textarea.
            onMouseDown={(e) => e.preventDefault()}
            onMouseEnter={() => onHover(i)}
            onClick={() => onPick(c)}
          >
            <span
              aria-hidden="true"
              className="flex size-5 flex-none items-center justify-center overflow-hidden rounded-full bg-muted text-[0.625rem] font-semibold uppercase text-muted-foreground"
            >
              {c.avatarUrl ? (
                // eslint-disable-next-line @next/next/no-img-element
                <img src={c.avatarUrl} alt="" className="size-full object-cover" />
              ) : (
                c.name.slice(0, 1)
              )}
            </span>
            <span className="min-w-0 truncate">{c.name}</span>
          </li>
        ))}
      </ul>
      {items.length === 0 && (
        <p role="status" className="m-0 flex items-center gap-2 px-3 py-2 text-xs text-muted-foreground">
          {loading && <Loader2 className="size-3.5 animate-spin" aria-hidden="true" />}
          {loading ? labels.loading : labels.empty}
        </p>
      )}
    </div>
  );
}
