"use client"

import { useEffect, useRef, useState } from "react"
import { Eye, EyeOff, FileWarning } from "lucide-react"
import { useTranslations } from "next-intl"

import { Button } from "@/components/ui/button"
import { Tip } from "./file-block-tip"

const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i

type Props = {
  mediaId: string
  filename: string
  /** Etat ouvert mémorisé dans le nœud. */
  open: boolean
  onOpenChange: (open: boolean) => void
}

/**
 * Aperçu PDF à la demande : un iframe sur `/api/media/<id>` (même origine, seul
 * cadrage autorisé par `frame-policy`), monté au clic. Un état ouvert restauré
 * à l'ouverture du document attend l'entrée dans le viewport.
 */
export function PdfPreview({ mediaId, filename, open, onOpenChange }: Props) {
  const t = useTranslations("editor.fileBlock")
  const anchor = useRef<HTMLDivElement>(null)
  // Un clic dans cette session est déjà visible : pas d'attente du viewport.
  const [armed, setArmed] = useState(false)
  // Un iframe n'émet pas d'erreur sur un 403/404 : la disponibilité est vérifiée avant de le monter.
  const [check, setCheck] = useState<"pending" | "ok" | "failed">("pending")

  useEffect(() => {
    if (!open || armed) return
    const el = anchor.current
    if (!el || typeof IntersectionObserver === "undefined") {
      setArmed(true)
      return
    }
    const io = new IntersectionObserver((entries) => {
      if (entries.some((e) => e.isIntersecting)) {
        setArmed(true)
        io.disconnect()
      }
    })
    io.observe(el)
    return () => io.disconnect()
  }, [open, armed])

  useEffect(() => {
    if (!open || !armed || !UUID_RE.test(mediaId)) return
    const ctrl = new AbortController()
    setCheck("pending")
    fetch(`/api/media/${mediaId}`, { method: "HEAD", credentials: "same-origin", signal: ctrl.signal })
      .then((r) => setCheck(r.ok ? "ok" : "failed"))
      .catch((e: unknown) => {
        if ((e as { name?: string })?.name !== "AbortError") setCheck("failed")
      })
    return () => ctrl.abort()
  }, [open, armed, mediaId])

  if (!UUID_RE.test(mediaId)) return null
  const label = open ? t("hidePreview") : t("preview")
  const Icon = open ? EyeOff : Eye

  return (
    <div ref={anchor} className="mt-1">
      <div className="flex justify-end">
        <Tip text={label}>
          <Button
            type="button"
            variant="ghost"
            size="sm"
            aria-label={label}
            aria-expanded={open}
            onClick={() => {
              if (!open) setArmed(true)
              onOpenChange(!open)
            }}
          >
            <Icon aria-hidden="true" />
          </Button>
        </Tip>
      </div>
      {open && armed && check === "failed" ? (
        <div role="alert" className="flex items-center gap-2 rounded-md border border-border bg-muted px-3 py-2 text-sm text-muted-foreground">
          <FileWarning className="h-4 w-4 shrink-0" aria-hidden="true" />
          <span>{t("previewError")}</span>
        </div>
      ) : null}
      {open && armed && check === "ok" ? (
        <iframe
          title={filename}
          src={`/api/media/${mediaId}#view=FitH`}
          loading="lazy"
          className="block h-[560px] w-full overflow-auto rounded-md border border-border bg-background"
        />
      ) : null}
    </div>
  )
}
