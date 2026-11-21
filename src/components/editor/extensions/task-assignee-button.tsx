"use client";

import { NodeViewWrapper, NodeViewContent } from "@tiptap/react";
import type { NodeViewProps } from "@tiptap/core";
import { useState, useEffect, useCallback, useRef } from "react";
import { UserPlus, Circle, Clock, CheckCircle2 } from "lucide-react";
import { Popover, PopoverContent, PopoverTrigger } from "@/components/ui/popover";
import { Input } from "@/components/ui/input";
import { Button } from "@/components/ui/button";
import { VizHashAvatar } from "@/components/ui/vizhash-avatar";

interface UserResult {
  id: string;
  name: string;
  email: string;
  avatarUrl: string | null;
}

interface AssigneePickerProps {
  assigneeName: string | null;
  onAssign: (user: UserResult) => void;
  onClear: () => void;
}

function AssigneePicker({ assigneeName, onAssign, onClear }: AssigneePickerProps) {
  const [open, setOpen] = useState(false);
  const [query, setQuery] = useState("");
  const [results, setResults] = useState<UserResult[]>([]);
  const inputRef = useRef<HTMLInputElement>(null);
  const buttonRefs = useRef<(HTMLButtonElement | null)[]>([]);

  useEffect(() => {
    if (!open || query.length < 1) {
      setResults([]);
      return;
    }
    const t = setTimeout(() => {
      fetch(`/api/users/search?q=${encodeURIComponent(query)}&limit=6`)
        .then((r) => r.json())
        .then(setResults)
        .catch(() => setResults([]));
    }, 200);
    return () => clearTimeout(t);
  }, [query, open]);

  useEffect(() => {
    buttonRefs.current = buttonRefs.current.slice(0, results.length);
  }, [results]);

  const handleSelect = useCallback(
    (user: UserResult) => {
      onAssign(user);
      setOpen(false);
      setQuery("");
    },
    [onAssign]
  );

  function handleInputKeyDown(e: React.KeyboardEvent<HTMLInputElement>) {
    if (e.key === "ArrowDown" && results.length > 0) {
      e.preventDefault();
      buttonRefs.current[0]?.focus();
    }
  }

  function handleButtonKeyDown(e: React.KeyboardEvent<HTMLButtonElement>, index: number, user: UserResult) {
    if (e.key === "ArrowDown") {
      e.preventDefault();
      buttonRefs.current[index + 1]?.focus();
    } else if (e.key === "ArrowUp") {
      e.preventDefault();
      if (index === 0) inputRef.current?.focus();
      else buttonRefs.current[index - 1]?.focus();
    } else if (e.key === "Enter") {
      e.preventDefault();
      handleSelect(user);
    }
  }

  return (
    <Popover open={open} onOpenChange={setOpen}>
      <PopoverTrigger render={
        <button
          type="button"
          className="h-6 w-6 rounded-full flex items-center justify-center hover:bg-accent transition-colors shrink-0"
          title={assigneeName ? `Assigné à ${assigneeName}` : "Assigner cette tâche"}
        >
          {assigneeName ? (
            <VizHashAvatar
              email={assigneeName ?? ""}
              size={20}
              className="rounded-full"
            />
          ) : (
            <UserPlus className="h-3.5 w-3.5 text-muted-foreground" />
          )}
        </button>
      } />
      <PopoverContent className="w-64 p-2">
        <p className="text-xs font-medium text-muted-foreground mb-2">Assigner à…</p>
        <Input
          ref={inputRef}
          placeholder="Rechercher un membre…"
          value={query}
          onChange={(e) => setQuery(e.target.value)}
          onKeyDown={handleInputKeyDown}
          className="h-7 text-sm mb-2"
          autoFocus
        />
        {results.length > 0 && (
          <ul className="space-y-0.5" role="listbox">
            {results.map((u, index) => (
              <li key={u.id} role="option" aria-selected={false}>
                <button
                  ref={(el) => { buttonRefs.current[index] = el; }}
                  type="button"
                  onClick={() => handleSelect(u)}
                  onKeyDown={(e) => handleButtonKeyDown(e, index, u)}
                  className="w-full flex items-center gap-2 px-2 py-1.5 rounded text-sm hover:bg-accent focus:bg-accent focus:outline-none transition-colors text-left"
                >
                  <VizHashAvatar email={u.email} size={20} className="rounded-full shrink-0" />
                  <span className="truncate">{u.name}</span>
                </button>
              </li>
            ))}
          </ul>
        )}
        {assigneeName && (
          <Button
            variant="ghost"
            size="sm"
            className="w-full mt-1 h-7 text-xs text-muted-foreground"
            onClick={() => { onClear(); setOpen(false); }}
          >
            Retirer l&apos;assignation
          </Button>
        )}
      </PopoverContent>
    </Popover>
  );
}

