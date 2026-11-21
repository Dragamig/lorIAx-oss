"use client";

import type { ReactNode } from "react";
import { Textarea } from "@/components/ui/textarea";
import { VoiceNoteAccordion } from "./voice-note-accordion";
import { VoiceNoteOutputSection } from "./voice-note-output-section";
import { formatDuration, formatWordCount } from "./voice-note-format";
import type { VoiceNoteProcessKind } from "./voice-note-api";

interface VoiceNoteAccordionsProps {
  transcript: string;
  /** Le transcript est directement corrigeable dans le bloc. */
  transcriptEditable: boolean;
  onTranscriptChange: (value: string) => void;
  durationSeconds: number | null;
  /** Affiche les deux sections de compte rendu, en plus du transcript. */
  showOutputs: boolean;
  /** Faux tant que le transcript n'est pas validé : la relance serait refusée. */
  canRelaunch: boolean;
  summary: string | null;
  cleanedText: string | null;
  summaryStale: boolean;
  cleanedStale: boolean;
  /** Section ouverte au premier rendu, les autres restent repliées. */
  openByDefault?: "transcript" | "summary" | "cleanup" | "none";
  onRelaunch: (kind: VoiceNoteProcessKind) => void;
  busyKind: VoiceNoteProcessKind | null;
  /** Contenu additionnel affiché sous la synthèse, ex. conversion en tâches. */
  summaryExtra?: ReactNode;
}

/**
 * Les trois sections du bloc, dans l'ordre fixé par la maquette : synthèse,
 * texte remis au propre, transcript. On relit une note pour sa synthèse et on
 * descend au transcript seulement en cas de doute.
 */
export function VoiceNoteAccordions({
  transcript,
  transcriptEditable,
  onTranscriptChange,
  durationSeconds,
  showOutputs,
  canRelaunch,
  summary,
  cleanedText,
  summaryStale,
  cleanedStale,
  openByDefault = "none",
  onRelaunch,
  busyKind,
  summaryExtra,
}: VoiceNoteAccordionsProps) {
  const transcriptHint = [
    formatWordCount(transcript),
    durationSeconds !== null ? formatDuration(durationSeconds) : null,
  ]
    .filter(Boolean)
    .join(" · ");

  return (
    <div className="mt-3">
      {showOutputs && (
        <>
          <VoiceNoteAccordion
            title="Synthèse et actions"
            hint={summary ? "généré" : "non généré"}
            defaultOpen={openByDefault === "summary"}
          >
            <VoiceNoteOutputSection
              kind="summary"
              content={summary}
              stale={summaryStale}
              busy={busyKind === "summary"}
              canRelaunch={canRelaunch}
              onRelaunch={onRelaunch}
              emptyLabel="Aucune synthèse pour le moment."
            />
            {summaryExtra}
          </VoiceNoteAccordion>

          <div className="mt-2">
            <VoiceNoteAccordion
              title="Texte remis au propre"
              hint={cleanedText ? "généré" : "non généré"}
              defaultOpen={openByDefault === "cleanup"}
            >
              <VoiceNoteOutputSection
                kind="cleanup"
                content={cleanedText}
                stale={cleanedStale}
                busy={busyKind === "cleanup"}
                canRelaunch={canRelaunch}
                onRelaunch={onRelaunch}
                emptyLabel="Le texte n'a pas encore été remis au propre."
              />
            </VoiceNoteAccordion>
          </div>
        </>
      )}

      <div className={showOutputs ? "mt-2" : undefined}>
        <VoiceNoteAccordion
          title="Transcript"
          hint={transcriptHint}
          defaultOpen={openByDefault === "transcript"}
        >
          {transcriptEditable ? (
            <>
              <Textarea
                value={transcript}
                onChange={(event) => onTranscriptChange(event.target.value)}
                onKeyDown={(event) => event.stopPropagation()}
                onMouseDown={(event) => event.stopPropagation()}
                aria-label="Transcription de la note vocale"
                className="max-h-[190px] min-h-[140px] resize-y bg-background text-[13.5px] leading-relaxed"
              />
              <p className="text-xs text-muted-foreground">
                Corrigez directement dans le texte : la correction est enregistrée
                automatiquement.
              </p>
            </>
          ) : (
            <div className="max-h-[190px] overflow-y-auto whitespace-pre-wrap rounded-md border border-border/60 bg-muted/40 p-3 text-[13.5px] leading-relaxed">
              {transcript || "Transcription vide."}
            </div>
          )}
        </VoiceNoteAccordion>
      </div>
    </div>
  );
}
