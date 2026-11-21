"use client";

// loriax-app/src/components/onboarding/tour-context.tsx
// Contexte React rendant l'API du tour (open) accessible partout dans l'app,
// + montage de TourEngine et TourBanner. Auto-démarrage si autoStart=true
// (utilisateur fraîchement connecté qui n'a jamais lancé ni dismiss le tour).

import {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useRef,
  useState,
} from "react";
import { TourEngine } from "./tour-engine";
import { TourBanner } from "./tour-banner";

interface TourContextValue {
  open: (atStep?: number) => Promise<void>;
}

const Ctx = createContext<TourContextValue | null>(null);

export function useTour(): TourContextValue {
  const c = useContext(Ctx);
  if (!c) {
    throw new Error("useTour must be used within TourProvider");
  }
  return c;
}

interface TourProviderProps {
  children: React.ReactNode;
  autoStart: boolean;
}

export function TourProvider({ children, autoStart }: TourProviderProps) {
  const [active, setActive] = useState(false);
  const [startAt, setStartAt] = useState(1);
  const [demoSpaceSlug, setDemoSpaceSlug] = useState<string | null>(null);
  const autoStartedRef = useRef(false);

  const open = useCallback(async (atStep?: number) => {
    try {
      const res = await fetch("/api/onboarding/start", { method: "POST" });
      const data = (await res.json()) as { demoSpaceSlug?: string };
      if (data?.demoSpaceSlug) {
        setDemoSpaceSlug(data.demoSpaceSlug);
      }
    } catch {
      /* ignore — le tour démarre en mode dégradé sans demoSpaceSlug */
    }
    setStartAt(typeof atStep === "number" && atStep >= 1 ? atStep : 1);
    setActive(true);
  }, []);

  useEffect(() => {
    if (!autoStart) return;
    if (autoStartedRef.current) return;
    autoStartedRef.current = true;
    void open(1);
  }, [autoStart, open]);

  return (
    <Ctx.Provider value={{ open }}>
      {children}
      <TourBanner onResume={() => void open()} />
      {active && demoSpaceSlug && (
        <TourEngine
          demoSpaceSlug={demoSpaceSlug}
          startAt={startAt}
          onClose={() => setActive(false)}
        />
      )}
    </Ctx.Provider>
  );
}
