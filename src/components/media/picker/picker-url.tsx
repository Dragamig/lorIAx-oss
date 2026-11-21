"use client"

import { useId, useMemo, useState, type FormEvent } from "react"
import { useTranslations } from "next-intl"
import useSWR from "swr"
import { toast } from "sonner"
import { Input } from "@/components/ui/input"
import { Label } from "@/components/ui/label"
import { ActionButton } from "../action-button"
import { importRemote } from "./import-api"
import { toPicked } from "./picker-library"
import type { ImportGuard } from "./use-picker-session"
import type { PickerSelection } from "./use-picker-selection"

const selectClass =
  "h-8 w-full rounded-lg border border-input bg-transparent px-2.5 text-sm outline-none focus-visible:border-ring focus-visible:ring-3 focus-visible:ring-ring/50"

async function fetchJson<T>(url: string): Promise<T> {
  const res = await fetch(url)
  if (!res.ok) throw new Error(`HTTP ${res.status}`)
  return (await res.json()) as T
}

type Props = {
  mode: "single" | "multiple"
  spaceId?: string | null
  picker: PickerSelection
  /** État d'import porté par le corps : il survit au changement d'onglet. */
  imports: ImportGuard
  /** Appelé quand l'image importée a été sélectionnée : retour sur la Médiathèque si l'onglet est resté actif. */
  onImported: () => void
}

/** Onglet URL : copie une image distante dans la médiathèque, puis la sélectionne. */
export function PickerUrl({ mode, spaceId, picker, imports, onImported }: Props) {
  const t = useTranslations("library.picker")
  const te = useTranslations("library.picker.errors")
  const translateError = (code: string) => (te.has(code) ? te(code) : null)
  const ids = useId()
  const [url, setUrl] = useState("")
  const busy = imports.busy
  const [error, setError] = useState<string | null>(null)
  const [chosenSpace, setChosenSpace] = useState("")
  const spaceData = useSWR<{ id: string; name: string }[]>(spaceId ? null : "/api/spaces", fetchJson, {
    revalidateOnFocus: false,
  })
  const spaces = useMemo(() => (Array.isArray(spaceData.data) ? spaceData.data : []), [spaceData.data])
  const targetSpace = spaceId || chosenSpace || spaces[0]?.id || null

  const trimmed = url.trim()
  const disabledReason = busy ? t("importing") : !trimmed ? t("urlRequired") : undefined

  const submit = async (e?: FormEvent) => {
    e?.preventDefault()
    if (disabledReason) return
    const signal = imports.begin()
    if (!signal) return
    setError(null)
    try {
      const media = await importRemote({ url: trimmed, origin: "upload", spaceId: targetSpace }, t("importFailed"), translateError, signal)
      // Sélecteur fermé pendant l'import : le résultat est ignoré.
      if (signal.aborted) return
      if (!picker.isSelected(media.id) && !(mode === "multiple" && picker.atMax)) picker.toggle(toPicked(media))
      toast.success(t("imported"))
      setUrl("")
      onImported()
    } catch (err) {
      if (signal.aborted) return
      setError(err instanceof Error ? err.message : t("importFailed"))
    } finally {
      imports.end(signal)
    }
  }

  return (
    <form onSubmit={submit} className="flex min-h-0 flex-1 flex-col gap-3 overflow-y-auto p-4">
      <div className="grid gap-1.5">
        <Label htmlFor={`${ids}-url`}>{t("urlLabel")}</Label>
        <div className="flex items-center gap-2">
          <Input
            id={`${ids}-url`}
            type="url"
            inputMode="url"
            autoFocus
            value={url}
            placeholder={t("urlPlaceholder")}
            aria-invalid={error ? true : undefined}
            aria-describedby={error ? `${ids}-err` : undefined}
            onChange={(e) => {
              setUrl(e.target.value)
              setError(null)
            }}
          />
          <ActionButton id="pickerImportUrl" variant="default" showLabel disabledReason={disabledReason} onAction={() => void submit()} />
        </div>
        <p className="text-xs text-muted-foreground">{t("urlCopyNote")}</p>
      </div>
      {!spaceId && spaces.length > 1 ? (
        <div className="grid gap-1.5">
          <Label htmlFor={`${ids}-space`}>{t("importSpace")}</Label>
          <select
            id={`${ids}-space`}
            className={selectClass}
            value={targetSpace ?? ""}
            disabled={busy}
            onChange={(e) => setChosenSpace(e.target.value)}
          >
            {spaces.map((s) => (
              <option key={s.id} value={s.id}>
                {s.name}
              </option>
            ))}
          </select>
        </div>
      ) : null}
      {busy ? (
        <p role="status" className="text-sm text-muted-foreground">
          {t("importing")}
        </p>
      ) : null}
      {error ? (
        <p id={`${ids}-err`} role="alert" className="text-sm text-destructive">
          {error}
        </p>
      ) : null}
    </form>
  )
}
