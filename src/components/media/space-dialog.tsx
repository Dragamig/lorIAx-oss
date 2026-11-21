"use client"

import { useEffect, useId, useState } from "react"
import { useTranslations } from "next-intl"
import { toast } from "sonner"
import { Button } from "@/components/ui/button"
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from "@/components/ui/dialog"
import { Label } from "@/components/ui/label"
import type { UndoStack } from "./use-undo-stack"

type Props = {
  open: boolean
  onOpenChange: (open: boolean) => void
  mediaId: string
  currentSpace: { id: string | null; name: string | null }
  /** Espaces proposés ; « Hors espace » est toujours ajouté. */
  spaces: { id: string; name: string }[]
  /** Appelé après un changement réussi ou son annulation. */
  onChanged: () => void
  /** Pile de Ctrl+Z de la page, quand elle existe. */
  undo?: UndoStack
}

async function patchSpace(mediaId: string, spaceId: string | null): Promise<number> {
  const res = await fetch(`/api/media/${mediaId}/meta`, {
    method: "PATCH",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ spaceId }),
  })
  return res.ok ? 200 : res.status
}

/** Reclassement d'un média vers un autre espace (réservé aux admins, contrôlé côté serveur). */
export function SpaceDialog({ open, onOpenChange, mediaId, currentSpace, spaces, onChanged, undo }: Props) {
  const t = useTranslations("library")
  const selectId = useId()
  const [target, setTarget] = useState<string>(currentSpace.id ?? "")
  const [busy, setBusy] = useState(false)

  useEffect(() => {
    if (open) setTarget(currentSpace.id ?? "")
  }, [open, currentSpace.id])

  const same = target === (currentSpace.id ?? "")
  const warning = target === "" ? t("space.warnToNone") : currentSpace.id === null ? t("space.warnFromNone") : t("space.warnShared")

  const confirm = async () => {
    setBusy(true)
    const next = target === "" ? null : target
    const nextName = next ? (spaces.find((s) => s.id === next)?.name ?? "") : t("space.none")
    const status = await patchSpace(mediaId, next).catch(() => 0)
    setBusy(false)
    if (status !== 200) {
      toast.error(status === 403 ? t("space.forbidden") : t("space.failed"))
      return
    }
    onOpenChange(false)
    onChanged()
    const revert = async () => {
      const s = await patchSpace(mediaId, currentSpace.id).catch(() => 0)
      if (s === 200) onChanged()
      else toast.error(t("space.failed"))
    }
    const entry = undo?.push(revert, [mediaId])
    const toastId = toast.success(t("space.changed", { space: nextName }), {
      action: {
        label: t("actions.undo"),
        onClick: () =>
          void (entry && undo
            ? undo.tryRun(entry).then((ran) => {
                if (!ran) toast.info(t("bulk.undoStale"))
              })
            : revert()),
      },
    })
    if (entry) entry.dismiss = () => toast.dismiss(toastId)
  }

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent>
        <DialogHeader>
          <DialogTitle>{t("space.title")}</DialogTitle>
          <DialogDescription>{t("space.current", { space: currentSpace.name ?? t("space.none") })}</DialogDescription>
        </DialogHeader>
        <div className="grid gap-1.5">
          <Label htmlFor={selectId}>{t("space.target")}</Label>
          <select
            id={selectId}
            className="h-8 w-full rounded-lg border border-input bg-transparent px-2 text-sm"
            value={target}
            onChange={(e) => setTarget(e.target.value)}
          >
            <option value="">{t("space.none")}</option>
            {spaces.map((s) => (
              <option key={s.id} value={s.id}>
                {s.name}
              </option>
            ))}
          </select>
        </div>
        <p className="text-sm text-muted-foreground">{warning}</p>
        <DialogFooter>
          <Button variant="outline" onClick={() => onOpenChange(false)}>
            {t("space.cancel")}
          </Button>
          <Button
            onClick={() => void confirm()}
            disabled={same || busy}
            title={same ? t("space.sameReason") : undefined}
          >
            {t("space.confirm")}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  )
}
