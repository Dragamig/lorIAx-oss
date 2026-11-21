"use client"

import { useCallback, useEffect, useId, useRef, useState, type KeyboardEvent } from "react"
import { useTranslations } from "next-intl"
import { toast } from "sonner"
import { Dialog, DialogContent, DialogTitle } from "@/components/ui/dialog"
import { Input } from "@/components/ui/input"
import { Label } from "@/components/ui/label"
import { LIBRARY_ACTIONS, type ActionId } from "@/lib/media/actions"
import { cn } from "@/lib/utils"
import { ActionButton } from "../action-button"
import { PickerLibrary } from "./picker-library"
import { PickerBank } from "./picker-bank"
import { PickerUpload } from "./picker-upload"
import { PickerUrl } from "./picker-url"
import { useUploadQueue, useQueueSnapshot } from "../use-upload-queue"
import { isQueueBusy, useImportGuard, usePickerUploadSession } from "./use-picker-session"
import type { MediaPickerProps, MediaPickerTab } from "./types"
import { usePickerSelection } from "./use-picker-selection"

const TAB_ACTIONS: Record<MediaPickerTab, ActionId> = {
  library: "pickerTabLibrary",
  upload: "pickerTabUpload",
  url: "pickerTabUrl",
  bank: "pickerTabBank",
}

// Onglets dont le contenu est livré ; les autres s'ajoutent avec leur composant.
const AVAILABLE_TABS: readonly MediaPickerTab[] = ["library", "upload", "url", "bank"]

const TAB_HINTS: Record<MediaPickerTab, string> = {
  library: "tabHintLibrary",
  upload: "tabHintUpload",
  url: "tabHintUrl",
  bank: "tabHintBank",
}

/** Onglet : icône du registre, libellé, info-bulle au survol et au focus clavier. */
function PickerTab({
  id,
  active,
  label,
  hint,
  onSelect,
}: {
  id: MediaPickerTab
  active: boolean
  label: string
  hint: string
  onSelect: () => void
}) {
  const tipId = useId()
  const [open, setOpen] = useState(false)
  const Icon = LIBRARY_ACTIONS[TAB_ACTIONS[id]].icon
  return (
    <span
      role="presentation"
      className="relative inline-flex"
      onMouseEnter={() => setOpen(true)}
      onMouseLeave={() => setOpen(false)}
      onFocus={(e) => {
        // Au clavier seulement : le focus initial donné par la modale n'affiche pas d'info-bulle.
        let visible = true
        try {
          visible = e.target.matches(":focus-visible")
        } catch {
          /* sélecteur non pris en charge : on affiche */
        }
        if (visible) setOpen(true)
      }}
      onBlur={() => setOpen(false)}
      onKeyDown={(e) => {
        if (e.key === "Escape" && open) {
          e.stopPropagation()
          setOpen(false)
        }
      }}
    >
      <button
        type="button"
        data-action-exempt
        id={`picker-tab-${id}`}
        role="tab"
        aria-selected={active}
        aria-controls={active ? `picker-panel-${id}` : undefined}
        aria-describedby={open ? tipId : undefined}
        tabIndex={active ? 0 : -1}
        onClick={onSelect}
        className={cn(
          "-mb-px inline-flex min-h-6 cursor-pointer items-center gap-1.5 border-b-2 px-3 py-1.5 text-sm outline-none focus-visible:ring-2 focus-visible:ring-ring",
          active ? "border-primary font-medium" : "border-transparent text-muted-foreground"
        )}
      >
        <Icon className="size-4" aria-hidden="true" />
        {label}
      </button>
      {open ? (
        <span
          id={tipId}
          role="tooltip"
          className="bg-popover text-popover-foreground border-border pointer-events-none absolute top-full left-1/2 z-50 mt-1 -translate-x-1/2 rounded-md border px-2 py-1 text-xs whitespace-nowrap shadow-md"
        >
          {hint}
        </span>
      ) : null}
    </span>
  )
}

