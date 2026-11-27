"use client"

import { useId, useState, type ReactElement, cloneElement } from "react"

type Props = {
  /** Texte de l'info-bulle. */
  label: string
  /** Contrôle enveloppé (bouton, lien). */
  children: ReactElement<{ "aria-describedby"?: string }>
  /** Contrôle désactivé : le conteneur devient focalisable pour rester atteignable au clavier. */
  disabled?: boolean
  className?: string
  /** `end` aligne l'info-bulle sur le bord droit du contrôle (contrôle collé au bord d'un conteneur qui rogne). */
  align?: "center" | "end"
  /** `top` ouvre l'info-bulle au-dessus (contrôle en bas d'un conteneur qui rogne). */
  side?: "top" | "bottom"
}

/**
 * Info-bulle du projet (même mécanique que `ActionButton`) : visible au survol
 * et au focus clavier, y compris sur un bouton `disabled` (l'enveloppe reçoit
 * les événements que le bouton désactivé n'émet pas). Echap la ferme.
 */
export function Hint({ label, children, disabled = false, className, align = "center", side = "bottom" }: Props) {
  const tipId = useId()
  const [open, setOpen] = useState(false)
  return (
    <span
      className={`relative inline-flex ${className ?? ""}`}
      tabIndex={disabled ? 0 : undefined}
      onMouseEnter={() => setOpen(true)}
      onMouseLeave={() => setOpen(false)}
      onFocus={() => setOpen(true)}
      onBlur={() => setOpen(false)}
      onKeyDown={(e) => {
        if (e.key === "Escape") setOpen(false)
      }}
    >
      {cloneElement(children, { "aria-describedby": tipId })}
      {open ? (
        <span
          id={tipId}
          role="tooltip"
          className={`bg-popover text-popover-foreground border-border pointer-events-none absolute z-50 ${side === "top" ? "bottom-full mb-1" : "top-full mt-1"} ${align === "end" ? "right-0" : "left-1/2 -translate-x-1/2"} rounded-md border px-2 py-1 text-xs whitespace-nowrap shadow-md`}
        >
          {label}
        </span>
      ) : (
        <span id={tipId} hidden role="tooltip">
          {label}
        </span>
      )}
    </span>
  )
}
