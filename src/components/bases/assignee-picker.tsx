"use client";

import { useEffect, useId, useRef, useState } from "react";
import { useTranslations } from "next-intl";
import { toast } from "sonner";
import { fetchJson } from "@/components/editor/extensions/database-block/api";

export interface Person {
  id: string;
  name: string;
}

interface Props {
  databaseId: string;
  value: Person | null;
  onChange(p: Person | null): void;
}

const DEBOUNCE_MS = 200;

/** Searchable assignee combobox: name search through mentionable?q=, stale requests cancelled. */
export function AssigneePicker({ databaseId, value, onChange }: Props) {
  const t = useTranslations("rowTasks");
  const listId = useId();
  const [open, setOpen] = useState(false);
  const [query, setQuery] = useState("");
  const [people, setPeople] = useState<Person[]>([]);
  const [active, setActive] = useState(0);
  const errorShown = useRef(false);

  useEffect(() => {
    if (!open) return;
    const ctl = new AbortController();
    const timer = setTimeout(async () => {
      try {
        const q = query.trim();
        const url = `/api/databases/${databaseId}/mentionable?limit=10${q ? `&q=${encodeURIComponent(q)}` : ""}`;
        const list = await fetchJson<Person[]>(url, { signal: ctl.signal });
        if (ctl.signal.aborted) return;
        setPeople(Array.isArray(list) ? list : []);
        setActive(0);
        errorShown.current = false;
      } catch {
        if (ctl.signal.aborted || errorShown.current) return;
        errorShown.current = true;
        toast.error(t("assigneesError"));
      }
    }, query ? DEBOUNCE_MS : 0);
    return () => {
      clearTimeout(timer);
      ctl.abort();
    };
  }, [open, query, databaseId, t]);

  const options: Array<Person | null> = [null, ...people];
  const optionId = (i: number) => `${listId}-${i}`;

  function pick(p: Person | null) {
    onChange(p);
    setOpen(false);
    setQuery("");
  }

  function onKeyDown(e: React.KeyboardEvent<HTMLInputElement>) {
    if (e.nativeEvent.isComposing || e.keyCode === 229) return;
    if (!open) {
      if (e.key === "ArrowDown") {
        e.preventDefault();
        setOpen(true);
      }
      return;
    }
    if (e.key === "Escape") {
      e.preventDefault();
      e.stopPropagation();
      e.nativeEvent.stopImmediatePropagation();
      setOpen(false);
      setQuery("");
    } else if (e.key === "ArrowDown") {
      e.preventDefault();
      setActive((i) => (i + 1) % options.length);
    } else if (e.key === "ArrowUp") {
      e.preventDefault();
      setActive((i) => (i - 1 + options.length) % options.length);
    } else if (e.key === "Enter") {
      e.preventDefault();
      e.stopPropagation();
      pick(options[active] ?? null);
    }
  }

  return (
    <div className="relative">
      <input
        role="combobox"
        aria-label={t("assigneeLabel")}
        aria-expanded={open}
        aria-controls={open ? listId : undefined}
        aria-activedescendant={open ? optionId(active) : undefined}
        aria-autocomplete="list"
        autoComplete="off"
        value={open ? query : (value?.name ?? "")}
        placeholder={t("assigneeNone")}
        onFocus={() => setOpen(true)}
        onBlur={() => {
          setOpen(false);
          setQuery("");
        }}
        onChange={(e) => {
          setOpen(true);
          setQuery(e.target.value);
        }}
        onKeyDown={onKeyDown}
        className="h-8 w-full rounded-lg border border-input bg-transparent px-2 text-sm text-foreground outline-none placeholder:text-muted-foreground focus-visible:border-ring focus-visible:ring-3 focus-visible:ring-ring/50 dark:bg-input/30"
      />
      {open && (
        <ul
          id={listId}
          role="listbox"
          aria-label={t("assigneeLabel")}
          className="absolute z-20 mt-1 max-h-48 w-full overflow-auto rounded-md border bg-popover p-1 text-sm text-popover-foreground shadow-md"
        >
          {options.map((p, i) => (
            <li
              key={p?.id ?? "none"}
              id={optionId(i)}
              role="option"
              aria-selected={i === active}
              onMouseDown={(e) => {
                e.preventDefault();
                pick(p);
              }}
              className={`flex min-h-6 cursor-pointer items-center truncate rounded px-2 py-1 ${i === active ? "bg-muted" : ""}`}
            >
              {p ? p.name : t("assigneeNone")}
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}
