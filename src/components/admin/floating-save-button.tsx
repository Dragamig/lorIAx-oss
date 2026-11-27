"use client";

import type { ReactNode } from "react";
import { Save, Loader2 } from "lucide-react";
import { Button } from "@/components/ui/button";
import { cn } from "@/lib/utils";
import { Hint } from "@/components/ui/hint";

interface AdminSaveBarProps {
  /** Handler executed when the save button is pressed. */
  onSave: () => void;
  /** Save request in flight. */
  saving: boolean;
  /**
   * Unsaved changes flag. When omitted, the page does not track changes and the
   * button stays enabled (no "unsaved changes" hint is displayed).
   */
  isDirty?: boolean;
  /** Optional page title rendered on the left side of the bar. */
  title?: string;
  /** Optional button label. */
  label?: string;
  /** Replaces the "Modifications non enregistrées" status when provided. */
  pendingLabel?: ReactNode;
  /** Info-bulle affichée sur le bouton désactivé faute de modifications (isDirty à false). */
  disabledHint?: string;
  /** Extra actions rendered just before the save button (test buttons, etc.). */
  children?: ReactNode;
  className?: string;
}

/**
 * Sticky save bar for the admin section.
 *
 * It sticks to the top of the admin scroll container (the `overflow-y-auto`
 * wrapper of `admin/layout.tsx` and of the section layouts) instead of using a
 * global `fixed` position, which would overlap the admin tab bar and the side
 * navigation. Rendered inside the page content, it keeps the save action within
 * reach on long settings pages.
 */
export function AdminSaveBar({
  onSave,
  saving,
  isDirty,
  title,
  label = "Enregistrer",
  pendingLabel,
  disabledHint,
  children,
  className,
}: AdminSaveBarProps) {
  const tracksChanges = isDirty !== undefined;
  const hasPendingChanges = tracksChanges && isDirty === true;
  const disabled = saving || (tracksChanges && !isDirty);

  const saveButton = (
    <Button onClick={onSave} disabled={disabled}>
      {saving ? (
        <Loader2 className="h-4 w-4 mr-2 animate-spin" />
      ) : (
        <Save className="h-4 w-4 mr-2" />
      )}
      {label}
    </Button>
  );

  return (
    <div
      className={cn(
        "sticky top-0 z-20 flex flex-wrap items-center justify-between gap-3 border-b border-border",
        // Fond opaque : le contenu défile dessous, un fond translucide le
        // laissait transparaître derrière le bouton.
        "bg-background py-3",
        // Le conteneur de défilement de l'administration a un rembourrage haut :
        // sans cette bande de couverture, le contenu restait visible en glissant
        // dans les quelques pixels situés au dessus de la barre collée.
        "before:absolute before:inset-x-0 before:bottom-full before:h-6 before:bg-background before:content-['']",
        className
      )}
    >
      {title ? (
        <h2 className="text-lg font-semibold text-foreground">{title}</h2>
      ) : (
        <span />
      )}

      <div className="flex items-center gap-3">
        <span role="status" aria-live="polite" className="flex items-center">
          {saving ? (
            <span className="inline-flex items-center gap-1.5 text-xs font-medium text-muted-foreground">
              <Loader2 className="h-3 w-3 animate-spin" />
              Enregistrement en cours…
            </span>
          ) : hasPendingChanges ? (
            <span className="inline-flex items-center gap-1.5 text-xs font-medium text-amber-700 dark:text-amber-300">
              <span className="h-1.5 w-1.5 rounded-full bg-amber-500" />
              {pendingLabel ?? "Modifications non enregistrées"}
            </span>
          ) : null}
        </span>

        {children}

        {disabledHint && disabled && !saving ? (
          <Hint label={disabledHint} disabled align="end">
            {saveButton}
          </Hint>
        ) : (
          saveButton
        )}
      </div>
    </div>
  );
}
