"use client";

import { useEffect, useState } from "react";

/**
 * Whether public self-service registration is open.
 * `null` while loading, `false` on any error (fail closed).
 */
export function useRegistrationOpen(): { open: boolean | null } {
  const [open, setOpen] = useState<boolean | null>(null);

  useEffect(() => {
    let cancelled = false;
    fetch("/api/auth/registration-status", { cache: "no-store" })
      .then((res) => (res.ok ? res.json() : { open: false }))
      .then((data: { open?: boolean }) => {
        if (!cancelled) setOpen(data.open === true);
      })
      .catch(() => {
        if (!cancelled) setOpen(false);
      });
    return () => {
      cancelled = true;
    };
  }, []);

  return { open };
}
