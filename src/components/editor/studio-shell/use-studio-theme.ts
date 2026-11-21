"use client";

import { useMemo, useSyncExternalStore } from "react";

interface StudioTheme {
  background: string;
  muted: string;
  border: string;
  foreground: string;
  accent: string;
  ring: string;
  resolve: (cssVar: string) => string;
}

const TOKENS = [
  "--background",
  "--muted",
  "--border",
  "--foreground",
  "--accent",
  "--ring",
] as const;

function readVar(cssVar: string): string {
  if (typeof window === "undefined") return "";
  return getComputedStyle(document.documentElement)
    .getPropertyValue(cssVar)
    .trim();
}

/**
 * Stable snapshot: a `|`-joined string of the resolved token values. It only
 * changes when the painted theme changes, so useSyncExternalStore never loops.
 */
function getSnapshot(): string {
  return TOKENS.map(readVar).join("|");
}

function getServerSnapshot(): string {
  return TOKENS.map(() => "").join("|");
}

/** Re-read when the `.dark` class on <html> flips (theme-context toggles it). */
function subscribe(onChange: () => void): () => void {
  if (typeof window === "undefined") return () => {};
  const observer = new MutationObserver(onChange);
  observer.observe(document.documentElement, {
    attributes: true,
    attributeFilter: ["class"],
  });
  return () => observer.disconnect();
}

/**
 * Resolves the current shadcn CSS token values from the DOM so they can be
 * handed to JS consumers (Fabric canvas background, smart-guide colours…).
 * Stays in sync with the painted theme via useSyncExternalStore.
 */
export function useStudioTheme(): StudioTheme {
  const snapshot = useSyncExternalStore(
    subscribe,
    getSnapshot,
    getServerSnapshot
  );

  return useMemo<StudioTheme>(() => {
    const [background, muted, border, foreground, accent, ring] =
      snapshot.split("|");
    return {
      background,
      muted,
      border,
      foreground,
      accent,
      ring,
      resolve: readVar,
    };
  }, [snapshot]);
}