type TaskStatus = "open" | "in_progress" | "done";

const STATUS_CYCLE: Record<TaskStatus, TaskStatus> = {
  open: "in_progress",
  in_progress: "done",
  done: "open",
};

function StatusIcon({ status }: { status: TaskStatus }) {
  if (status === "done") return <CheckCircle2 className="h-4 w-4 text-green-500" />;
  if (status === "in_progress") return <Clock className="h-4 w-4 text-amber-500" />;
  return <Circle className="h-4 w-4 text-muted-foreground" />;
}

export function TaskItemView({ node, updateAttributes, editor }: NodeViewProps) {
  const rawStatus = node.attrs.status as string | undefined;
  // Rétrocompatibilité : si pas de status, dériver de checked
  const status: TaskStatus =
    rawStatus === "in_progress" || rawStatus === "done" || rawStatus === "open"
      ? rawStatus
      : node.attrs.checked
      ? "done"
      : "open";

  const _assigneeId = node.attrs.assigneeId as string | null;
  const assigneeName = node.attrs.assigneeName as string | null;

  const handleCycleStatus = useCallback(() => {
    const next = STATUS_CYCLE[status];
    updateAttributes({ status: next, checked: next === "done" });
  }, [status, updateAttributes]);

  const handleAssign = useCallback(
    (user: UserResult) => {
      updateAttributes({ assigneeId: user.id, assigneeName: user.name });
    },
    [updateAttributes]
  );

  const handleClear = useCallback(() => {
    updateAttributes({ assigneeId: null, assigneeName: null });
    const docId = (window as Window & { __loriax_docId?: string }).__loriax_docId;
    const nodeId = node.attrs.nodeId as string | undefined;
    if (docId && nodeId) {
      fetch("/api/tasks/unassign", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ documentId: docId, nodeId }),
      }).catch(() => {});
    }
  }, [updateAttributes, node.attrs.nodeId]);

  return (
    <NodeViewWrapper
      as="li"
      data-type="taskItem"
      data-checked={String(status === "done")}
      data-status={status}
      className="flex items-start gap-1"
    >
      <button
        type="button"
        contentEditable={false}
        onClick={editor.isEditable ? handleCycleStatus : undefined}
        disabled={!editor.isEditable}
        className="mt-0.5 shrink-0 flex items-center justify-center rounded focus:outline-none focus-visible:ring-2 focus-visible:ring-ring disabled:cursor-default"
        title={
          status === "open" ? "Marquer en cours" :
          status === "in_progress" ? "Marquer terminé" :
          "Rouvrir"
        }
      >
        <StatusIcon status={status} />
      </button>
      <NodeViewContent
        className={`flex-1 min-w-0${status === "done" ? " line-through opacity-60" : ""}`}
      />
      {editor.isEditable && (
        <span contentEditable={false} className="shrink-0 mt-0.5">
          <AssigneePicker
            assigneeName={assigneeName}
            onAssign={handleAssign}
            onClear={handleClear}
          />
        </span>
      )}
    </NodeViewWrapper>
  );
}
