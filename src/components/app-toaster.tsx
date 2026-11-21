"use client";

import { useEffect, useState } from "react";
import { Toaster } from "sonner";

/** Toaster sonner synchronisé sur la classe `dark` posée sur <html> par le thème de l'application. */
export function AppToaster() {
  const [theme, setTheme] = useState<"light" | "dark">("light");

  useEffect(() => {
    const root = document.documentElement;
    const sync = () => setTheme(root.classList.contains("dark") ? "dark" : "light");
    sync();
    const observer = new MutationObserver(sync);
    observer.observe(root, { attributes: true, attributeFilter: ["class"] });
    return () => observer.disconnect();
  }, []);

  return <Toaster position="bottom-right" richColors theme={theme} />;
}
