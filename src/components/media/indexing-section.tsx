"use client"

import { useState, type ReactNode } from "react"
import { useLocale, useTranslations } from "next-intl"
import { toast } from "sonner"
import { AlertTriangle, Check, Clock, Info, Loader2, ShieldOff } from "lucide-react"
import { Link } from "@/i18n/routing"
import { Hint } from "@/components/ui/hint"
import { Skeleton } from "@/components/ui/skeleton"
import { useCurrentUser } from "@/hooks/use-session"
import { MAX_TEXT_CHARS } from "@/lib/media/ai/limits"
import { LIBRARY_ACTIONS } from "@/lib/media/actions"
import { ActionButton } from "./action-button"
import { ExtractedTextDialog } from "./extracted-text-dialog"
import { useMediaText, type MediaTextView } from "./use-media-text"

type Props = {
  mediaId: string
  canWrite: boolean
  /** Nom affiché dans le panneau de texte extrait. */
  name?: string
}

type Tone = "ok" | "wait" | "warn" | "bad" | "off"
type View = {
  tone: Tone
  icon: ReactNode
  badge: string
  body: ReactNode
  /** Le bouton principal de relance s'appelle « Réessayer » (état d'attente anormal ou échec). */
  retry: boolean
}

const TONE: Record<Tone, string> = {
  ok: "bg-emerald-100 text-emerald-900 dark:bg-emerald-950 dark:text-emerald-200",
  wait: "bg-sky-100 text-sky-900 dark:bg-sky-950 dark:text-sky-200",
  warn: "bg-amber-100 text-amber-900 dark:bg-amber-950 dark:text-amber-200",
  bad: "bg-red-100 text-red-900 dark:bg-red-950 dark:text-red-200",
  off: "bg-muted text-muted-foreground",
}

function Row({ label, children }: { label: string; children: ReactNode }) {
  return (
    <div className="flex justify-between gap-3 text-xs">
      <dt className="shrink-0 text-muted-foreground">{label}</dt>
      <dd className="min-w-0 truncate text-right">{children}</dd>
    </div>
  )
}

/** Section « Texte indexé » de la fiche média : état, relance, lecture du texte extrait. */
export function IndexingSection({ mediaId, canWrite, name }: Props) {
  const t = useTranslations("library.indexing")
  const locale = useLocale()
  const user = useCurrentUser()
  const isAdmin = user?.globalRole === "admin" || user?.globalRole === "super_admin"
  const state = useMediaText(mediaId, { poll: true })
  const [textOpen, setTextOpen] = useState(false)
  const [busy, setBusy] = useState(false)

  if (state.phase === "ready" && state.data.status === "unsupported") return null

  const title = (
    <h3 className="text-xs font-semibold uppercase tracking-wide text-muted-foreground">{t("title")}</h3>
  )

  if (state.phase === "loading") {
    return (
      <section aria-label={t("title")} className="space-y-2 border-t border-border p-3">
        {title}
        <div role="status" aria-label={t("loading")} className="space-y-2">
          <Skeleton className="h-5 w-24" />
          <Skeleton className="h-4 w-full" />
        </div>
      </section>
    )
  }

  if (state.phase === "error") {
    return (
      <section aria-label={t("title")} className="space-y-2 border-t border-border p-3">
        {title}
        <div role="alert" className="space-y-2 rounded-md border border-destructive/40 bg-destructive/5 p-2 text-xs">
          <p className="font-medium">{t("loadError")}</p>
          <p className="text-muted-foreground">{t("loadErrorBody")}</p>
          <ActionButton
            id="retryIndex"
            onAction={state.retry}
            showLabel
            size="sm"
            variant="outline"
          />
        </div>
      </section>
    )
  }

  const data = state.data
  const view = describe(data, t, locale, isAdmin)

  const reindex = async () => {
    setBusy(true)
    try {
      const res = await fetch(`/api/media/${mediaId}/reindex`, { method: "POST" })
      if (res.ok) {
        toast.success(t("toast.queued"))
        state.refresh()
        return
      }
      const body = (await res.json().catch(() => ({}))) as { code?: string }
      if (res.status === 403) toast.error(t("toast.readOnly"))
      else if (res.status === 409 || body.code === "index_disabled") toast.error(t("toast.disabled"))
      else if (res.status === 429 && body.code === "daily_cap") toast.error(t("toast.dailyCap"))
      else if (res.status === 429) toast.error(t("toast.rate"))
      else toast.error(t("toast.failed"))
      state.refresh()
    } catch {
      toast.error(t("toast.failed"))
    } finally {
      setBusy(false)
    }
  }

  const reindexReason = !canWrite
    ? t("tips.readOnly")
    : data.status === "disabled"
      ? t("tips.disabledOrg")
      : data.status === "running"
        ? t("tips.alreadyRunning")
        : data.status === "pending" && !view.retry
          ? t("tips.alreadyQueued")
          : busy
            ? t("tips.alreadyQueued")
            : undefined
  const hasText = data.status === "done" && data.totalChars > 0
  const viewReason = hasText
    ? undefined
    : data.status === "pending" || data.status === "running"
      ? t("tips.textLater")
      : t("tips.noText")

  return (
    <section aria-label={t("title")} className="space-y-2 border-t border-border p-3">
      {title}
      <div className="flex items-center gap-2" aria-live="polite">
        <span className={`inline-flex items-center gap-1 rounded-full px-2 py-0.5 text-xs font-medium ${TONE[view.tone]}`}>
          {view.icon}
          {view.badge}
        </span>
      </div>
      {view.body}
      <div className="flex flex-wrap gap-2 pt-1">
        {data.status === "disabled" && isAdmin && (
          <Hint label={t("tips.settings")}>
            <Link
              href="/admin/library"
              className="inline-flex h-7 items-center gap-1 rounded-lg border border-border bg-background px-2.5 text-[0.8rem] font-medium hover:bg-muted"
            >
              <SettingsLinkLabel />
            </Link>
          </Hint>
        )}
        <ActionButton
          id={view.retry ? "retryIndex" : "reindex"}
          onAction={() => void reindex()}
          disabledReason={reindexReason}
          showLabel
          size="sm"
          variant="outline"
        />
        <ActionButton
          id="viewText"
          onAction={() => setTextOpen(true)}
          disabledReason={viewReason}
          showLabel
          size="sm"
          variant="outline"
        />
      </div>
      {textOpen && (
        <ExtractedTextDialog mediaId={mediaId} name={name} open onOpenChange={setTextOpen} />
      )}
    </section>
  )
}

