"use client"

import { useId, useState } from "react"
import { useTranslations } from "next-intl"

import { Button } from "@/components/ui/button"
import { LIBRARY_ACTIONS, type ActionId } from "@/lib/media/actions"

type Props = {
  id: ActionId
  onAction: () => void
  /** Désactive le bouton et remplace l'info-bulle par cette raison. */
  disabledReason?: string
  variant?: "default" | "outline" | "secondary" | "ghost" | "destructive"
  size?: "default" | "sm" | "icon" | "icon-sm"
  /** Affiche aussi le libellé à côté de l'icône. */
  showLabel?: boolean
}

const KEY_LABELS: Record<string, string> = { Delete: "delete", Enter: "enter" }

export function ActionButton({
  id,
  onAction,
  disabledReason,
  variant = "ghost",
  size = "icon-sm",
  showLabel = false,
}: Props) {
  const t = useTranslations()
  const tipId = useId()
  const [open, setOpen] = useState(false)
  const def = LIBRARY_ACTIONS[id]
  const Icon = def.icon
  const label = t(def.labelKey)
  const shortcut = def.shortcut
    ? KEY_LABELS[def.shortcut]
      ? t(`library.keys.${KEY_LABELS[def.shortcut]}`)
      : def.shortcut
    : null
  const tip = disabledReason ?? (shortcut ? `${label} (${shortcut})` : label)
  const disabled = Boolean(disabledReason)

  return (
    <span
      className="relative inline-flex"
      onMouseEnter={() => setOpen(true)}
      onMouseLeave={() => setOpen(false)}
      onFocus={() => setOpen(true)}
      onBlur={() => setOpen(false)}
      onKeyDown={(e) => {
        if (e.key === "Escape") setOpen(false)
      }}
    >
      <Button
        type="button"
        variant={variant}
        size={showLabel ? "default" : size}
        aria-label={label}
        aria-describedby={disabled ? tipId : undefined}
        disabled={disabled}
        data-action={id}
        onClick={() => {
          if (!disabled) onAction()
        }}
      >
        <Icon aria-hidden="true" />
        {showLabel ? <span>{label}</span> : null}
      </Button>
      {open || disabled ? (
        <span
          id={tipId}
          role="tooltip"
          hidden={!open}
          className="bg-popover text-popover-foreground border-border pointer-events-none absolute top-full left-1/2 z-50 mt-1 -translate-x-1/2 rounded-md border px-2 py-1 text-xs whitespace-nowrap shadow-md"
        >
          {tip}
        </span>
      ) : null}
    </span>
  )
}
