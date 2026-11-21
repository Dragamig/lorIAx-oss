"use client";

import { Trash2, Link2, X } from "lucide-react";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import type { PairingInfo } from "./relation-pairing";

export type DeleteColumnDialogProps = {
  open: boolean;
  columnName: string;
  isRelation: boolean;
  pairing: PairingInfo;
  onCancel: () => void;
  onConfirm: (alsoDeleteInverse: boolean) => void;
};

const choiceClass =
  "w-full text-left rounded-md border px-3 py-2 flex gap-2 items-start hover:bg-accent focus-visible:outline-2 focus-visible:outline-offset-1 focus-visible:outline-primary";

/** Modale de suppression de colonne : deux choix pour une relation jumelée, sinon confirmation simple. */
export function DeleteColumnDialog({
  open,
  columnName,
  isRelation,
  pairing,
  onCancel,
  onConfirm,
}: DeleteColumnDialogProps) {
  const paired = pairing.kind === "paired";
  const inverseName = paired ? pairing.inverseColumnName ?? "la colonne jumelle" : "";
  const targetName = paired ? pairing.targetDatabaseName : "";

  return (
    <Dialog open={open} onOpenChange={(o) => { if (!o) onCancel(); }}>
      <DialogContent showCloseButton={false}>
        <DialogHeader>
          <DialogTitle>Supprimer la colonne « {columnName} »</DialogTitle>
          <DialogDescription>
            {paired
              ? `Cette relation est jumelée avec « ${inverseName} » dans ${targetName}. Que faire de la colonne inverse ?`
              : isRelation
                ? "Les liens de cette colonne sont supprimés. Aucune autre base n'est modifiée."
                : "Les valeurs de cette colonne sont supprimées."}
          </DialogDescription>
        </DialogHeader>
        <div className="flex flex-col gap-2">
          {paired ? (
            <>
              <button
                type="button"
                className={choiceClass}
                title="Supprimer les deux colonnes et leurs liens"
                onClick={() => onConfirm(true)}
              >
                <Trash2 className="h-4 w-4 mt-0.5 text-destructive shrink-0" aria-hidden />
                <span>
                  <span className="block font-medium">Supprimer les deux colonnes</span>
                  <span className="block text-xs text-muted-foreground">
                    « {columnName} » et « {inverseName} » disparaissent avec leurs liens.
                  </span>
                </span>
              </button>
              <button
                type="button"
                className={choiceClass}
                title="Supprimer seulement cette colonne, la jumelle devient une colonne simple"
                onClick={() => onConfirm(false)}
              >
                <Link2 className="h-4 w-4 mt-0.5 shrink-0" aria-hidden />
                <span>
                  <span className="block font-medium">Supprimer seulement « {columnName} »</span>
                  <span className="block text-xs text-muted-foreground">
                    « {inverseName} » reste dans {targetName} comme colonne simple, ses liens sont conservés.
                  </span>
                </span>
              </button>
            </>
          ) : (
            <button
              type="button"
              className="w-full rounded-md bg-destructive text-white px-3 py-2 flex items-center justify-center gap-2 hover:opacity-90 focus-visible:outline-2 focus-visible:outline-offset-1 focus-visible:outline-primary"
              title="Supprimer la colonne"
              onClick={() => onConfirm(false)}
            >
              <Trash2 className="h-4 w-4" aria-hidden />
              Supprimer la colonne
            </button>
          )}
          <button
            type="button"
            className="w-full rounded-md border px-3 py-2 flex items-center justify-center gap-2 hover:bg-accent focus-visible:outline-2 focus-visible:outline-offset-1 focus-visible:outline-primary"
            title="Annuler (Échap)"
            onClick={onCancel}
          >
            <X className="h-4 w-4" aria-hidden />
            Annuler
          </button>
        </div>
      </DialogContent>
    </Dialog>
  );
}
