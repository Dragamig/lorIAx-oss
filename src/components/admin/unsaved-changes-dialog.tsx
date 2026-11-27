"use client";

import { LogOut, Save, Undo2 } from "lucide-react";
import { Button } from "@/components/ui/button";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";

interface UnsavedChangesDialogProps {
  open: boolean;
  onStay: () => void;
  onLeave: () => void;
  onSaveAndLeave?: () => void;
}

export function UnsavedChangesDialog({
  open,
  onStay,
  onLeave,
  onSaveAndLeave,
}: UnsavedChangesDialogProps) {
  return (
    <Dialog open={open} onOpenChange={(next) => !next && onStay()}>
      <DialogContent showCloseButton={false} className="sm:max-w-lg">
        <DialogHeader>
          <DialogTitle>Modifications non enregistrées</DialogTitle>
          <DialogDescription>
            Les modifications de cette page seront perdues si vous la quittez.
          </DialogDescription>
        </DialogHeader>
        <DialogFooter className="flex-col gap-2 sm:flex-row sm:flex-wrap sm:justify-end">
          <Button variant="outline" onClick={onStay}>
            <Undo2 aria-hidden="true" />
            Rester
          </Button>
          <Button variant="destructive" onClick={onLeave}>
            <LogOut aria-hidden="true" />
            Quitter sans enregistrer
          </Button>
          {onSaveAndLeave && (
            <Button onClick={onSaveAndLeave}>
              <Save aria-hidden="true" />
              Enregistrer et quitter
            </Button>
          )}
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
