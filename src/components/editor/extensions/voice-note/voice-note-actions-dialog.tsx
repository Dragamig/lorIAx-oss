"use client";

import { useEffect, useState } from "react";
import { ListTodo } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import {
  Dialog,
  DialogClose,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";

interface VoiceNoteActionsDialogProps {
  /** Intitulés extraits de la section « Actions » de la synthèse. */
  actions: string[];
  open: boolean;
  onOpenChange: (open: boolean) => void;
  /** Ne reçoit que les intitulés cochés, non vides, espaces normalisés. */
  onConfirm: (titles: string[]) => void;
}

interface Row {
  checked: boolean;
  title: string;
}

function rowsFromActions(actions: string[]): Row[] {
  return actions.map((title) => ({ checked: true, title }));
}

/**
 * Boîte de dialogue de revue humaine avant conversion des actions d'une
 * synthèse en tâches. Chaque ligne reste modifiable et peut être exclue :
 * on ne crée jamais de tâche sans que l'utilisateur l'ait vue passer.
 */
export function VoiceNoteActionsDialog({
  actions,
  open,
  onOpenChange,
  onConfirm,
}: VoiceNoteActionsDialogProps) {
  const [rows, setRows] = useState<Row[]>(() => rowsFromActions(actions));

  // Le contenu est réinitialisé à chaque ouverture : rouvrir la boîte après
  // une synthèse relancée doit repartir des actions actuelles, pas de la
  // sélection laissée par un usage précédent.
  useEffect(() => {
    if (open) setRows(rowsFromActions(actions));
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [open]);

  const retained = rows
    .filter((row) => row.checked)
    .map((row) => row.title.replace(/\s+/g, " ").trim())
    .filter((title) => title.length > 0);
  const canConfirm = retained.length > 0;

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent>
        <DialogHeader>
          <DialogTitle>Convertir les actions en tâches</DialogTitle>
          <DialogDescription>
            Les actions cochées deviendront des tâches, ajoutées dans le document
            juste sous ce bloc. Vous pourrez ensuite les affecter et les dater
            depuis l&apos;outil tâches.
          </DialogDescription>
        </DialogHeader>

        {/* Un `div` et non un `label` par ligne : chaque ligne porte deux
            contrôles, et un label n'en pilote qu'un seul, ce qui rendrait le
            clic dans le champ texte ambigu. La case porte donc son propre
            libellé. */}
        <div className="flex max-h-[320px] flex-col gap-2 overflow-y-auto">
          {rows.map((row, index) => (
            <div
              key={index}
              className="flex items-start gap-2.5 rounded-lg border border-border/60 p-2.5"
            >
              <input
                type="checkbox"
                checked={row.checked}
                onChange={(event) =>
                  setRows((previous) =>
                    previous.map((item, itemIndex) =>
                      itemIndex === index
                        ? { ...item, checked: event.target.checked }
                        : item
                    )
                  )
                }
                className="mt-1.5 rounded"
                aria-label={`Convertir « ${row.title} » en tâche`}
              />
              <Input
                value={row.title}
                onChange={(event) =>
                  setRows((previous) =>
                    previous.map((item, itemIndex) =>
                      itemIndex === index
                        ? { ...item, title: event.target.value }
                        : item
                    )
                  )
                }
                disabled={!row.checked}
                className="h-auto flex-1 py-1.5"
                aria-label={`Intitulé de l'action ${index + 1}`}
              />
            </div>
          ))}
        </div>

        <DialogFooter>
          <DialogClose render={<Button variant="outline" />}>Annuler</DialogClose>
          <Button onClick={() => onConfirm(retained)} disabled={!canConfirm}>
            <ListTodo className="h-3.5 w-3.5" aria-hidden="true" />
            Créer {retained.length > 0 ? `${retained.length} ` : ""}
            {retained.length > 1 ? "tâches" : "tâche"}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
