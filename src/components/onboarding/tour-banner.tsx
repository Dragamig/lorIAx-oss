"use client";

// loriax-app/src/components/onboarding/tour-banner.tsx
// Bannière de reprise du tour pour les utilisateurs ayant démarré mais pas terminé.

import { useState } from "react";
import { X } from "lucide-react";
import { useOnboardingProgress } from "./hooks/use-onboarding-progress";
import { TOUR_STEP_COUNT } from "@/lib/onboarding/types";

interface TourBannerProps {
  onResume: () => void;
}

export function TourBanner({ onResume }: TourBannerProps) {
  const { progress } = useOnboardingProgress();
  const [hidden, setHidden] = useState(false);
  if (hidden || !progress) return null;
  if (progress.completedAt || progress.dismissedAt) return null;
  if (!progress.startedAt) return null;
  return (
    <div className="flex items-center justify-between gap-3 bg-primary/10 px-4 py-2 text-sm">
      <span>
        Continue ta prise en main ({progress.currentStep}/{TOUR_STEP_COUNT})
      </span>
      <div className="flex items-center gap-2">
        <button onClick={onResume} className="underline">
          Reprendre
        </button>
        <button
          onClick={() => setHidden(true)}
          aria-label="Masquer pour cette session"
          className="rounded p-1 hover:bg-primary/20"
        >
          <X className="h-4 w-4" />
        </button>
      </div>
    </div>
  );
}
