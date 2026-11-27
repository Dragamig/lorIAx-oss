"use client"

import { useCallback, useEffect, useState } from "react"
import { useLocale, useTranslations } from "next-intl"
import { toast } from "sonner"
import { AlertTriangle, FileText, Loader2, ShieldAlert, Sparkles } from "lucide-react"
import { Dialog, DialogContent, DialogFooter, DialogHeader, DialogTitle } from "@/components/ui/dialog"
import { Hint } from "@/components/ui/hint"
import { Skeleton } from "@/components/ui/skeleton"
import { Switch } from "@/components/ui/switch"
import { ActionButton } from "@/components/media/action-button"
import { formatMediaSize } from "@/components/media/media-format"
import {
  MAX_EXTRACT_BYTES,
  MAX_TEXT_CHARS,
  MAX_TRANSCRIBE_SECONDS,
  ORG_DAILY_MEDIA_MAX,
  ORG_DAILY_TRANSCRIBE_MINUTES,
} from "@/lib/media/ai/limits"

/** Un bloc de recherche pèse environ 1 000 caractères, soit de l'ordre de 250 jetons. */
const TOKENS_PER_CHUNK = 250

type AiData = {
  indexEnabled: boolean
  transcribeEnabled: boolean
  embeddingConfigured: boolean
  whisperAvailable: boolean
  pending: number
  indexed: number
  failed: number
  estimate: { media: number; chunks: number; audioVideo: number }
}

type Pending = "index" | "trans" | "clear" | null

