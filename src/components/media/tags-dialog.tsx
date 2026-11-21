"use client"

import { useEffect, useId, useMemo, useState } from "react"
import { useTranslations } from "next-intl"
import { Undo2, X } from "lucide-react"
import { Button } from "@/components/ui/button"
import { Dialog, DialogContent, DialogFooter, DialogHeader, DialogTitle } from "@/components/ui/dialog"
import { Label } from "@/components/ui/label"
import type { MediaListItem } from "@/lib/media/list"
import { cn } from "@/lib/utils"
import { TagField } from "./tag-field"

type Props = {
  open: boolean
  onOpenChange: (open: boolean) => void
  /** Médias de la sélection : les tags communs et partiels en sont déduits. */
  items: MediaListItem[]
  /** `add` : libellés à poser (créés à la volée) ; `removeIds` : tags à retirer des trois médias. */
  onApply: (add: string[], removeIds: string[]) => void
}

/** Ajout et retrait de tags en lot, avec l'état « sur certains ». */
export function TagsDialog({ open, onOpenChange, items, onApply }: Props) {
  const t = useTranslations("library.bulk")
  const fieldId = useId()
  const [add, setAdd] = useState<string[]>([])
  const [removed, setRemoved] = useState<string[]>([])
  useEffect(() => {
    if (open) {
      setAdd([])
      setRemoved([])
    }
  }, [open])

  const current = useMemo(() => {
    const byId = new Map<string, { id: string; label: string; count: number }>()
    for (const item of items) {
      for (const tag of item.tags) {
        const e = byId.get(tag.id) ?? { id: tag.id, label: tag.label, count: 0 }
        e.count += 1
        byId.set(tag.id, e)
      }
    }
    return [...byId.values()].sort((a, b) => a.label.localeCompare(b.label))
  }, [items])

  const toggleRemoved = (id: string) =>
    setRemoved((r) => (r.includes(id) ? r.filter((x) => x !== id) : [...r, id]))
  const pending = add.length + removed.length

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent>
        <DialogHeader>
          <DialogTitle>{t("tagsTitle")}</DialogTitle>
        </DialogHeader>
        <div className="grid gap-4">
          <div className="grid gap-1.5">
            <p className="text-sm font-medium">{t("tagsCurrent")}</p>
            {current.length === 0 ? (
              <p className="text-xs text-muted-foreground">{t("tagsNone")}</p>
            ) : (
              <ul className="flex flex-wrap gap-1.5">
                {current.map((tag) => {
                  const off = removed.includes(tag.id)
                  return (
                    <li
                      key={tag.id}
                      className={cn(
                        "inline-flex items-center gap-1 rounded-full bg-muted px-2 py-0.5 text-xs",
                        off && "line-through opacity-60"
                      )}
                    >
                      {tag.label}
                      {tag.count < items.length ? (
                        <span className="text-muted-foreground no-underline">({t("tagsSome")})</span>
                      ) : null}
                      <Button
                        type="button"
                        variant="ghost"
                        size="icon-xs"
                        aria-label={off ? t("tagsKeep", { tag: tag.label }) : t("tagsRemove", { tag: tag.label })}
                        title={off ? t("tagsKeep", { tag: tag.label }) : t("tagsRemove", { tag: tag.label })}
                        onClick={() => toggleRemoved(tag.id)}
                      >
                        {off ? <Undo2 aria-hidden /> : <X aria-hidden />}
                      </Button>
                    </li>
                  )
                })}
              </ul>
            )}
          </div>
          <div className="grid gap-1.5">
            <Label htmlFor={fieldId}>{t("tagsAddLabel")}</Label>
            <TagField
              id={fieldId}
              tags={add}
              onAdd={(tag) => setAdd((a) => [...a, tag])}
              onRemove={(tag) => setAdd((a) => a.filter((x) => x !== tag))}
              placeholder={t("tagsAddHint")}
              removeLabel={(tag) => t("tagsRemove", { tag })}
            />
          </div>
        </div>
        <DialogFooter>
          <Button type="button" variant="outline" onClick={() => onOpenChange(false)}>
            {t("cancel")}
          </Button>
          <Button
            type="button"
            disabled={pending === 0}
            onClick={() => {
              onOpenChange(false)
              onApply(add, removed)
            }}
          >
            {t("tagsApply")}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  )
}
