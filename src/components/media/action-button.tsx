"use client"

import { useId, useState, type ReactNode } from "react"
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
  /** Remplace le libellé du registre (nom accessible et info-bulle), par exemple « Restaurer la version 3 ». */
  label?: string
  /** Ancrage de l'info-bulle : « end » l'aligne sur le bord droit du bouton (boutons en bord d'écran). */
  tipAlign?: "center" | "end"
  /** État d'un bouton à bascule : exposé en aria-pressed. */
  pressed?: boolean
  /** Remplace le contenu du bouton (tuile) ; le nom accessible reste celui de l'action. */
  children?: ReactNode
  className?: string
  /** Classes du conteneur de l'info-bulle (largeur pleine pour une tuile). */
  wrapperClassName?: string
}

const KEY_LABELS: Record<string, string> = { Delete: "delete", Enter: "enter", Escape: "escape", Shift: "shift" }

export function ActionButton({
  id,
  onAction,
  disabledReason,
  variant = "ghost",
  size = "icon-sm",
  showLabel = false,
  label: labelOverride,
  tipAlign = "center",
  pressed,
  children,
  className,
  wrapperClassName,
}: Props) {
  const t = useTranslations()
  const tipId = useId()
  const [open, setOpen] = useState(false)
  const def = LIBRARY_ACTIONS[id]
  const Icon = def.icon
  const label = labelOverride ?? t(def.labelKey)
  const shortcut = def.shortcut
    ? def.shortcut
        .split("+")
        .map((part) => (KEY_LABELS[part] ? t(`library.keys.${KEY_LABELS[part]}`) : part))
        .join("+")
    : null
  const tip = disabledReason ?? (shortcut ? `${label} (${shortcut})` : label)
  const disabled = Boolean(disabledReason)

  return (
    <span
      className={`relative inline-flex ${wrapperClassName ?? ""}`}
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
        size={showLabel && size !== "sm" ? "default" : size}
        aria-label={label}
        aria-pressed={pressed}
        className={className}
        aria-describedby={disabled ? tipId : undefined}
        disabled={disabled}
        data-action={id}
        onClick={() => {
          if (!disabled) onAction()
        }}
      >
        {children ?? (
          <>
            <Icon aria-hidden="true" />
            {showLabel ? <span>{label}</span> : null}
          </>
        )}
      </Button>
      {open || disabled ? (
        <span
          id={tipId}
          role="tooltip"
          hidden={!open}
          className={`bg-popover text-popover-foreground border-border pointer-events-none absolute top-full z-50 mt-1 ${tipAlign === "end" ? "right-0" : "left-1/2 -translate-x-1/2"} rounded-md border px-2 py-1 text-xs w-max max-w-[16rem] whitespace-normal shadow-md`}
        >
          {tip}
        </span>
      ) : null}
    </span>
  )
}
