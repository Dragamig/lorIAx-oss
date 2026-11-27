"use client"

import { useTranslations } from "next-intl"
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from "@/components/ui/dialog"
import { ActionButton } from "./action-button"

type Props = {
  open: boolean
  name: string
  percent: number
  onKeep: () => void
  onConfirm: () => void
}

/** Confirmation d'annulation d'un envoi par parts : les parts déjà envoyées sont supprimées. */
export function CancelUploadDialog({ open, name, percent, onKeep, onConfirm }: Props) {
  const t = useTranslations("library.upload.large")
  return (
    <Dialog open={open} onOpenChange={(o) => !o && onKeep()}>
      <DialogContent className="sm:max-w-sm" role="alertdialog">
        <DialogHeader>
          <DialogTitle>{t("cancelTitle")}</DialogTitle>
          <DialogDescription>{t("cancelBody", { pct: String(percent), name })}</DialogDescription>
        </DialogHeader>
        <DialogFooter>
          <ActionButton id="keepUpload" variant="outline" size="default" showLabel onAction={onKeep} />
          <ActionButton id="confirmCancelUpload" variant="destructive" size="default" showLabel onAction={onConfirm} />
        </DialogFooter>
      </DialogContent>
    </Dialog>
  )
}