function SettingsLinkLabel() {
  const t = useTranslations()
  const Icon = LIBRARY_ACTIONS.openAiSettings.icon
  return (
    <>
      <Icon aria-hidden className="size-3.5" />
      {t(LIBRARY_ACTIONS.openAiSettings.labelKey)}
    </>
  )
}

type T = ReturnType<typeof useTranslations>

function hint(text: ReactNode) {
  return <p className="text-xs text-muted-foreground">{text}</p>
}

function describe(data: MediaTextView, t: T, locale: string, isAdmin: boolean): View {
  const icon = (I: typeof Check, spin = false) => <I aria-hidden className={`size-3.5 ${spin ? "animate-spin" : ""}`} />
  const when = (iso: string) =>
    new Intl.DateTimeFormat(locale, { day: "numeric", month: "short", year: "numeric", hour: "2-digit", minute: "2-digit" }).format(
      new Date(iso),
    )
  const reason = data.reason ?? ""

  switch (data.status) {
    case "disabled":
      return {
        tone: "off",
        icon: icon(ShieldOff),
        badge: t("badge.disabled"),
        body: hint(isAdmin ? t("body.disabledAdmin") : t("body.disabledMember")),
        retry: false,
      }
    case "running":
      return { tone: "wait", icon: icon(Loader2, true), badge: t("badge.running"), body: hint(t("body.running")), retry: false }
    case "pending":
      if (reason === "daily_quota" || reason === "ai_quota" || reason === "quota")
        return { tone: "warn", icon: icon(AlertTriangle), badge: t("badge.quota"), body: hint(t("body.quota")), retry: true }
      if (reason === "no_engine" || reason === "no_embedding")
        return { tone: "warn", icon: icon(AlertTriangle), badge: t("badge.noEngine"), body: hint(t("body.noEngine")), retry: true }
      if (reason === "daily_cap")
        return { tone: "warn", icon: icon(AlertTriangle), badge: t("badge.dailyCap"), body: hint(t("body.dailyCap")), retry: true }
      return { tone: "wait", icon: icon(Clock), badge: t("badge.pending"), body: hint(t("body.pending")), retry: false }
    case "failed":
      return { tone: "bad", icon: icon(AlertTriangle), badge: t("badge.failed"), body: hint(t("body.failed")), retry: true }
    case "skipped": {
      if (reason === "empty")
        return { tone: "warn", icon: icon(Info), badge: t("badge.empty"), body: hint(t("body.empty")), retry: false }
      if (reason === "too_large")
        return { tone: "warn", icon: icon(AlertTriangle), badge: t("badge.tooLarge"), body: hint(t("body.tooLarge")), retry: false }
      if (reason === "too_long")
        return { tone: "warn", icon: icon(AlertTriangle), badge: t("badge.tooLong"), body: hint(t("body.tooLong")), retry: false }
      if (reason === "no_audio")
        return { tone: "warn", icon: icon(AlertTriangle), badge: t("badge.noAudio"), body: hint(t("body.noAudio")), retry: false }
      if (reason === "disabled")
        return { tone: "off", icon: icon(ShieldOff), badge: t("badge.disabled"), body: hint(t("body.disabledMember")), retry: false }
      return { tone: "warn", icon: icon(Info), badge: t("badge.skipped"), body: hint(t("body.skippedGeneric")), retry: false }
    }
    default: {
      const src = data.source ? t(`sources.${data.source}`) : null
      return {
        tone: "ok",
        icon: icon(Check),
        badge: t("badge.done"),
        retry: false,
        body: (
          <div className="space-y-1.5">
            {data.indexedAt && hint(t("body.doneAt", { date: when(data.indexedAt) }))}
            <dl className="space-y-1.5">
              {src && <Row label={t("body.source")}>{src}</Row>}
              <Row label={t("body.chars")}>{t("body.charsValue", { count: data.totalChars.toLocaleString(locale) })}</Row>
            </dl>
            {data.truncated && (
              <div className="flex items-start gap-1.5 rounded-md bg-amber-50 p-2 text-xs text-amber-900 dark:bg-amber-950 dark:text-amber-200">
                <AlertTriangle aria-hidden className="mt-0.5 size-3.5 shrink-0" />
                <span>{t("body.truncated", { max: MAX_TEXT_CHARS.toLocaleString(locale) })}</span>
              </div>
            )}
            {data.source === "exif" && hint(t("body.gps"))}
          </div>
        ),
      }
    }
  }
}
