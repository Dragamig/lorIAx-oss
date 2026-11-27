"use client"

import { useEffect, useId, useRef, useState } from "react"
import { useLocale, useTranslations } from "next-intl"
import { AlertTriangle, FileUp } from "lucide-react"
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog"
import { Label } from "@/components/ui/label"
import { Textarea } from "@/components/ui/textarea"
import type { MediaVersionDto } from "@/lib/media/version-dto"
import { ActionButton } from "./action-button"
import { formatMediaSize } from "./media-format"

export type ReplaceOutcome = {
  version: MediaVersionDto
  /** Réponse du serveur : numéro de la version devenue courante. */
  currentVersion: number
}

type Props = {
  open: boolean
  onOpenChange: (open: boolean) => void
  mediaId: string
  /** Version que l'interface croit courante (contrôle de concurrence côté serveur). */
  expectedVersion: number
  usageCount: number
  /** Appelé après un remplacement réussi. */
  onReplaced: (outcome: ReplaceOutcome) => void
  /** Appelé quand le serveur signale une version périmée : la liste doit être rechargée. */
  onStale: () => void
}

/** Message d'erreur localisé selon le statut et le texte renvoyés par le service. */
export function replaceErrorKey(status: number, message: string | undefined): string {
  if (status === 409) {
    if (message?.includes("corbeille")) return "errTrash"
    if (message?.includes("identique")) return "errSame"
    return "errStale"
  }
  if (status === 415) return "errType"
  if (status === 413) return "errTooLarge"
  if (status === 507) return "errQuota"
  if (status === 403) return "errForbidden"
  return "errGeneric"
}

/** Remplacement de fichier : choix, commentaire, impact sur les usages, envoi. */
export function ReplaceFileDialog({ open, onOpenChange, mediaId, expectedVersion, usageCount, onReplaced, onStale }: Props) {
  const t = useTranslations("library.versions")
  const locale = useLocale()
  const ids = useId()
  const input = useRef<HTMLInputElement>(null)
  const [file, setFile] = useState<File | null>(null)
  const [comment, setComment] = useState("")
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [dragging, setDragging] = useState(false)

  useEffect(() => {
    if (open) {
      setFile(null)
      setComment("")
      setError(null)
      setBusy(false)
    }
  }, [open])

  const submit = async () => {
    if (!file || busy) return
    setBusy(true)
    setError(null)
    try {
      const form = new FormData()
      form.append("file", file)
      form.append("expectedVersion", String(expectedVersion))
      if (comment.trim()) form.append("comment", comment.trim())
      const res = await fetch(`/api/media/${mediaId}/versions`, { method: "POST", body: form })
      if (!res.ok) {
        const body = (await res.json().catch(() => ({}))) as { error?: string }
        const key = replaceErrorKey(res.status, body.error)
        setError(t(key))
        if (key === "errStale") onStale()
        return
      }
      const body = (await res.json()) as { version: MediaVersionDto; media: { currentVersion: number } }
      onOpenChange(false)
      onReplaced({ version: body.version, currentVersion: body.media.currentVersion })
    } catch {
      setError(t("errGeneric"))
    } finally {
      setBusy(false)
    }
  }

  const impact = usageCount === 0 ? t("impactNone") : usageCount === 1 ? t("impactOne") : t("impactMany", { count: String(usageCount) })

  return (
    <Dialog open={open} onOpenChange={(o) => !busy && onOpenChange(o)}>
      <DialogContent>
        <DialogHeader>
          <DialogTitle>{t("dialogTitle")}</DialogTitle>
          <DialogDescription>{t("dialogIntro")}</DialogDescription>
        </DialogHeader>
        <div className="space-y-3 text-sm">
          <input
            ref={input}
            type="file"
            className="sr-only"
            tabIndex={-1}
            aria-label={t("fileInputLabel")}
            data-testid="replace-file-input"
            onChange={(e) => {
              setFile(e.target.files?.[0] ?? null)
              setError(null)
            }}
          />
          <div
            onDragOver={(e) => {
              e.preventDefault()
              setDragging(true)
            }}
            onDragLeave={() => setDragging(false)}
            onDrop={(e) => {
              e.preventDefault()
              setDragging(false)
              const dropped = e.dataTransfer.files?.[0]
              if (dropped) {
                setFile(dropped)
                setError(null)
              }
            }}
            className={`flex flex-col items-center gap-2 rounded-lg border border-dashed p-4 text-center ${dragging ? "border-ring bg-accent" : "border-border bg-muted/40"}`}
          >
            <FileUp className="h-6 w-6 text-muted-foreground" aria-hidden />
            <p className="text-muted-foreground">{file ? t("chosen", { name: file.name, size: formatMediaSize(file.size, locale) }) : t("dropHint")}</p>
            <ActionButton id="chooseReplacement" variant="outline" size="default" showLabel onAction={() => input.current?.click()} />
          </div>
          <div className="space-y-1.5">
            <Label htmlFor={`${ids}-comment`}>{t("commentLabel")}</Label>
            <Textarea
              id={`${ids}-comment`}
              rows={2}
              maxLength={2000}
              placeholder={t("commentPlaceholder")}
              value={comment}
              onChange={(e) => setComment(e.target.value)}
            />
          </div>
          <p className="text-muted-foreground">{impact}</p>
          {busy && (
            <div role="progressbar" aria-label={t("busy")} className="h-1 overflow-hidden rounded-full bg-muted">
              <div className="h-full w-1/3 animate-pulse rounded-full bg-foreground/70" />
            </div>
          )}
          {error && (
            <div role="alert" className="flex items-start gap-2 rounded-lg border border-destructive/50 p-2 text-xs">
              <AlertTriangle className="mt-0.5 h-4 w-4 shrink-0 text-destructive" aria-hidden />
              <span>{error}</span>
            </div>
          )}
        </div>
        <DialogFooter>
          <ActionButton id="pickerCancel" variant="outline" size="default" showLabel onAction={() => onOpenChange(false)} disabledReason={busy ? t("busy") : undefined} />
          <ActionButton
            id="confirmReplace"
            variant="default"
            size="default"
            showLabel
            onAction={() => void submit()}
            disabledReason={busy ? t("busy") : !file ? t("noFile") : undefined}
          />
        </DialogFooter>
      </DialogContent>
    </Dialog>
  )
}
