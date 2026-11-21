"use client";

import { AlertTriangle, RefreshCw } from "lucide-react";
import { Button } from "@/components/ui/button";
import { SyncedContent } from "../synced-block/synced-content";
import type { VoiceNoteProcessKind } from "./voice-note-api";

interface VoiceNoteOutputSectionProps {
  kind: VoiceNoteProcessKind;
  content: string | null;
  /** Vrai quand le transcript a été corrigé après ce traitement. */
  stale: boolean;
  busy: boolean;
  /** Faux tant que le transcript n'est pas validé : la relance serait refusée. */
  canRelaunch: boolean;
  onRelaunch: (kind: VoiceNoteProcessKind) => void;
  emptyLabel: string;
}

/**
 * Corps d'une section de compte rendu : avertissement d'antériorité, contenu
 * markdown, et bouton de relance. Une correction ne détruit jamais une sortie,
 * elle la marque comme antérieure.
 */
export function VoiceNoteOutputSection({
  kind,
  content,
  stale,
  busy,
  canRelaunch,
  onRelaunch,
  emptyLabel,
}: VoiceNoteOutputSectionProps) {
  return (
    <>
      {stale && (
        <div className="flex items-start gap-2 rounded-md bg-amber-500/10 px-2.5 py-2 text-xs font-medium text-amber-700 dark:text-amber-400">
          <AlertTriangle className="mt-0.5 h-3.5 w-3.5 shrink-0" aria-hidden="true" />
          <span>
            Le transcript a été corrigé après ce traitement. Relancez pour le mettre
            à jour.
          </span>
        </div>
      )}
      {busy && (
        <p className="text-sm text-muted-foreground">
          Traitement en cours. Vous pouvez fermer le document, il continue.
        </p>
      )}
      {content ? (
        <div className="max-h-[320px] overflow-y-auto text-[13.5px]">
          <SyncedContent markdown={content} />
        </div>
      ) : (
        !busy && <p className="text-sm text-muted-foreground">{emptyLabel}</p>
      )}
      <div>
        {canRelaunch ? (
          <Button
            size="sm"
            variant="outline"
            onClick={() => onRelaunch(kind)}
            disabled={busy}
          >
            <RefreshCw
              className={`mr-1.5 h-3.5 w-3.5 ${busy ? "animate-spin" : ""}`}
              aria-hidden="true"
            />
            {content ? "Relancer" : "Générer"}
          </Button>
        ) : (
          // Le serveur n'autorise un traitement que sur un transcript validé :
          // on dit la condition plutôt que d'offrir un bouton qui échouerait.
          <p className="text-xs text-muted-foreground">
            Validez le transcript pour relancer ce traitement.
          </p>
        )}
      </div>
    </>
  );
}
