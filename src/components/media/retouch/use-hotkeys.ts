"use client";

import { useEffect, useRef } from "react";

/** Combinaison normalisée d'un événement clavier : "R", "Shift+R", "Enter", "Escape". */
export function hotkeyOf(e: Pick<KeyboardEvent, "key" | "shiftKey">): string {
  const k = e.key.length === 1 ? e.key.toUpperCase() : e.key;
  return e.shiftKey && k.length === 1 ? `Shift+${k}` : k;
}

const isTextField = (el: EventTarget | null) =>
  el instanceof HTMLElement && (el.isContentEditable || ["INPUT", "TEXTAREA", "SELECT"].includes(el.tagName));

/**
 * Raccourcis d'un panneau, actifs tant qu'il est monté. Ignorés dans un champ de saisie, avec Ctrl, Alt ou Méta,
 * et pour Entrée quand le focus est sur un bouton (qui réagit déjà à Entrée).
 */
export function useHotkeys(map: Record<string, () => void>, enabled = true) {
  const ref = useRef(map);
  useEffect(() => {
    ref.current = map;
  });
  useEffect(() => {
    if (!enabled) return;
    const onKey = (e: KeyboardEvent) => {
      if (e.defaultPrevented || e.ctrlKey || e.altKey || e.metaKey || isTextField(e.target)) return;
      const combo = hotkeyOf(e);
      const fn = ref.current[combo];
      if (!fn) return;
      if (combo === "Enter" && e.target instanceof HTMLElement && e.target.closest("button, [role='button']")) return;
      e.preventDefault();
      fn();
    };
    document.addEventListener("keydown", onKey);
    return () => document.removeEventListener("keydown", onKey);
  }, [enabled]);
}
