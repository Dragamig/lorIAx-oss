"use client";

import { useEffect } from "react";

/** Dev only: removes any Service Worker and caches left by a previous install. */
export function DevSwCleanup() {
  useEffect(() => {
    if (process.env.NODE_ENV === "production") return;
    (async () => {
      try {
        if ("serviceWorker" in navigator) {
          const regs = await navigator.serviceWorker.getRegistrations();
          await Promise.all(regs.map((r) => r.unregister()));
          if (regs.length > 0 && "caches" in window) {
            if (sessionStorage.getItem("dev-sw-cleaned")) return;
            sessionStorage.setItem("dev-sw-cleaned", "1");
            const keys = await caches.keys();
            await Promise.all(keys.map((k) => caches.delete(k)));
            window.location.reload();
          }
        }
      } catch {
        // ignore
      }
    })();
  }, []);
  return null;
}
