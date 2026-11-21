"use client";

import { useEffect, useState } from "react";

const QUERY = "(max-width: 899px)";

/** True when the viewport is narrower than 900 px. */
export function useNarrowViewport(): boolean {
  const [narrow, setNarrow] = useState(false);

  useEffect(() => {
    const mql = window.matchMedia(QUERY);
    setNarrow(mql.matches);
    function onChange(e: MediaQueryListEvent) {
      setNarrow(e.matches);
    }
    mql.addEventListener("change", onChange);
    return () => mql.removeEventListener("change", onChange);
  }, []);

  return narrow;
}
