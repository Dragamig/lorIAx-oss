"use client";

// loriax-app/src/components/onboarding/tour-engine.tsx
// Moteur du tour guidé : enchaîne les étapes, appelle /api/onboarding/step à chaque
// avancée et /api/onboarding/dismiss en cas de skip.

import { useState, useEffect, useCallback, useMemo } from "react";
import { useTranslations } from "next-intl";
import { useRouter } from "@/i18n/routing";
import { TourStep } from "./tour-step";
import { steps as stepDefs } from "./steps";
import { TOUR_STEP_COUNT } from "@/lib/onboarding/types";

export interface TourEngineProps {
  startAt?: number;
  onClose: () => void;
  demoSpaceSlug: string;
}

export function TourEngine({ startAt = 1, onClose, demoSpaceSlug }: TourEngineProps) {
  const router = useRouter();
  const t = useTranslations();
  const [current, setCurrent] = useState(startAt);

  // Modules actifs de l'organisation courante. `null` = pas encore connus :
  // le tour attend la réponse plutôt que d'afficher une étape qu'il devra
  // retirer juste après.
  const [activeModules, setActiveModules] = useState<string[] | null>(null);

  useEffect(() => {
    let cancelled = false;
    fetch("/api/modules/active")
      .then((res) => (res.ok ? res.json() : { modules: [] }))
      .then((data: { modules?: string[] }) => {
        if (cancelled) return;
        setActiveModules(Array.isArray(data?.modules) ? data.modules : []);
      })
      .catch(() => {
        // Repli fermé : sans réponse, les étapes conditionnées à un module
        // sont retirées plutôt que de mener vers une page absente.
        if (!cancelled) setActiveModules([]);
      });
    return () => {
      cancelled = true;
    };
  }, []);

  const visibleSteps = useMemo(() => {
    if (activeModules === null) return [];
    return stepDefs.filter(
      (s) => !s.requiresModule || activeModules.includes(s.requiresModule),
    );
  }, [activeModules]);

  const step = visibleSteps[current - 1];

  const next = useCallback(async () => {
    try {
      // Dernière étape : on remonte le compte canonique, pas le rang affiché.
      // Un module coupé raccourcit le tour, et le serveur ne le marquerait
      // jamais terminé si le rang restait en deçà de TOUR_STEP_COUNT.
      const isLast = current >= visibleSteps.length;
      await fetch("/api/onboarding/step", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ step: isLast ? TOUR_STEP_COUNT : current }),
      });
    } catch {
      /* ignore */
    }
    if (current >= visibleSteps.length) {
      onClose();
      return;
    }
    setCurrent((s) => s + 1);
  }, [current, onClose, visibleSteps.length]);

  const prev = useCallback(() => {
    // Retour arrière purement local : ne marque rien comme complété.
    setCurrent((s) => Math.max(1, s - 1));
  }, []);

  const skip = useCallback(async () => {
    try {
      await fetch("/api/onboarding/dismiss", { method: "POST" });
    } catch {
      /* ignore */
    }
    onClose();
  }, [onClose]);

  useEffect(() => {
    if (!step) return;
    // Navigue vers la page où vit la cible de l'étape, puis déclenche onEnter.
    // Le polling de TourStep repositionne le popover dès que l'ancre apparaît.
    if (step.path) {
      router.push(step.path({ demoSpaceSlug }));
    }
    if (step.onEnter) {
      Promise.resolve(step.onEnter({ demoSpaceSlug })).catch(() => {});
    }
    return () => {
      // Sortie de l'étape (avance, retour arrière ou fermeture du tour).
      if (step.onLeave) {
        Promise.resolve(step.onLeave({ demoSpaceSlug })).catch(() => {});
      }
    };
  }, [step, demoSpaceSlug, router]);

  if (!step) return null;
  return (
    <TourStep
      title={step.titleKey ? t(step.titleKey) : (step.title ?? "")}
      body={step.body({ demoSpaceSlug })}
      targetSelector={step.targetSelector}
      stepNumber={current}
      totalSteps={visibleSteps.length}
      onNext={next}
      onPrev={prev}
      onSkip={skip}
      canAdvance
      canGoBack={current > 1}
    />
  );
}
