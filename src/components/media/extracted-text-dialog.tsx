"use client"

import { useEffect, useMemo, useRef, useState } from "react"
import { useLocale, useTranslations } from "next-intl"
import { toast } from "sonner"
import { AlertTriangle, FileText, Search } from "lucide-react"
import { Dialog, DialogContent, DialogDescription, DialogHeader, DialogTitle } from "@/components/ui/dialog"
import { Button } from "@/components/ui/button"
import { Hint } from "@/components/ui/hint"
import { Input } from "@/components/ui/input"
import { Skeleton } from "@/components/ui/skeleton"
import { MAX_TEXT_CHARS } from "@/lib/media/ai/limits"
import { ActionButton } from "./action-button"
import { countMatches, parseLines, splitMatches } from "./transcript"
import { useMediaText } from "./use-media-text"

type Props = {
  mediaId: string
  /** Nom du média affiché sous le titre. */
  name?: string
  open: boolean
  onOpenChange: (open: boolean) => void
  /** Si fourni, les horodatages d'une transcription deviennent cliquables (déplace le lecteur). */
  onSeek?: (seconds: number) => void
}

/** Panneau de lecture seule du texte extrait ou de la transcription : recherche, copie, horodatages. */
export function ExtractedTextDialog({ mediaId, name = "", open, onOpenChange, onSeek }: Props) {
  const t = useTranslations("library.textDialog")
  const ti = useTranslations("library.indexing")
  const locale = useLocale()
  const state = useMediaText(mediaId, { withText: true })
  const [query, setQuery] = useState("")
  const [cur, setCur] = useState(0)
  const box = useRef<HTMLDivElement>(null)

  const data = state.phase === "ready" ? state.data : null
  const transcript = data?.source === "transcript"
  const lines = useMemo(() => (data?.text ? parseLines(data.text, transcript) : []), [data?.text, transcript])
  const total = useMemo(() => countMatches(lines, query), [lines, query])
  const hasText = lines.length > 0

  useEffect(() => setCur(0), [query])
  useEffect(() => {
    box.current?.querySelector<HTMLElement>('mark[data-current="true"]')?.scrollIntoView?.({ block: "center" })
  }, [cur, query, total])

  const go = (delta: number) => total > 0 && setCur((c) => (c + delta + total) % total)

  const copy = async () => {
    try {
      await navigator.clipboard.writeText(data?.text ?? "")
      toast.success(t("copied"))
    } catch {
      toast.error(t("copyFailed"))
    }
  }

  const noTools = hasText ? undefined : t("noTextTip")
  const noMatch = !hasText ? t("noTextTip") : total < 2 ? t("noMatchTip") : undefined

  let counter = -1
  let body: React.ReactNode
  if (state.phase === "loading") {
    body = (
      <div role="status" aria-label={t("loading")} aria-busy="true" className="space-y-2.5 p-3">
        <Skeleton className="h-3 w-11/12" />
        <Skeleton className="h-3 w-full" />
        <Skeleton className="h-3 w-3/4" />
        <Skeleton className="h-3 w-5/6" />
      </div>
    )
  } else if (state.phase === "error") {
    body = (
      <div role="alert" className="m-3 flex items-start gap-2 rounded-md border border-destructive/40 bg-destructive/5 p-3 text-sm">
        <AlertTriangle aria-hidden className="mt-0.5 size-4 shrink-0 text-destructive" />
        <div className="space-y-2">
          <p className="font-medium">{t("loadError")}</p>
          <p className="text-xs text-muted-foreground">{t("loadErrorBody")}</p>
          <ActionButton id="retryIndex" onAction={state.retry} showLabel size="sm" variant="outline" />
        </div>
      </div>
    )
  } else if (!hasText) {
    const later = data!.status === "pending" || data!.status === "running"
    body = (
      <div className="flex flex-col items-center gap-2 p-8 text-center text-sm text-muted-foreground">
        <FileText aria-hidden className="size-8" />
        <b className="text-foreground">{t("emptyTitle")}</b>
        <span>{later ? t("notReady") : t("emptyBody")}</span>
      </div>
    )
  } else {
    body = (
      <div
        ref={box}
        tabIndex={0}
        aria-label={t("textAria")}
        className="max-h-[50vh] space-y-2 overflow-auto p-3 text-sm leading-relaxed outline-none focus-visible:ring-2 focus-visible:ring-ring"
      >
        {lines.map((l, i) => (
          <p key={i} className={l.text === "" && !l.stamp ? "h-2" : undefined}>
            {l.stamp &&
              (onSeek && l.seconds !== null ? (
                <Hint label={t("seekTip", { time: l.stamp })} className="mr-2 align-baseline">
                  <Button
                    type="button"
                    variant="outline"
                    size="xs"
                    aria-label={t("seek", { time: l.stamp })}
                    onClick={() => onSeek(l.seconds!)}
                    className="tabular-nums"
                  >
                    {l.stamp}
                  </Button>
                </Hint>
              ) : (
                <span className="mr-2 rounded-md border border-border px-1.5 py-0.5 text-xs tabular-nums text-muted-foreground">{l.stamp}</span>
              ))}
            {splitMatches(l.text, query).map((p, j) => {
              if (!p.match) return <span key={j}>{p.value}</span>
              counter++
              const current = counter === cur
              return (
                <mark
                  key={j}
                  data-current={current ? "true" : undefined}
                  className={current ? "rounded bg-amber-300 px-0.5 text-foreground ring-2 ring-ring dark:bg-amber-500/60" : "rounded bg-amber-100 px-0.5 text-foreground dark:bg-amber-500/25"}
                >
                  {p.value}
                </mark>
              )
            })}
          </p>
        ))}
      </div>
    )
  }

  const chars = (data?.totalChars ?? 0).toLocaleString(locale)

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-w-[calc(100%-2rem)] sm:max-w-3xl">
        <DialogHeader>
          <DialogTitle className="flex items-center gap-2">
            {t("title")}
            {data?.source && (
              <span className="rounded-full bg-muted px-2 py-0.5 text-xs font-medium text-muted-foreground">{ti(`sources.${data.source}`)}</span>
            )}
          </DialogTitle>
          <DialogDescription className="flex items-center gap-1.5 truncate text-xs">
            <FileText aria-hidden className="size-3.5 shrink-0" />
            <span className="truncate">{t("readOnly", { name })}</span>
          </DialogDescription>
        </DialogHeader>

        <div className="flex flex-wrap items-center gap-2">
          <div className="relative min-w-40 flex-1">
            <Search aria-hidden className="pointer-events-none absolute top-1/2 left-2 size-4 -translate-y-1/2 text-muted-foreground" />
            <Hint label={noTools ?? t("searchTip")} className="block w-full">
              <Input
                type="search"
                value={query}
                disabled={!hasText}
                placeholder={t("search")}
                aria-label={t("search")}
                onChange={(e) => setQuery(e.target.value)}
                onKeyDown={(e) => {
                  if (e.key === "Enter") {
                    e.preventDefault()
                    go(e.shiftKey ? -1 : 1)
                  }
                }}
                className="pl-8"
              />
            </Hint>
          </div>
          <span aria-live="polite" className="min-w-16 text-xs text-muted-foreground">
            {hasText && query.trim() ? (total ? t("count", { current: Math.min(cur + 1, total), total }) : t("noResult")) : ""}
          </span>
          <ActionButton id="prevMatch" onAction={() => go(-1)} disabledReason={noMatch} />
          <ActionButton id="nextMatch" onAction={() => go(1)} disabledReason={noMatch} />
          <ActionButton id="copyText" onAction={() => void copy()} disabledReason={noTools} showLabel size="sm" variant="outline" tipAlign="end" />
        </div>

        <div className="rounded-md border border-border bg-muted/30">{body}</div>

        {hasText && (
          <p className="flex items-center gap-1.5 text-xs text-muted-foreground">
            {data?.truncated ? (
              <>
                <AlertTriangle aria-hidden className="size-3.5" />
                {t("truncated", { max: MAX_TEXT_CHARS.toLocaleString(locale) })}
              </>
            ) : transcript ? (
              t("transcriptNote", { count: chars })
            ) : (
              t("chars", { count: chars })
            )}
          </p>
        )}
      </DialogContent>
    </Dialog>
  )
}