/** Section « IA » de l'administration de la médiathèque : interrupteurs par organisation. */
export function MediaAiSettings() {
  const t = useTranslations("library.aiAdmin")
  const locale = useLocale()
  const [data, setData] = useState<AiData | null>(null)
  const [failed, setFailed] = useState(false)
  const [saving, setSaving] = useState(false)
  const [dialog, setDialog] = useState<Pending>(null)

  const load = useCallback(async (silent = false) => {
    if (!silent) {
      setFailed(false)
      setData(null)
    }
    try {
      const res = await fetch("/api/admin/library/ai")
      if (!res.ok) throw new Error(String(res.status))
      setData((await res.json()) as AiData)
    } catch {
      if (!silent) setFailed(true)
    }
  }, [])

  useEffect(() => {
    void load()
  }, [load])

  /** Écrit un réglage ; ne touche l'état local qu'après confirmation du serveur. */
  const put = useCallback(async (patch: { indexEnabled?: boolean; transcribeEnabled?: boolean }): Promise<boolean> => {
    setSaving(true)
    try {
      const res = await fetch("/api/admin/library/ai", {
        method: "PUT",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(patch),
      })
      if (!res.ok) return false
      const next = (await res.json()) as { indexEnabled: boolean; transcribeEnabled: boolean }
      setData((d) => (d ? { ...d, indexEnabled: next.indexEnabled, transcribeEnabled: next.transcribeEnabled } : d))
      void load(true)
      return true
    } catch {
      return false
    } finally {
      setSaving(false)
    }
  }, [load])

  const apply = async (kind: "index" | "trans", enabled: boolean) => {
    const key = kind === "index" ? "indexEnabled" : "transcribeEnabled"
    const prevIndex = data?.indexEnabled ?? false
    const prevTrans = data?.transcribeEnabled ?? false
    const ok = await put({ [key]: enabled })
    if (!ok) {
      toast.error(t("toastSaveFailed"))
      return
    }
    const message = kind === "index" ? (enabled ? t("toastIndexOn") : t("toastIndexOff")) : enabled ? t("toastTransOn") : t("toastTransOff")
    toast.success(message, {
      action: {
        label: t("toastUndo"),
        onClick: () => {
          void put({ indexEnabled: prevIndex, transcribeEnabled: prevTrans }).then((done) =>
            done ? toast.success(t("toastUndone")) : toast.error(t("toastSaveFailed")),
          )
        },
      },
    })
  }

  const clearIndex = async () => {
    setSaving(true)
    try {
      const res = await fetch("/api/admin/library/ai", { method: "DELETE" })
      if (!res.ok) throw new Error(String(res.status))
      toast.success(t("toastCleared"))
      void load(true)
    } catch {
      toast.error(t("toastClearFailed"))
    } finally {
      setSaving(false)
    }
  }

  const header = (clearReason?: string) => (
    <header className="flex items-center gap-2 border-b border-border px-4 py-3">
      <Sparkles aria-hidden className="size-4 text-muted-foreground" />
      <h2 className="flex-1 text-base font-semibold">{t("title")}</h2>
      <ActionButton
        id="clearAiIndex"
        onAction={() => setDialog("clear")}
        disabledReason={clearReason}
        showLabel
        size="sm"
        variant="outline"
        tipAlign="end"
      />
    </header>
  )

  if (failed) {
    return (
      <section aria-label={t("title")} className="rounded-xl border border-border">
        {header(t("tipClearNone"))}
        <div role="alert" className="m-4 flex items-start gap-3 rounded-lg border border-destructive/40 bg-destructive/5 p-4">
          <AlertTriangle aria-hidden className="mt-0.5 size-4 shrink-0 text-destructive" />
          <div className="space-y-2 text-sm">
            <p className="font-medium">{t("loadError")}</p>
            <p className="text-muted-foreground">{t("loadErrorBody")}</p>
            <ActionButton id="retryIndex" onAction={() => void load()} showLabel size="sm" variant="outline" />
          </div>
        </div>
      </section>
    )
  }

  if (!data) {
    return (
      <section aria-label={t("title")} className="rounded-xl border border-border">
        {header(t("tipClearBusy"))}
        <div role="status" aria-label={t("loading")} className="space-y-3 p-4">
          <Skeleton className="h-16 w-full" />
          <Skeleton className="h-16 w-full" />
          <Skeleton className="h-20 w-full" />
        </div>
      </section>
    )
  }

  const noEmbedding = !data.embeddingConfigured
  const compact = new Intl.NumberFormat(locale, { notation: "compact", maximumFractionDigits: 1 })
  const tokens = compact.format(data.estimate.chunks * TOKENS_PER_CHUNK)
  const num = (n: number) => n.toLocaleString(locale)

  const indexTip = noEmbedding
    ? t("tipNoEmbedding")
    : saving
      ? t("tipSaving")
      : data.indexEnabled
        ? t("tipDisableIndex")
        : t("tipEnableIndex")
  const transBlock = noEmbedding
    ? t("tipNoEmbedding")
    : !data.indexEnabled
      ? t("tipNeedIndex")
      : !data.whisperAvailable
        ? t("tipNoWhisper")
        : undefined
  const transTip = transBlock ?? (saving ? t("tipSaving") : data.transcribeEnabled ? t("tipDisableTrans") : t("tipEnableTrans"))

  const total = data.indexed + data.pending
  const percent = total > 0 ? Math.round((data.indexed / total) * 100) : 0
  const clearReason = saving ? t("tipClearBusy") : data.indexed + data.pending + data.failed === 0 ? t("tipClearNone") : undefined

  return (
    <section aria-label={t("title")} className="rounded-xl border border-border">
      {header(clearReason)}

      <div className="divide-y divide-border">
        <div className="flex items-start gap-4 px-4 py-3">
          <div className="min-w-0 flex-1 space-y-1">
            <p className="text-sm font-semibold">{t("indexTitle")}</p>
            <p className="text-sm text-muted-foreground">
              {t("indexDesc")} <span className="text-foreground">{t("indexCost", { tokens })}</span>
            </p>
          </div>
          <Hint label={indexTip} disabled={noEmbedding} align="end">
            <Switch
              checked={data.indexEnabled}
              disabled={noEmbedding || saving}
              aria-label={t("indexLabel")}
              onCheckedChange={(on) => (on ? setDialog("index") : void apply("index", false))}
            />
          </Hint>
        </div>
        {noEmbedding && (
          <div role="alert" className="flex items-start gap-2 bg-destructive/5 px-4 py-2 text-sm">
            <AlertTriangle aria-hidden className="mt-0.5 size-4 shrink-0 text-destructive" />
            {t("noEmbedding")}
          </div>
        )}

        <div className="flex items-start gap-4 px-4 py-3">
          <div className="min-w-0 flex-1 space-y-1">
            <p className="text-sm font-semibold">{t("transTitle")}</p>
            <p className="text-sm text-muted-foreground">
              {t("transDesc")} <span className="text-foreground">{t("transCost", { minutes: ORG_DAILY_TRANSCRIBE_MINUTES })}</span>
            </p>
          </div>
          <Hint label={transTip} disabled={Boolean(transBlock)} align="end">
            <Switch
              checked={data.transcribeEnabled}
              disabled={Boolean(transBlock) || saving}
              aria-label={t("transLabel")}
              onCheckedChange={(on) => (on ? setDialog("trans") : void apply("trans", false))}
            />
          </Hint>
        </div>
        {data.indexEnabled && !data.whisperAvailable && (
          <div role="alert" className="flex items-start gap-2 bg-destructive/5 px-4 py-2 text-sm">
            <AlertTriangle aria-hidden className="mt-0.5 size-4 shrink-0 text-destructive" />
            {t("noWhisper")}
          </div>
        )}

        {data.indexEnabled && data.pending > 0 && (
          <div role="status" className="px-4 py-3">
            <div className="space-y-2 rounded-lg border border-sky-300 bg-sky-50 p-3 text-sm dark:border-sky-800 dark:bg-sky-950/40">
              <p className="flex items-center gap-2">
                <Loader2 aria-hidden className="size-4 animate-spin" />
                {t("catchup", { indexed: num(data.indexed), pending: num(data.pending) })}
              </p>
              <div
                role="progressbar"
                aria-label={t("catchupBar")}
                aria-valuemin={0}
                aria-valuemax={100}
                aria-valuenow={percent}
                className="h-1.5 max-w-60 overflow-hidden rounded-full bg-muted"
              >
                <div className="h-full rounded-full bg-primary" style={{ width: `${percent}%` }} />
              </div>
            </div>
          </div>
        )}

        <div className="space-y-3 px-4 py-3">
          {data.estimate.media === 0 && data.indexed + data.pending + data.failed === 0 ? (
            <div className="flex flex-col items-center gap-1 py-4 text-center text-sm text-muted-foreground">
              <FileText aria-hidden className="size-6" />
              <b className="text-foreground">{t("emptyTitle")}</b>
              <span>{t("emptyBody")}</span>
            </div>
          ) : (
            <dl className="grid grid-cols-3 gap-3">
              {(
                [
                  ["statIndexed", data.indexEnabled ? data.indexed : 0],
                  ["statPending", data.indexEnabled ? data.pending : 0],
                  ["statFailed", data.indexEnabled ? data.failed : 0],
                ] as const
              ).map(([k, v]) => (
                <div key={k} className="rounded-lg border border-border bg-muted/40 p-3">
                  <dd className="text-xl font-semibold tabular-nums">{num(v)}</dd>
                  <dt className="text-xs text-muted-foreground">{t(k)}</dt>
                </div>
              ))}
            </dl>
          )}
          <dl className="space-y-1 text-sm">
            {(
              [
                ["limDailyMedia", t("limDailyMediaValue", { n: num(ORG_DAILY_MEDIA_MAX) })],
                ["limDailyTrans", t("limDailyTransValue", { n: num(ORG_DAILY_TRANSCRIBE_MINUTES) })],
                ["limFileSize", t("limFileSizeValue", { size: formatMediaSize(MAX_EXTRACT_BYTES, locale) })],
                ["limDuration", t("limDurationValue", { n: num(MAX_TRANSCRIBE_SECONDS / 60) })],
                ["limText", t("limTextValue", { n: num(MAX_TEXT_CHARS) })],
              ] as const
            ).map(([k, v]) => (
              <div key={k} className="flex justify-between gap-3">
                <dt className="text-muted-foreground">{t(k)}</dt>
                <dd className="text-right">{v}</dd>
              </div>
            ))}
          </dl>
        </div>
      </div>

      <Dialog open={dialog === "index" || dialog === "trans"} onOpenChange={(o) => !o && setDialog(null)}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>{dialog === "trans" ? t("dialogTransTitle") : t("dialogIndexTitle")}</DialogTitle>
          </DialogHeader>
          <div className="space-y-3 text-sm">
            <dl className="divide-y divide-border rounded-lg border border-border">
              {(dialog === "trans"
                ? ([
                    ["kvAv", num(data.estimate.audioVideo)],
                    ["kvAvCap", t("kvAvCapValue", { n: num(ORG_DAILY_TRANSCRIBE_MINUTES) })],
                  ] as const)
                : ([
                    ["kvMedia", num(data.estimate.media)],
                    ["kvChunks", num(data.estimate.chunks)],
                    ["kvTokens", tokens],
                  ] as const)
              ).map(([k, v]) => (
                <div key={k} className="flex justify-between gap-3 px-3 py-2">
                  <dt className="text-muted-foreground">{t(k)}</dt>
                  <dd className="font-medium tabular-nums">{v}</dd>
                </div>
              ))}
            </dl>
            {dialog === "trans" ? (
              <p className="flex items-start gap-2 rounded-lg bg-amber-50 p-3 text-amber-900 dark:bg-amber-950 dark:text-amber-200">
                <ShieldAlert aria-hidden className="mt-0.5 size-4 shrink-0" />
                {t("dialogTransNote")}
              </p>
            ) : (
              <p>{t("dialogIndexNote")}</p>
            )}
          </div>
          <DialogFooter>
            <ActionButton id="cancelAi" onAction={() => setDialog(null)} showLabel variant="outline" label={t("cancel")} />
            <ActionButton
              id="activateAi"
              showLabel
              variant="default"
              disabledReason={saving ? t("tipSaving") : undefined}
              onAction={() => {
                const kind = dialog === "trans" ? "trans" : "index"
                setDialog(null)
                void apply(kind, true)
              }}
            />
          </DialogFooter>
        </DialogContent>
      </Dialog>

      <Dialog open={dialog === "clear"} onOpenChange={(o) => !o && setDialog(null)}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>{t("dialogClearTitle")}</DialogTitle>
          </DialogHeader>
          <p className="text-sm">{t("dialogClearBody", { count: num(data.indexed) })}</p>
          <DialogFooter>
            <ActionButton id="cancelAi" onAction={() => setDialog(null)} showLabel variant="outline" label={t("cancel")} />
            <ActionButton
              id="confirmClearAi"
              showLabel
              variant="destructive"
              onAction={() => {
                setDialog(null)
                void clearIndex()
              }}
            />
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </section>
  )
}
