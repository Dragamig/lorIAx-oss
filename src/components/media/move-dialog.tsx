"use client"

import { useEffect, useId, useMemo, useState, type FormEvent } from "react"
import { useTranslations } from "next-intl"
import { Button } from "@/components/ui/button"
import { Dialog, DialogContent, DialogFooter, DialogHeader, DialogTitle } from "@/components/ui/dialog"
import { Label } from "@/components/ui/label"
import type { FolderNode } from "@/lib/media/folders"
import { folderPath } from "./filter-bar"

type Props = {
  open: boolean
  onOpenChange: (open: boolean) => void
  folders: FolderNode[]
  /** Dossier courant, proposé par défaut. */
  currentFolderId?: string | null
  onMove: (folderId: string | null) => void
}

/** Alternative clavier au glisser-déposer : choisit un dossier de l'arbre ou « Sans dossier ». */
export function MoveDialog({ open, onOpenChange, folders, currentFolderId, onMove }: Props) {
  const t = useTranslations("library.bulk")
  const selectId = useId()
  const [target, setTarget] = useState(currentFolderId ?? "")
  useEffect(() => {
    if (open) setTarget(currentFolderId ?? "")
  }, [open, currentFolderId])

  const options = useMemo(
    () =>
      folders
        .map((f) => ({ id: f.id, label: folderPath(folders, f.id).map((n) => n.name).join(" / ") }))
        .sort((a, b) => a.label.localeCompare(b.label)),
    [folders]
  )

  const submit = (e: FormEvent) => {
    e.preventDefault()
    onOpenChange(false)
    onMove(target || null)
  }

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent>
        <form onSubmit={submit} className="grid gap-4">
          <DialogHeader>
            <DialogTitle>{t("moveTitle")}</DialogTitle>
          </DialogHeader>
          <div className="grid gap-1.5">
            <Label htmlFor={selectId}>{t("moveLabel")}</Label>
            <select
              id={selectId}
              value={target}
              onChange={(e) => setTarget(e.target.value)}
              className="h-8 rounded-lg border border-input bg-background px-2 text-sm outline-none focus-visible:border-ring focus-visible:ring-3 focus-visible:ring-ring/50"
            >
              <option value="">{t("moveNoFolder")}</option>
              {options.map((o) => (
                <option key={o.id} value={o.id}>
                  {o.label}
                </option>
              ))}
            </select>
          </div>
          <DialogFooter>
            <Button type="button" variant="outline" onClick={() => onOpenChange(false)}>
              {t("cancel")}
            </Button>
            <Button type="submit">{t("moveConfirm")}</Button>
          </DialogFooter>
        </form>
      </DialogContent>
    </Dialog>
  )
}
