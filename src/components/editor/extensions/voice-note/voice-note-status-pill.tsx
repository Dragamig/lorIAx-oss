"use client";

import type { ReactNode } from "react";

export type VoiceNotePillTone = "recording" | "work" | "review" | "done";

interface VoiceNoteStatusPillProps {
  tone: VoiceNotePillTone;
  /** Point clignotant de l'enregistrement, respectueux de prefers-reduced-motion. */
  withDot?: boolean;
  /** Fige le point pendant une pause. */
  dotStill?: boolean;
  children: ReactNode;
}

const TONE_CLASSES: Record<VoiceNotePillTone, string> = {
  recording: "bg-destructive/10 text-destructive",
  work: "bg-blue-500/10 text-blue-700 dark:text-blue-300",
  review: "bg-amber-500/10 text-amber-700 dark:text-amber-400",
  done: "bg-emerald-500/10 text-emerald-700 dark:text-emerald-400",
};

/** Pastille d'état du bloc note vocale, reprise de la maquette. */
export function VoiceNoteStatusPill({
  tone,
  withDot = false,
  dotStill = false,
  children,
}: VoiceNoteStatusPillProps) {
  return (
    <span
      className={`inline-flex items-center gap-1.5 rounded-full px-2.5 py-0.5 text-[11.5px] font-semibold ${TONE_CLASSES[tone]}`}
    >
      {withDot && (
        <span
          className={`inline-block h-[7px] w-[7px] rounded-full bg-current ${
            dotStill ? "" : "motion-safe:animate-pulse"
          }`}
          aria-hidden="true"
        />
      )}
      {children}
    </span>
  );
}
