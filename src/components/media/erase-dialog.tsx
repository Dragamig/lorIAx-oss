"use client"

import { useEffect, useState } from "react"
import { useTranslations } from "next-intl"
import { toast } from "sonner"
import { Button } from "@/components/ui/button"
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog"
import { Input } from "@/components/ui/input"
import { Label } from "@/components/ui/label"

export type EraseTarget = { id: string; name: string; affected: number }

type Props = {
  open: boolean
  onOpenChange: (open: boolean) => void
  targets: EraseTarget[]
  /** Appelé après l'effacement, avec les identifiants effacés et ceux refusés. */
  onDone: (result: { erasedIds: string[]; failedIds: string[] }) => void
}

/** Effacement définitif : irréversible, confirmé par saisie du nom (ou du nombre pour un lot). */
export function EraseDialog({ open, onOpenChange, targets, onDone }: Props) {
  const t = useTranslations("library.erase")
  const [typed, setTyped] = useState("")
  const [busy, setBusy] = useState(false)
  const single = targets.length === 1
  const expected = single ? targets[0].name : String(targets.length)
  const affected = targets.reduce((n, x) => n + x.affected, 0)

  useEffect(() => {
    if (open) setTyped("")
  }, [open])

  const confirm = async () => {
    setBusy(true)
    const erasedIds: string[] = []
    const failedIds: string[] = []
    for (const target of targets) {
      try {
        const res = await fetch(`/api/media/${target.id}/purge`, { method: "DELETE" })
        if (res.ok) erasedIds.push(target.id)
        else failedIds.push(target.id)
      } catch {
        failedIds.push(target.id)
      }
    }
    setBusy(false)
    if (failedIds.length === 0) {
      toast.success(erasedIds.length === 1 ? t("doneOne") : t("doneMany", { count: String(erasedIds.length) }))
    } else {
      toast.error(
        erasedIds.length === 0
          ? t("failed")
          : t("partial", { ok: String(erasedIds.length), total: String(targets.length), failed: String(failedIds.length) })
      )
    }
    onOpenChange(false)
    onDone({ erasedIds, failedIds })
  }

  return (
    <Dialog open={open} onOpenChange={(o) => !busy && onOpenChange(o)}>
      <DialogContent>
        <DialogHeader>
          <DialogTitle>{single ? t("titleOne", { name: targets[0].name }) : t("titleMany", { count: String(targets.length) })}</DialogTitle>
          <DialogDescription>{t("irreversible")}</DialogDescription>
        </DialogHeader>
        <div className="space-y-3 text-sm">
          <p>{affected === 0 ? t("affectedNone") : t(affected === 1 ? "affectedOne" : "affectedMany", { count: String(affected) })}</p>
          <p className="text-muted-foreground">{t("noUndo")}</p>
          <div className="space-y-1.5">
            <Label htmlFor="erase-confirm">{single ? t("typeName") : t("typeCount")}</Label>
            <Input
              id="erase-confirm"
              value={typed}
              onChange={(e) => setTyped(e.target.value)}
              placeholder={expected}
              autoComplete="off"
              disabled={busy}
            />
          </div>
        </div>
        <DialogFooter>
          <Button type="button" variant="outline" onClick={() => onOpenChange(false)} disabled={busy}>
            {t("cancel")}
          </Button>
          <Button type="button" variant="destructive" onClick={() => void confirm()} disabled={busy || typed !== expected}>
            {t("confirm")}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  )
}
