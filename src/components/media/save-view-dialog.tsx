"use client"

import { useEffect, useId, useState, type FormEvent } from "react"
import { useTranslations } from "next-intl"
import { toast } from "sonner"
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog"
import { Input } from "@/components/ui/input"
import { Label } from "@/components/ui/label"
import type { SavedViewDto } from "@/lib/media/saved-views-limits"
import { ActionButton } from "./action-button"

export type SaveViewTarget = { mode: "create"; query: string; criteria: string[] } | { mode: "edit"; view: SavedViewDto; criteria: string[] }

type Props = {
  target: SaveViewTarget | null
  onOpenChange: (open: boolean) => void
  /** Noms des vues de l'utilisateur (contrôle de doublon, insensible à la casse). */
  ownNames: { id: string; name: string }[]
  /** Appelé après une écriture réussie. */
  onSaved: () => void
}

export function SaveViewDialog({ target, onOpenChange, ownNames, onSaved }: Props) {
  const t = useTranslations("library.views")
  const inputId = useId()
  const helpId = `${inputId}-help`
  const [name, setName] = useState("")
  const [shared, setShared] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [busy, setBusy] = useState(false)

  const editId = target?.mode === "edit" ? target.view.id : null
  useEffect(() => {
    if (!target) return
    setName(target.mode === "edit" ? target.view.name : "")
    setShared(target.mode === "edit" ? target.view.shared : false)
    setError(null)
    setBusy(false)
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [target === null, editId])

  const trimmed = name.trim()
  const disabledReason = busy ? t("busy") : trimmed.length === 0 ? t("nameDisabled") : undefined

  const submit = async () => {
    if (!target || busy) return
    if (!trimmed) {
      setError(t("nameRequired"))
      return
    }
    if (ownNames.some((v) => v.id !== editId && v.name.toLowerCase() === trimmed.toLowerCase())) {
      setError(t("nameDuplicate"))
      return
    }
    setBusy(true)
    setError(null)
    try {
      const res =
        target.mode === "create"
          ? await fetch("/api/media/views", {
              method: "POST",
              headers: { "Content-Type": "application/json" },
              body: JSON.stringify({ name: trimmed, query: target.query, shared }),
            })
          : await fetch(`/api/media/views/${target.view.id}`, {
              method: "PATCH",
              headers: { "Content-Type": "application/json" },
              body: JSON.stringify({ name: trimmed, shared }),
            })
      if (!res.ok) {
        const body = (await res.json().catch(() => ({}))) as { error?: unknown }
        const msg = typeof body.error === "string" ? body.error : ""
        setError(res.status === 409 && /nom/i.test(msg) ? t("nameDuplicate") : msg || t("saveFailed"))
        return
      }
      onOpenChange(false)
      onSaved()
      toast.success(
        target.mode === "create"
          ? t(shared ? "createdShared" : "created", { name: trimmed })
          : t("updated", { name: trimmed })
      )
    } catch {
      setError(t("saveFailed"))
    } finally {
      setBusy(false)
    }
  }

  const onSubmit = (e: FormEvent) => {
    e.preventDefault()
    void submit()
  }

  return (
    <Dialog open={target !== null} onOpenChange={(o) => (busy ? undefined : onOpenChange(o))}>
      <DialogContent>
        <form onSubmit={onSubmit} className="grid gap-4">
          <DialogHeader>
            <DialogTitle>{target?.mode === "edit" ? t("editTitle") : t("createTitle")}</DialogTitle>
          </DialogHeader>
          <div className="grid gap-1.5">
            <Label htmlFor={inputId}>{t("nameLabel")}</Label>
            <Input
              id={inputId}
              value={name}
              autoFocus
              maxLength={80}
              autoComplete="off"
              aria-invalid={error ? true : undefined}
              aria-describedby={error ? helpId : undefined}
              onChange={(e) => {
                setName(e.target.value)
                setError(null)
              }}
            />
            {error ? (
              <p id={helpId} role="alert" className="text-xs text-destructive">
                {error}
              </p>
            ) : null}
          </div>
          <label className="flex cursor-pointer items-start gap-2 text-sm">
            <input
              type="checkbox"
              className="mt-1"
              checked={shared}
              onChange={(e) => setShared(e.target.checked)}
            />
            <span>
              {t("shareLabel")}
              <small className="block text-xs text-muted-foreground">{t("shareHelp")}</small>
            </span>
          </label>
          {target ? (
            <div className="space-y-1">
              <p className="text-xs text-muted-foreground">{t("criteria")}</p>
              <ul aria-label={t("criteria")} className="flex flex-wrap gap-1">
                {target.criteria.map((c) => (
                  <li key={c} className="rounded-full border border-border px-2 py-0.5 text-xs">
                    {c}
                  </li>
                ))}
              </ul>
            </div>
          ) : null}
          <div className="flex justify-end gap-2">
            <ActionButton
              id="cancelSaveView"
              showLabel
              variant="outline"
              size="default"
              onAction={() => onOpenChange(false)}
              disabledReason={busy ? t("busy") : undefined}
            />
            <ActionButton
              id="confirmSaveView"
              showLabel
              variant="default"
              size="default"
              disabledReason={disabledReason}
              onAction={() => void submit()}
            />
          </div>
        </form>
      </DialogContent>
    </Dialog>
  )
}
