"use client"

import { useEffect, useRef } from "react"
import { useSearchParams } from "next/navigation"
import { usePathname, useRouter } from "@/i18n/routing"

type Item = { id: string }

/**
 * Entrées par lien : `?upload=1` ouvre le dialogue de téléversement (puis le
 * paramètre est retiré), `?id=<média>` (filtre existant) ouvre ce média dans
 * le panneau de détail dès que la liste le contient.
 */
export function useLibraryDeeplink(opts: {
  ids: string[] | undefined
  items: Item[]
  canUpload: boolean
  onUpload: () => void
  onOpen: (id: string) => void
}) {
  const { ids, items, canUpload, onUpload, onOpen } = opts
  const searchParams = useSearchParams()
  const router = useRouter()
  const pathname = usePathname()
  const wantsUpload = searchParams.get("upload") === "1"

  useEffect(() => {
    if (!wantsUpload) return
    if (canUpload) onUpload()
    const next = new URLSearchParams(searchParams.toString())
    next.delete("upload")
    const qs = next.toString()
    router.replace(qs ? `${pathname}?${qs}` : pathname)
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [wantsUpload])

  const opened = useRef<string | null>(null)
  const target = ids && ids.length === 1 ? ids[0] : null
  useEffect(() => {
    if (!target) {
      opened.current = null
      return
    }
    if (opened.current === target) return
    if (items.some((i) => i.id === target)) {
      opened.current = target
      onOpen(target)
    }
  }, [target, items, onOpen])
}
