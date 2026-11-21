"use client";

// loriax-app/src/components/onboarding/badges-panel.tsx
// Panneau « Mes badges » : état acquis / verrouillé pour chacun des 13 badges.

import { useTranslations } from "next-intl";
import { useOnboardingProgress } from "./hooks/use-onboarding-progress";
import type { BadgeId } from "@/lib/onboarding/types";

interface BadgeDef {
  id: BadgeId;
  /** Libellé littéral. Les badges traduits renseignent `labelKey` à la place. */
  label?: string;
  /** Clé i18n racine du libellé. */
  labelKey?: string;
  icon: string;
}

const ALL_BADGES: ReadonlyArray<BadgeDef> = [
  { id: "space", label: "Premier espace", icon: "🏠" },
  { id: "doc", label: "Premier document", icon: "📝" },
  { id: "base", label: "Première base", icon: "🗂️" },
  { id: "event", label: "Premier événement", icon: "📅" },
  { id: "visio", label: "Première visio", icon: "🎥" },
  { id: "partage", label: "Premier partage", icon: "🔗" },
  { id: "tasks", label: "Première tâche suivie", icon: "✅" },
  {
    id: "presentation",
    labelKey: "onboarding.badges.presentation",
    icon: "📽️",
  },
  { id: "ai", label: "Première question à l’IA", icon: "🤖" },
  { id: "palette", label: "Palette de commandes", icon: "⌨️" },
  { id: "tutorial_complete", label: "Tuto terminé", icon: "🎓" },
  { id: "first_collab", label: "Première collaboration", icon: "🤝" },
  { id: "explorer", label: "Explorateur", icon: "🧭" },
];

export function BadgesPanel() {
  const t = useTranslations();
  const { progress } = useOnboardingProgress();
  const owned = new Set<string>(
    progress?.badges?.map((b) => b.id) ?? [],
  );

  return (
    <section id="badges" className="space-y-3">
      <h2 className="text-lg font-semibold">Mes badges</h2>
      <p className="text-sm text-muted-foreground">
        Débloque des badges en explorant les fonctionnalités de LorIAx.
      </p>
      <div className="grid grid-cols-3 gap-3 sm:grid-cols-4 md:grid-cols-5">
        {ALL_BADGES.map((b) => {
          const isOwned = owned.has(b.id);
          return (
            <div
              key={b.id}
              className={`flex flex-col items-center rounded-lg border p-3 text-center ${
                isOwned ? "bg-primary/5" : "opacity-40"
              }`}
              title={isOwned ? "Débloqué" : "Verrouillé"}
            >
              <span className="text-2xl" aria-hidden>
                {b.icon}
              </span>
              <span className="mt-1 text-xs">
                {b.labelKey ? t(b.labelKey) : b.label}
              </span>
            </div>
          );
        })}
      </div>
    </section>
  );
}
