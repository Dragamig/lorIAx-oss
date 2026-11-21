"use client";

import { useRef } from "react";
import { CrmActionButton } from "./crm-states";

interface ActivationUndoToastProps {
  message: string;
  label: string;
  tip: string;
  ariaLabel: string;
  onUndo: () => void;
}

/** Contenu du toast de succès : message (la région live est portée par sonner), bouton Annuler (un seul appel). */
export function ActivationUndoToast({ message, label, tip, ariaLabel, onUndo }: ActivationUndoToastProps) {
  const done = useRef(false);
  return (
    <div
      className="flex w-[356px] max-w-full items-center gap-3 rounded-lg border border-border bg-popover p-3 text-sm text-popover-foreground shadow-lg"
    >
      <span className="min-w-0 flex-1">{message}</span>
      <CrmActionButton
        actionId="activation.undo"
        label={label}
        tip={tip}
        ariaLabel={ariaLabel}
        tipAboveToasts
        onClick={() => {
          if (done.current) return;
          done.current = true;
          onUndo();
        }}
      />
    </div>
  );
}
