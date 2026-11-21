"use client";

import { useState } from "react";
import { useTranslations } from "next-intl";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Loader2, ArrowRight, ArrowLeft, SkipForward, Briefcase } from "lucide-react";
import type { SetupData } from "@/app/[locale]/(setup)/setup/page";
import { setupFetch } from "@/lib/setup/client";

// Sector keys — invariant identifiers used for i18n lookup only
const SECTOR_KEYS = [
  "agriculture",
  "artisanat",
  "association",
  "btp",
  "commerce",
  "communication",
  "conseil",
  "culture",
  "education",
  "energie",
  "finance",
  "immobilier",
  "industrie",
  "informatique",
  "juridique",
  "logistique",
  "recherche",
  "sante",
  "services",
  "tourisme",
] as const;

interface StepContextProps {
  data: SetupData;
  onUpdate: (context: SetupData["context"]) => void;
  onNext: () => void;
  onSkip: () => void;
  onBack?: () => void;
}

export function StepContext({ data, onUpdate, onNext, onSkip, onBack }: StepContextProps) {
  const t = useTranslations("setup.context");
  const [website, setWebsite] = useState(data.context.website);
  const [sector, setSector] = useState(data.context.sector);
  const [presentation, setPresentation] = useState(data.context.presentation);
  const [values, setValues] = useState(data.context.values);
  const [saving, setSaving] = useState(false);

  async function handleNext() {
    setSaving(true);
    try {
      const res = await setupFetch("/api/setup/context", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ website, sector, presentation, values }),
      });
      if (!res.ok) throw new Error(t("toasts.saveError"));

      onUpdate({ website, sector, presentation, values });
      onNext();
    } catch {
      alert(t("toasts.saveError"));
    } finally {
      setSaving(false);
    }
  }

  return (
    <div className="space-y-6">
      <div className="text-center">
        <Briefcase className="h-12 w-12 text-primary mx-auto mb-3" />
        <h2 className="text-2xl font-bold">{t("title")}</h2>
        <p className="text-muted-foreground mt-1">
          {t("description")}
        </p>
      </div>

      <div className="space-y-4">
        <div className="space-y-2">
          <Label htmlFor="ctx-website">{t("websiteLabel")}</Label>
          <Input
            id="ctx-website"
            value={website}
            onChange={(e) => setWebsite(e.target.value)}
            placeholder={t("websitePlaceholder")}
            type="url"
          />
        </div>

        <div className="space-y-2">
          <Label htmlFor="ctx-sector">{t("sectorLabel")}</Label>
          <Input
            id="ctx-sector"
            value={sector}
            onChange={(e) => setSector(e.target.value)}
            placeholder={t("sectorPlaceholder")}
            list="sectors-list"
          />
          <datalist id="sectors-list">
            {SECTOR_KEYS.map((key) => (
              <option key={key} value={t(`sectors.${key}`)} />
            ))}
          </datalist>
        </div>

        <div className="space-y-2">
          <Label htmlFor="ctx-presentation">{t("presentationLabel")}</Label>
          <textarea
            id="ctx-presentation"
            value={presentation}
            onChange={(e) => setPresentation(e.target.value)}
            placeholder={t("presentationPlaceholder")}
            className="w-full rounded-md border border-input bg-background px-3 py-2 text-sm min-h-[100px] resize-y"
          />
        </div>

        <div className="space-y-2">
          <Label htmlFor="ctx-values">{t("valuesLabel")}</Label>
          <textarea
            id="ctx-values"
            value={values}
            onChange={(e) => setValues(e.target.value)}
            placeholder={t("valuesPlaceholder")}
            className="w-full rounded-md border border-input bg-background px-3 py-2 text-sm min-h-[80px] resize-y"
          />
        </div>
      </div>

      <div className="flex justify-between">
        <div className="flex gap-2">
          {onBack && (
            <Button variant="ghost" onClick={onBack} className="gap-2">
              <ArrowLeft className="h-4 w-4" />
              {t("previous")}
            </Button>
          )}
          <Button variant="ghost" onClick={onSkip} className="gap-2">
            <SkipForward className="h-4 w-4" />
            {t("skip")}
          </Button>
        </div>
        <Button onClick={handleNext} disabled={saving} className="gap-2">
          {saving ? (
            <Loader2 className="h-4 w-4 animate-spin" />
          ) : (
            <ArrowRight className="h-4 w-4" />
          )}
          {t("next")}
        </Button>
      </div>
    </div>
  );
}
