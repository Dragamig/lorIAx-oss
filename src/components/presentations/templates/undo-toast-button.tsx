"use client";

import { Undo2 } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Hint } from "@/components/ui/hint";

/**
 * Bouton « Annuler » placé dans un toast. Les libellés sont fournis par
 * l'appelant : le toast vit hors de l'arbre de traduction.
 */
export function UndoToastButton({
  label,
  tip,
  onClick,
}: {
  label: string;
  tip: string;
  onClick: () => void;
}) {
  return (
    <Hint label={tip}>
      <Button
        type="button"
        variant="outline"
        size="sm"
        aria-label={label}
        onClick={onClick}
        className="min-h-6 min-w-6"
      >
        <Undo2 aria-hidden="true" />
        <span>{label}</span>
      </Button>
    </Hint>
  );
}
