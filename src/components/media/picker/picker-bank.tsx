"use client"

import { useCallback, useEffect, useId, useRef, useState, type FormEvent } from "react"
import { useTranslations } from "next-intl"
import { toast } from "sonner"
import { Input } from "@/components/ui/input"
import { Label } from "@/components/ui/label"
import { cn } from "@/lib/utils"
import { ActionButton } from "../action-button"
import { importRemote } from "./import-api"
import { toPicked } from "./picker-library"
import type { ImportGuard } from "./use-picker-session"
import type { PickerSelection } from "./use-picker-selection"

type Provider = { name: string; displayName: string; providerType: string; isEnabled: boolean }
type Result = {
  id: string
  thumb: string
  regular: string
  description: string
  credit: string
  downloadLocation?: string
}

type Props = {
  mode: "single" | "multiple"
  spaceId?: string | null
  picker: PickerSelection
  /** État d'import porté par le corps : il survit au changement d'onglet. */
  imports: ImportGuard
  onImported: () => void
}

/** Onglet Banque d'images : recherche chez les fournisseurs de l'organisation, import par clic. */
export function PickerBank({ mode, spaceId, picker, imports, onImported }: Props) {
  const t = useTranslations("library.picker")
  const te = useTranslations("library.picker.errors")
  const translateError = (code: string) => (te.has(code) ? te(code) : null)
  const ids = useId()
  const [providers, setProviders] = useState<Provider[] | null>(null)
  const [active, setActive] = useState("")
  const [query, setQuery] = useState("")
  const [results, setResults] = useState<Result[]>([])
  const [searching, setSearching] = useState(false)
  const [searchError, setSearchError] = useState(false)
  const searchSeq = useRef(0)
  const [importingId, setImportingId] = useState<string | null>(null)
  const [error, setError] = useState<string | null>(null)

  useEffect(() => {
    let cancelled = false
    fetch("/api/admin/image-providers")
      .then((r) => (r.ok ? r.json() : []))
      .then((data: Provider[]) => {
        if (cancelled) return
        const enabled = Array.isArray(data) ? data.filter((p) => p.isEnabled && p.providerType !== "custom") : []
        setProviders(enabled)
        if (enabled[0]) setActive(enabled[0].name)
      })
      .catch(() => !cancelled && setProviders([]))
    return () => {
      cancelled = true
    }
  }, [])

  const search = useCallback(
    async (provider: string, q: string) => {
      if (!provider) return
      // Garde de requête : seule la recherche la plus récente peut écrire l'état.
      const seq = ++searchSeq.current
      setSearching(true)
      setSearchError(false)
      try {
        const params = new URLSearchParams({ provider })
        if (q) params.set("q", q)
        const res = await fetch(`/api/images/search?${params}`)
        if (!res.ok) throw new Error(`HTTP ${res.status}`)
        const data = (await res.json()) as { results?: Result[] }
        if (seq !== searchSeq.current) return
        setResults(data.results ?? [])
      } catch {
        if (seq !== searchSeq.current) return
        setResults([])
        setSearchError(true)
      } finally {
        if (seq === searchSeq.current) setSearching(false)
      }
    },
    []
  )

  useEffect(() => {
    if (active) void search(active, "")
  }, [active, search])

  const pick = async (img: Result) => {
    const signal = imports.begin()
    if (!signal) return
    setImportingId(img.id)
    setError(null)
    try {
      const media = await importRemote(
        { url: img.regular, origin: "stock", spaceId: spaceId ?? null, displayName: img.description?.slice(0, 120) || undefined },
        t("importFailed"),
        translateError,
        signal
      )
      // Sélecteur fermé pendant l'import : le résultat est ignoré.
      if (signal.aborted) return
      if (img.downloadLocation) {
        // Notification de téléchargement exigée par la banque ; sans effet sur l'import.
        fetch(`/api/studio/unsplash/track?url=${encodeURIComponent(img.downloadLocation)}`).catch(() => {})
      }
      if (!picker.isSelected(media.id) && !(mode === "multiple" && picker.atMax)) picker.toggle(toPicked(media))
      toast.success(t("imported"))
      onImported()
    } catch (err) {
      if (signal.aborted) return
      setError(err instanceof Error ? err.message : t("importFailed"))
    } finally {
      setImportingId(null)
      imports.end(signal)
    }
  }

  const onSubmit = (e: FormEvent) => {
    e.preventDefault()
    void search(active, query.trim())
  }

  if (providers === null) {
    return (
      <p role="status" className="p-4 text-sm text-muted-foreground">
        {t("bankSearching")}
      </p>
    )
  }
  if (providers.length === 0) {
    return <p className="p-4 text-sm text-muted-foreground">{t("bankNoProvider")}</p>
  }

  return (
    <div className="flex min-h-0 flex-1 flex-col gap-3 overflow-y-auto p-4">
      <form onSubmit={onSubmit} className="flex items-end gap-2">
        {providers.length > 1 ? (
          <div className="grid gap-1.5">
            <Label htmlFor={`${ids}-provider`}>{t("bankProvider")}</Label>
            <select
              id={`${ids}-provider`}
              className="h-8 rounded-lg border border-input bg-transparent px-2.5 text-sm outline-none focus-visible:ring-3 focus-visible:ring-ring/50"
              value={active}
              onChange={(e) => setActive(e.target.value)}
            >
              {providers.map((p) => (
                <option key={p.name} value={p.name}>
                  {p.displayName}
                </option>
              ))}
            </select>
          </div>
        ) : null}
        <div className="grid min-w-0 flex-1 gap-1.5">
          <Label htmlFor={`${ids}-q`}>{t("bankSearchLabel")}</Label>
          <Input id={`${ids}-q`} value={query} placeholder={t("bankSearchPlaceholder")} onChange={(e) => setQuery(e.target.value)} />
        </div>
        <ActionButton
          id="pickerSearchBank"
          variant="outline"
          disabledReason={searching ? t("bankSearching") : undefined}
          onAction={() => void search(active, query.trim())}
        />
      </form>

      {error ? (
        <p role="alert" className="text-sm text-destructive">
          {error}
        </p>
      ) : null}
      {searchError ? (
        <p role="alert" className="text-sm text-destructive">
          {t("bankSearchFailed")}
        </p>
      ) : null}
      {searching ? (
        <p role="status" className="text-sm text-muted-foreground">
          {t("bankSearching")}
        </p>
      ) : null}
      {!searching && !searchError && results.length === 0 ? (
        <p className="text-sm text-muted-foreground">{t("bankNoResults")}</p>
      ) : null}

      <ul className="grid grid-cols-[repeat(auto-fill,minmax(120px,1fr))] gap-2" aria-label={t("bankResults")}>
        {results.map((img) => {
          const label = t("bankImport", { name: img.description || img.credit })
          return (
            <li key={img.id}>
              {/* Tuile sélectionnable : même gabarit pour tous les résultats. */}
              <button
                type="button"
                data-action-exempt
                aria-label={label}
                title={label}
                aria-busy={importingId === img.id}
                disabled={imports.busy || importingId !== null}
                onClick={() => void pick(img)}
                className={cn(
                  "block aspect-square w-full overflow-hidden rounded-md border border-border outline-none focus-visible:ring-2 focus-visible:ring-ring",
                  importingId === img.id ? "opacity-60" : "hover:border-primary"
                )}
              >
                {/* eslint-disable-next-line @next/next/no-img-element */}
                <img
                  src={`/api/images/proxy?url=${encodeURIComponent(img.thumb)}`}
                  alt=""
                  loading="lazy"
                  className="h-full w-full object-cover"
                />
              </button>
            </li>
          )
        })}
      </ul>
    </div>
  )
}
