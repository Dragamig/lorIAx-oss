"use client"

import { useState, type KeyboardEvent } from "react"
import { X } from "lucide-react"

import { Button } from "@/components/ui/button"
import { Input } from "@/components/ui/input"

type Props = {
  id: string
  tags: string[]
  onAdd: (tag: string) => void
  onRemove: (tag: string) => void
  placeholder: string
  /** Nom accessible du champ de saisie. */
  inputLabel?: string
  removeLabel: (tag: string) => string
  /** Désactive le champ et les retraits ; la raison remplace l'info-bulle. */
  disabledReason?: string
}

/** Pastilles de tags avec saisie : Entrée ou perte de focus ajoute, doublons ignorés. */
export function TagField({ id, tags, onAdd, onRemove, placeholder, inputLabel, removeLabel, disabledReason }: Props) {
  const [draft, setDraft] = useState("")
  const disabled = Boolean(disabledReason)

  const commit = () => {
    const v = draft.trim()
    setDraft("")
    if (v && !tags.some((x) => x.toLowerCase() === v.toLowerCase())) onAdd(v)
  }
  const onKey = (e: KeyboardEvent<HTMLInputElement>) => {
    if (e.key === "Enter" || e.key === ",") {
      e.preventDefault()
      commit()
    }
  }

  return (
    <div className="flex flex-wrap items-center gap-1.5">
      {tags.map((tag) => (
        <span key={tag} className="inline-flex items-center gap-1 rounded-full bg-muted px-2 py-0.5 text-xs">
          {tag}
          {!disabled && (
            <Button
              type="button"
              variant="ghost"
              size="icon-xs"
              aria-label={removeLabel(tag)}
              title={removeLabel(tag)}
              onClick={() => onRemove(tag)}
            >
              <X aria-hidden />
            </Button>
          )}
        </span>
      ))}
      <Input
        id={id}
        className="h-7 min-w-28 flex-1"
        value={draft}
        placeholder={placeholder}
        aria-label={inputLabel}
        title={disabledReason}
        disabled={disabled}
        onChange={(e) => setDraft(e.target.value)}
        onKeyDown={onKey}
        onBlur={commit}
      />
    </div>
  )
}
