"use client";

import { useCallback, useEffect, useRef, useState } from "react";
// Le href lu dans le DOM porte deja le prefixe de locale (Link de next-intl) :
// le router natif evite un double prefixe que useRouter de next-intl ajouterait.
import { useRouter } from "next/navigation";

const BYPASS_RESET_MS = 1500;

/**
 * Garde contre la perte de modifications non enregistrees.
 * - beforeunload pour fermeture d'onglet, rechargement et liens externes.
 * - Interception des clics sur les liens internes (App Router).
 * Limite : le retour arriere du navigateur (popstate) n'est pas couvert.
 */
export function useUnsavedChangesGuard(isDirty: boolean) {
  const router = useRouter();
  const [pendingHref, setPendingHref] = useState<string | null>(null);
  const bypassRef = useRef(false);
  const bypassTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);

  useEffect(() => {
    if (!isDirty) return;
    const onBeforeUnload = (e: BeforeUnloadEvent) => {
      e.preventDefault();
      e.returnValue = "";
    };
    window.addEventListener("beforeunload", onBeforeUnload);
    return () => window.removeEventListener("beforeunload", onBeforeUnload);
  }, [isDirty]);

  useEffect(() => {
    if (!isDirty) return;
    const onClick = (e: MouseEvent) => {
      if (bypassRef.current) return;
      if (e.defaultPrevented || e.button !== 0) return;
      if (e.metaKey || e.ctrlKey || e.shiftKey || e.altKey) return;
      const target = e.target as Element | null;
      // Les elements (ou conteneurs) marques sont geres par leur propre onClick.
      if (target?.closest?.('[data-unsaved-guard="ignore"]')) return;
      const anchor = target?.closest?.("a[href]") as HTMLAnchorElement | null;
      if (!anchor) return;
      if (anchor.target && anchor.target !== "_self") return;
      if (anchor.hasAttribute("download")) return;
      let url: URL;
      try {
        url = new URL(anchor.href, window.location.href);
      } catch {
        return;
      }
      if (url.origin !== window.location.origin) return;
      const current = window.location;
      if (url.pathname === current.pathname && url.search === current.search) {
        return; // page courante ou simple changement de hash
      }
      e.preventDefault();
      e.stopPropagation();
      setPendingHref(url.pathname + url.search + url.hash);
    };
    document.addEventListener("click", onClick, true);
    return () => document.removeEventListener("click", onClick, true);
  }, [isDirty]);

  const confirmLeave = useCallback(() => {
    const href = pendingHref;
    setPendingHref(null);
    if (!href) return;
    bypassRef.current = true;
    router.push(href);
    // Si la navigation n'aboutit pas, la garde se reactive apres un court delai.
    if (bypassTimerRef.current) clearTimeout(bypassTimerRef.current);
    bypassTimerRef.current = setTimeout(() => {
      bypassRef.current = false;
      bypassTimerRef.current = null;
    }, BYPASS_RESET_MS);
  }, [pendingHref, router]);

  useEffect(
    () => () => {
      if (bypassTimerRef.current) clearTimeout(bypassTimerRef.current);
    },
    []
  );

  const cancelLeave = useCallback(() => setPendingHref(null), []);

  return {
    confirmOpen: pendingHref !== null,
    confirmLeave,
    cancelLeave,
    pendingHref,
  };
}
