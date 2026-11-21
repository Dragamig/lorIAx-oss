"use client"

import { useCallback, useEffect, useRef, useState } from "react"
import { useTranslations } from "next-intl"
import { toast } from "sonner"
import type { MediaListItem } from "@/lib/media/list"
import type { UploadQueue } from "../upload-queue"
import { useBatchToast } from "../use-upload-queue"
import { toPicked } from "./picker-library"
import type { PickerSelection } from "./use-picker-selection"

const BUSY = new Set(["queued", "hashing", "uploading"])

/**
 * File d'envoi du sélecteur, portée par le corps de la modale : elle survit aux changements
 * d'onglet. Un lot réussi est sélectionné ; `onSelected` laisse le corps décider du retour
 * sur la Médiathèque. Annuler (corbeille) un lot le retire de la sélection.
 */
export function usePickerUploadSession(
  queue: UploadQueue,
  picker: PickerSelection,
  mode: "single" | "multiple",
  onSelected: () => void
) {
  const tp = useTranslations("library.picker")
  const pickerRef = useRef(picker)
  const onSelectedRef = useRef(onSelected)
  const handledRef = useRef(new Set<string>())
  useEffect(() => {
    pickerRef.current = picker
    onSelectedRef.current = onSelected
  })
  const onUndone = useCallback((ids: string[]) => pickerRef.current.removeMany(ids), [])
  useBatchToast(queue, undefined, onUndone)

  const handleDone = useCallback(async () => {
    const snap = queue.snapshot()
    if (snap.some((i) => BUSY.has(i.status) || i.status === "duplicate")) return
    const fresh = snap.filter((i) => i.status === "done" && i.mediaId && !handledRef.current.has(i.id))
    if (fresh.length === 0) return
    fresh.forEach((i) => handledRef.current.add(i.id))
    if (fresh.some((i) => i.reused)) toast.info(tp("alreadyInLibrary"))
    let picked = 0
    for (const i of fresh) {
      try {
        const res = await fetch(`/api/media/${i.mediaId}/meta`)
        if (!res.ok) throw new Error(`HTTP ${res.status}`)
        const { media } = (await res.json()) as { media: MediaListItem }
        const p = pickerRef.current
        if (!p.isSelected(media.id) && !(mode === "multiple" && p.atMax)) {
          p.toggle(toPicked(media))
          picked++
        }
      } catch {
        toast.error(tp("loadFailed", { name: i.name }))
      }
    }
    if (picked > 0) onSelectedRef.current()
  }, [queue, mode, tp])
  useEffect(() => queue.subscribe(() => void handleDone()), [queue, handleDone])
}

/** Vrai tant qu'un envoi de la file est en cours. */
export function isQueueBusy(queue: UploadQueue): boolean {
  return queue.snapshot().some((i) => BUSY.has(i.status))
}

export type ImportGuard = {
  busy: boolean
  /** Ouvre un import ; null si un autre est déjà en cours. Le signal passe à l'état annulé à la fermeture. */
  begin: () => AbortSignal | null
  end: (signal: AbortSignal) => void
}

/** Un import à la fois pour tout le sélecteur ; la fermeture annule celui qui court. */
export function useImportGuard(): ImportGuard & { abortAll: () => void } {
  const [busy, setBusy] = useState(false)
  const controllerRef = useRef<AbortController | null>(null)

  const begin = useCallback(() => {
    if (controllerRef.current) return null
    const c = new AbortController()
    controllerRef.current = c
    setBusy(true)
    return c.signal
  }, [])
  const end = useCallback((signal: AbortSignal) => {
    if (controllerRef.current?.signal !== signal) return
    controllerRef.current = null
    setBusy(false)
  }, [])
  const abortAll = useCallback(() => {
    controllerRef.current?.abort()
    controllerRef.current = null
  }, [])
  useEffect(() => abortAll, [abortAll])

  return { busy, begin, end, abortAll }
}
