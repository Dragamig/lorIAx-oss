"use client";

import { useId, useState } from "react";
import { AlertTriangle, Check, ChevronRight, Database, Loader2, Search, Table2, Wrench, type LucideIcon, Mail } from "lucide-react";
import { Hint } from "@/components/ui/hint";

/** Partie d'outil d'un message du SDK (type `tool-<nom>`). */
export type ToolPart = {
  type: string;
  state?: "input-streaming" | "input-available" | "output-available" | "output-error" | string;
  input?: unknown;
  output?: unknown;
  errorText?: string;
};

const TOOLS: Record<string, { label: string; icon: LucideIcon }> = {
  list_databases: { label: "Liste des bases", icon: Database },
  describe_database: { label: "Structure d'une base", icon: Database },
  query_rows: { label: "Lecture de lignes", icon: Table2 },
  find_duplicates: { label: "Recherche de doublons", icon: Search },
  list_my_mails: { label: "Mails envoyés", icon: Mail },
};

const OUTPUT_MAX_CHARS = 1500;

export function toolNameOf(part: ToolPart): string {
  return part.type.startsWith("tool-") ? part.type.slice("tool-".length) : part.type;
}

function condense(value: unknown): string {
  if (value === undefined) return "";
  let text: string;
  try {
    text = typeof value === "string" ? value : JSON.stringify(value, null, 2);
  } catch {
    text = String(value);
  }
  return text.length > OUTPUT_MAX_CHARS ? `${text.slice(0, OUTPUT_MAX_CHARS)}…` : text;
}

/** Ligne compacte et repliable d'un appel d'outil de lecture. Le détail ne s'affiche qu'au dépliage. */
export function ToolCallLine({ part }: { part: ToolPart }) {
  const [open, setOpen] = useState(false);
  const bodyId = useId();
  const name = toolNameOf(part);
  const meta = TOOLS[name] ?? { label: name.replace(/_/g, " "), icon: Wrench };
  const Icon = meta.icon;
  const failed = part.state === "output-error";
  const done = part.state === "output-available";
  const status = failed ? "échec" : done ? "terminé" : "en cours";
  const StatusIcon = failed ? AlertTriangle : done ? Check : Loader2;
  const hint = open ? "Masquer le détail de l'appel" : "Afficher le détail de l'appel";
  return (
    <div className="rounded-md border border-border bg-card text-sm" data-state={failed ? "error" : done ? "done" : "running"}>
      <Hint label={hint} className="flex w-full">
        <button
          type="button"
          aria-expanded={open}
          aria-controls={bodyId}
          aria-label={`${meta.label}, ${status}. ${hint}`}
          onClick={() => setOpen((o) => !o)}
          className="flex min-h-7 w-full items-center gap-2 rounded-md px-2 py-1 text-left text-muted-foreground hover:bg-muted focus-visible:outline-2 focus-visible:outline-ring"
        >
          <Icon className="size-4 shrink-0" aria-hidden="true" />
          <span className="min-w-0 flex-1 truncate">{meta.label}</span>
          <StatusIcon
            className={`size-4 shrink-0 ${failed ? "text-destructive" : done ? "text-emerald-600 dark:text-emerald-400" : "animate-spin"}`}
            aria-hidden="true"
          />
          <span className="shrink-0 text-xs">{status}</span>
          <ChevronRight className={`size-4 shrink-0 transition-transform ${open ? "rotate-90" : ""}`} aria-hidden="true" />
        </button>
      </Hint>
      {open ? (
        <div id={bodyId} className="space-y-1 border-t border-border px-3 py-2 text-xs text-muted-foreground">
          {part.input !== undefined ? <pre className="whitespace-pre-wrap break-words">{condense(part.input)}</pre> : null}
          {failed ? (
            <p className="text-destructive">{part.errorText ?? "L'appel a échoué"}</p>
          ) : part.output !== undefined ? (
            <pre className="whitespace-pre-wrap break-words">{condense(part.output)}</pre>
          ) : null}
        </div>
      ) : null}
    </div>
  );
}
