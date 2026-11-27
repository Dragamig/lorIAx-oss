"use client"

import { useTranslations } from "next-intl"
import { ChevronRight } from "lucide-react"
import type { MediaDetail } from "@/lib/media/metadata"
import { mediaThumbnailUrl } from "@/lib/media/urls"

type Props = { detail: MediaDetail; onOpen?: (id: string) => void }

function Row({
  label,
  hint,
  thumb,
  onOpen,
  openLabel,
}: {
  label: string
  hint?: string
  thumb?: string | null
  onOpen?: () => void
  openLabel: string
}) {
  const body = (
    <>
      {thumb ? (
        // eslint-disable-next-line @next/next/no-img-element
        <img src={thumb} alt="" className="size-8 shrink-0 rounded object-cover" />
      ) : null}
      <span className="min-w-0 flex-1 text-left">
        <span className="block truncate text-sm">{label}</span>
        {hint ? <span className="block truncate text-xs text-muted-foreground">{hint}</span> : null}
      </span>
      {onOpen ? <ChevronRight className="size-4 shrink-0 text-muted-foreground" aria-hidden="true" /> : null}
    </>
  )
  const box = "flex w-full items-center gap-2 rounded-md border border-border px-2 py-1.5"
  if (!onOpen) return <div className={box}>{body}</div>
  return (
    // Ligne de lien vers un autre média : l'action « ouvrir » n'a pas de libellé propre au registre.
    <button
      type="button"
      data-action-exempt
      aria-label={openLabel}
      title={openLabel}
      onClick={onOpen}
      className={`${box} hover:bg-accent focus-visible:ring-2 focus-visible:ring-ring focus-visible:outline-none`}
    >
      {body}
    </button>
  )
}

/** « Retouché depuis » (dérivé) et « Retouches (n) » (original) : seuls les médias lisibles sont nommés ou comptés. */
export function RetouchLinks({ detail, onOpen }: Props) {
  const t = useTranslations("library.retouch")
  const from = detail.retouchedFrom ?? null
  const list = detail.retouches ?? []
  if (!from && list.length === 0) return null
  return (
    <>
      {from ? (
        <section aria-label={t("link.from")} className="space-y-2 border-t border-border p-3">
          <h3 className="text-xs font-semibold uppercase tracking-wide text-muted-foreground">{t("link.from")}</h3>
          {from.readable ? (
            <Row
              label={from.name}
              hint={t("link.fromMeta", { version: String(from.version) })}
              thumb={mediaThumbnailUrl({ id: from.id, currentVersion: from.version })}
              openLabel={t("link.open", { name: from.name })}
              onOpen={onOpen ? () => onOpen(from.id) : undefined}
            />
          ) : (
            <p className="text-xs text-muted-foreground">{t("link.fromHidden")}</p>
          )}
        </section>
      ) : null}
      {list.length > 0 ? (
        <section aria-label={t("link.retouches", { count: String(list.length) })} className="space-y-2 border-t border-border p-3">
          <h3 className="text-xs font-semibold uppercase tracking-wide text-muted-foreground">
            {t("link.retouches", { count: String(list.length) })}
          </h3>
          <ul className="space-y-1.5">
            {list.map((r) => (
              <li key={r.id}>
                <Row
                  label={r.name}
                  thumb={r.thumbnailUrl}
                  openLabel={t("link.open", { name: r.name })}
                  onOpen={onOpen ? () => onOpen(r.id) : undefined}
                />
              </li>
            ))}
          </ul>
        </section>
      ) : null}
    </>
  )
}
