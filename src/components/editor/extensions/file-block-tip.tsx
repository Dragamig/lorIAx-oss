"use client"

import { useId, useState, type ReactNode } from "react"

/** Info-bulle au survol et au focus clavier. */
export function Tip({ text, children, alwaysInDom = false }: { text: string; children: ReactNode; alwaysInDom?: boolean }) {
  const id = useId()
  const [open, setOpen] = useState(false)
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
      {children}
      {open || alwaysInDom ? (
        <span
          id={id}
          role="tooltip"
          hidden={!open}
          className="bg-popover text-popover-foreground border-border pointer-events-none absolute top-full right-0 z-50 mt-1 rounded-md border px-2 py-1 text-xs whitespace-nowrap shadow-md"
        >
          {text}
        </span>
      ) : null}
    </span>
  )
}