function PickerBody({
  onOpenChange,
  registerGuard,
  uploadOptions,
  onPick,
  accept,
  mode = "single",
  max,
  tabs = ["library", "upload"],
  showAlt = false,
  spaceId,
  title,
}: Omit<MediaPickerProps, "open" | "finalFocus"> & { registerGuard: (guard: (() => boolean) | null) => void }) {
  const t = useTranslations("library")
  const tp = useTranslations("library.picker")
  const picker = usePickerSelection(mode, max)
  const visibleTabs = tabs.filter((x) => AVAILABLE_TABS.includes(x))
  const [tab, setTab] = useState<MediaPickerTab>(visibleTabs[0] ?? "library")
  const [altEdit, setAltEdit] = useState<{ id: string; value: string } | null>(null)
  const [busy, setBusy] = useState(false)
  const [confirmClose, setConfirmClose] = useState(false)
  const queue = useUploadQueue(uploadOptions)
  const queueItems = useQueueSnapshot(queue)
  const imports = useImportGuard()
  // Un import ou un lot terminé ramène sur la Médiathèque seulement si l'utilisateur est resté sur l'onglet d'origine.
  const backToLibraryFrom = (origin: MediaPickerTab) => setTab((cur) => (cur === origin ? "library" : cur))
  usePickerUploadSession(queue, picker, mode, () => backToLibraryFrom("upload"))
  const uploading = queueItems.some((i) => i.status === "queued" || i.status === "hashing" || i.status === "uploading")

  // Garde de fermeture (Échap, fond, Annuler) : un envoi en cours demande confirmation dans la modale.
  useEffect(() => {
    registerGuard(() => {
      if (!isQueueBusy(queue)) return false
      setConfirmClose(true)
      return true
    })
    return () => registerGuard(null)
  }, [queue, registerGuard])

  const closeAnyway = () => {
    queue.snapshot().forEach((i) => {
      if (i.status === "queued" || i.status === "hashing" || i.status === "uploading") queue.cancel(i.id)
    })
    imports.abortAll()
    onOpenChange(false)
  }

  const only = picker.selected.length === 1 ? picker.selected[0] : null
  const alt = only ? (altEdit?.id === only.id ? altEdit.value : (only.altText ?? "")) : ""
  const imageOnly = !!accept && accept.length > 0 && accept.every((k) => k === "image")
  const emptyReason = imageOnly ? tp("chooseImage") : tp("chooseMedia")

  const requestClose = () => {
    // Passe par la garde : un envoi en cours demande confirmation.
    if (isQueueBusy(queue)) setConfirmClose(true)
    else onOpenChange(false)
  }

  const insert = async () => {
    if (picker.selected.length === 0 || busy) return
    setBusy(true)
    try {
      await onPick(picker.selected, showAlt && only ? { alt } : {})
      requestClose()
    } catch {
      toast.error(tp("pickFailed"))
    } finally {
      setBusy(false)
    }
  }

  const onTabKey = (e: KeyboardEvent<HTMLElement>) => {
    const i = visibleTabs.indexOf(tab)
    const next = e.key === "ArrowRight" ? i + 1 : e.key === "ArrowLeft" ? i - 1 : null
    if (next === null) return
    e.preventDefault()
    const target = visibleTabs[(next + visibleTabs.length) % visibleTabs.length]
    setTab(target)
    requestAnimationFrame(() => document.getElementById(`picker-tab-${target}`)?.focus())
  }

  return (
    <>
      <DialogTitle>{title ?? tp("title")}</DialogTitle>
      <div role="tablist" aria-label={tp("tabsLabel")} className="flex gap-1 border-b border-border" onKeyDown={onTabKey}>
        {visibleTabs.map((id) => (
          <PickerTab
            key={id}
            id={id}
            active={tab === id}
            label={t(`actions.${TAB_ACTIONS[id]}`)}
            hint={tp(TAB_HINTS[id])}
            onSelect={() => setTab(id)}
          />
        ))}
      </div>
      <div
        role="tabpanel"
        id={`picker-panel-${tab}`}
        aria-labelledby={`picker-tab-${tab}`}
        className="flex h-[min(60vh,520px)] min-h-0 flex-col overflow-hidden rounded-md border border-border"
      >
        {tab === "library" ? <PickerLibrary accept={accept} mode={mode} max={max} picker={picker} spaceId={spaceId} /> : null}
        {tab === "upload" ? (
          <PickerUpload
            accept={accept}
            mode={mode}
            spaceId={spaceId}
            queue={queue}
          />
        ) : null}
        {tab === "url" ? (
          <PickerUrl
            mode={mode}
            spaceId={spaceId}
            picker={picker}
            imports={imports}
            onImported={() => backToLibraryFrom("url")}
          />
        ) : null}
        {tab === "bank" ? (
          <PickerBank
            mode={mode}
            spaceId={spaceId}
            picker={picker}
            imports={imports}
            onImported={() => backToLibraryFrom("bank")}
          />
        ) : null}
      </div>
      {confirmClose && uploading ? (
        <div role="alert" className="flex flex-wrap items-center gap-3 rounded-md border border-border bg-muted p-3 text-sm">
          <div className="min-w-48 flex-1">
            <p className="font-medium">{tp("closeUploadTitle")}</p>
            <p className="text-muted-foreground">{tp("closeUploadBody")}</p>
          </div>
          <ActionButton id="pickerKeepUploading" variant="outline" showLabel onAction={() => setConfirmClose(false)} />
          <ActionButton id="pickerCloseAnyway" variant="destructive" showLabel onAction={closeAnyway} />
        </div>
      ) : null}
      <div className="flex flex-wrap items-center gap-3">
        <span aria-live="polite" className="text-sm text-muted-foreground">
          {tp("selectedCount", { count: String(picker.selected.length) })}
        </span>
        {showAlt && only ? (
          <div className="flex min-w-48 flex-1 items-center gap-2">
            <Label htmlFor="picker-alt" className="shrink-0">
              {tp("altLabel")}
            </Label>
            <Input
              id="picker-alt"
              value={alt}
              placeholder={tp("altPlaceholder")}
              onChange={(e) => setAltEdit({ id: only.id, value: e.target.value })}
            />
          </div>
        ) : null}
        <div className="ml-auto flex items-center gap-2">
          <ActionButton id="pickerCancel" variant="outline" showLabel onAction={requestClose} />
          <ActionButton
            id="pickerInsert"
            variant="default"
            showLabel
            disabledReason={picker.selected.length === 0 ? emptyReason : busy ? tp("busy") : undefined}
            onAction={() => void insert()}
          />
        </div>
      </div>
    </>
  )
}

/** Sélecteur de médias en modale ; l'état de sélection vit dans le corps, remonté à chaque ouverture. */
export function MediaPicker({ open, onOpenChange, finalFocus, ...rest }: MediaPickerProps) {
  const guardRef = useRef<(() => boolean) | null>(null)
  const registerGuard = useCallback((g: (() => boolean) | null) => {
    guardRef.current = g
  }, [])
  return (
    <Dialog
      open={open}
      onOpenChange={(next) => {
        if (!next && guardRef.current?.()) return
        onOpenChange(next)
      }}
    >
      <DialogContent className="sm:max-w-4xl" showCloseButton={false} finalFocus={finalFocus}>
        <PickerBody onOpenChange={onOpenChange} registerGuard={registerGuard} {...rest} />
      </DialogContent>
    </Dialog>
  )
}
