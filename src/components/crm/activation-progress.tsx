"use client";

import { useEffect, useRef } from "react";
import { Loader2 } from "lucide-react";
import { useTranslations } from "next-intl";

export interface ActivationProgressProps {
  /** Libellés déjà traduits des étapes que le serveur exécute en une seule transaction. */
  steps: string[];
}

/** Progression annoncée en `aria-live` : une seule réponse serveur, donc toutes les étapes sont « en cours ». */
export function ActivationProgress({ steps }: ActivationProgressProps) {
  const t = useTranslations("crm");
  const ref = useRef<HTMLDivElement>(null);
  // Monté au lancement de l'écriture : ramène le bloc dans le champ même si le récapitulatif est déplié.
  useEffect(() => {
    ref.current?.scrollIntoView?.({ block: "nearest" });
  }, []);
  return (
    <div ref={ref} role="status" aria-live="polite" aria-label={t("activation.progress.aria")} className="flex flex-col gap-0.5 rounded-xl border border-border px-3 py-2">
      <p className="text-sm font-semibold">{t("activation.progress.running")}</p>
      {steps.map((step) => (
        <div key={step} className="flex min-h-6 items-center gap-2 text-[13px]">
          <Loader2 className="size-3.5 flex-none animate-spin motion-reduce:animate-none" aria-hidden="true" />
          <span>{step}</span>
        </div>
      ))}
    </div>
  );
}
