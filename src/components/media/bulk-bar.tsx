"use client"

import { useTranslations } from "next-intl"
import { ActionButton } from "./action-button"
import { ZipDownloadButton } from "./zip-download-button"

type Props = {
  selectedCount: number
  totalCount: number
  onSelectAll: () => void
  onClear: () => void
  onMove: () => void
  onTags: () => void
  onTrash: () => void
  /** Vue Corbeille : « Restaurer » remplace les actions de rangement. */
  onRestore?: () => void
  /** Effacement définitif (vue Corbeille) : fourni aux seuls admins. */
  onErase?: () => void
  /** Désactive les actions d'écriture, avec la raison en info-bulle. */
  writeDisabledReason?: string
  /** Identifiants et taille cumulée de la sélection : active « Télécharger en archive ». */
  zip?: { ids: string[]; totalBytes: number }
}

/** Barre d'actions de la sélection : visible dès qu'un média est coché. */
export function BulkBar({
  selectedCount,
  totalCount,
  onSelectAll,
  onClear,
  onMove,
  onTags,
  onTrash,
  onRestore,
  onErase,
  writeDisabledReason,
  zip,
}: Props) {
  const t = useTranslations("library.bulk")
  if (selectedCount === 0) return null
  const allSelected = totalCount > 0 && selectedCount >= totalCount

  return (
    <div
      role="toolbar"
      aria-label={t("ariaLabel")}
      className="flex flex-wrap items-center gap-1 rounded-lg border border-border bg-muted/60 px-2 py-1"
    >
      <span role="status" aria-live="polite" className="px-2 text-sm font-medium">
        {selectedCount === 1 ? t("countOne") : t("countMany", { count: String(selectedCount) })}
      </span>
      {onRestore ? (
        <>
          <ActionButton id="restore" showLabel size="sm" variant="ghost" disabledReason={writeDisabledReason} onAction={onRestore} />
          {onErase && <ActionButton id="eraseForever" showLabel size="sm" variant="ghost" onAction={onErase} />}
        </>
      ) : (
        <>
          <ActionButton id="move" showLabel size="sm" variant="ghost" disabledReason={writeDisabledReason} onAction={onMove} />
          <ActionButton id="editTags" showLabel size="sm" variant="ghost" disabledReason={writeDisabledReason} onAction={onTags} />
          <ActionButton id="trash" showLabel size="sm" variant="ghost" disabledReason={writeDisabledReason} onAction={onTrash} />
        </>
      )}
      {zip && !onRestore ? (
        <ZipDownloadButton source={{ ids: zip.ids }} fileCount={zip.ids.length} totalBytes={zip.totalBytes} />
      ) : null}
      <span className="ml-auto inline-flex gap-1">
        {allSelected ? null : <ActionButton id="selectAll" showLabel size="sm" variant="ghost" onAction={onSelectAll} />}
        <ActionButton id="clearSelection" showLabel size="sm" variant="ghost" onAction={onClear} />
      </span>
    </div>
  )
}
