"use client";

import { useCallback, useEffect, useState } from "react";
import { Loader2, ChevronDown, ChevronRight, Copy, FileAudio } from "lucide-react";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";

interface MeetingTranscriptPreviewProps {
  meetingId: string;
  status: string;
}

/**
 * Acces au transcript brut d'une reunion terminee.
 * Le bouton n'apparait que si une sonde legere (`?meta=1`) confirme qu'un
 * fichier de transcription existe : jamais de bouton mort renvoyant 404.
 * Le contenu n'est charge qu'au premier depliage.
 */
export function MeetingTranscriptPreview({
  meetingId,
  status,
}: MeetingTranscriptPreviewProps) {
  const [available, setAvailable] = useState(false);
  const [expanded, setExpanded] = useState(false);
  const [content, setContent] = useState<string | null>(null);
  const [truncated, setTruncated] = useState(false);
  const [loading, setLoading] = useState(false);

  // Sonde de disponibilite (ne lit pas le contenu du fichier)
  useEffect(() => {
    if (status !== "completed" || !meetingId) return;
    let cancelled = false;

    fetch(`/api/meet/rooms/${meetingId}/transcript?meta=1`)
      .then((res) => (res.ok ? res.json() : null))
      .then((data) => {
        if (!cancelled && data?.available) setAvailable(true);
      })
      .catch(() => {
        // Silencieux : sans transcript, le bouton reste simplement masque
      });

    return () => {
      cancelled = true;
    };
  }, [meetingId, status]);

  const handleToggle = useCallback(async () => {
    if (!expanded && content === null && meetingId) {
      setLoading(true);
      try {
        const res = await fetch(`/api/meet/rooms/${meetingId}/transcript`);
        if (res.ok) {
          const data = await res.json();
          setContent(data.content || "");
          setTruncated(!!data.truncated);
        } else {
          setContent("");
        }
      } catch {
        setContent("");
      } finally {
        setLoading(false);
      }
    }
    setExpanded((prev) => !prev);
  }, [expanded, content, meetingId]);

  const handleCopy = useCallback(async () => {
    if (!content) return;
    try {
      await navigator.clipboard.writeText(content);
      toast.success("Transcription copiée dans le presse-papiers");
    } catch {
      toast.error("Copie impossible depuis ce navigateur");
    }
  }, [content]);

  if (status !== "completed" || !available) return null;

  return (
    <>
      <Button size="sm" variant="outline" onClick={handleToggle}>
        {expanded ? (
          <ChevronDown className="h-4 w-4 mr-1" />
        ) : (
          <ChevronRight className="h-4 w-4 mr-1" />
        )}
        <FileAudio className="h-4 w-4 mr-1" />
        Transcription
      </Button>

      {expanded && (
        <div className="border-t border-border/50 p-4 mt-4 -mx-4 -mb-4">
          {loading ? (
            <div className="flex items-center gap-2 text-sm text-muted-foreground">
              <Loader2 className="h-4 w-4 animate-spin" />
              Chargement de la transcription...
            </div>
          ) : content ? (
            <div className="space-y-2">
              <div className="flex items-center justify-between gap-2">
                <span className="text-xs text-muted-foreground">
                  Texte brut issu de l&apos;enregistrement audio.
                </span>
                <Button size="sm" variant="ghost" onClick={handleCopy}>
                  <Copy className="h-4 w-4 mr-1" />
                  Copier
                </Button>
              </div>
              <pre className="max-h-80 overflow-y-auto whitespace-pre-wrap break-words rounded-md bg-muted/40 p-3 text-xs leading-relaxed text-foreground font-mono">
                {content}
              </pre>
              {truncated && (
                <p className="text-xs text-muted-foreground">
                  Transcription trop longue : seul le début est affiché ici.
                </p>
              )}
            </div>
          ) : (
            <p className="text-sm text-muted-foreground">
              Transcription indisponible.
            </p>
          )}
        </div>
      )}
    </>
  );
}
