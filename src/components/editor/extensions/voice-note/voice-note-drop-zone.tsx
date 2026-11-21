"use client";

import { useRef, useState, type RefObject } from "react";
import { Upload } from "lucide-react";
import { AUDIO_INPUT_ACCEPT } from "./voice-note-api";

interface VoiceNoteDropZoneProps {
  onFile: (file: File | null | undefined) => void;
  /** Texte avant le lien de sélection. */
  label: string;
  /** Libellé du lien qui ouvre le sélecteur de fichiers. */
  actionLabel: string;
  disabled?: boolean;
}

/**
 * Dépôt ou sélection d'un fichier audio déjà enregistré. Reste proposé même
 * quand le micro est refusé : c'est la porte de sortie de cet état.
 */
export function VoiceNoteDropZone({
  onFile,
  label,
  actionLabel,
  disabled = false,
}: VoiceNoteDropZoneProps) {
  const inputRef = useRef<HTMLInputElement>(null);
  const [over, setOver] = useState(false);

  return (
    <div
      onDragOver={(event) => {
        if (disabled) return;
        event.preventDefault();
        setOver(true);
      }}
      onDragLeave={() => setOver(false)}
      onDrop={(event) => {
        if (disabled) return;
        event.preventDefault();
        setOver(false);
        onFile(event.dataTransfer.files?.[0]);
      }}
      className={`rounded-lg border border-dashed p-3.5 text-center text-[13px] text-muted-foreground transition-colors ${
        over ? "border-primary bg-primary/5" : "border-border"
      }`}
    >
      {label}{" "}
      <button
        type="button"
        disabled={disabled}
        onClick={() => inputRef.current?.click()}
        className="font-semibold text-foreground underline underline-offset-2 disabled:opacity-50"
      >
        {actionLabel}
      </button>
      <Upload className="ml-1.5 inline h-3.5 w-3.5 align-[-2px]" aria-hidden="true" />
      <input
        ref={inputRef as RefObject<HTMLInputElement>}
        type="file"
        accept={AUDIO_INPUT_ACCEPT}
        className="hidden"
        onChange={(event) => {
          onFile(event.target.files?.[0]);
          event.target.value = "";
        }}
      />
    </div>
  );
}
