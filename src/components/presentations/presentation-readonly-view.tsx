"use client";

import { useTranslations } from "next-intl";
import { ArrowLeft, Eye } from "lucide-react";
import { Link } from "@/i18n/routing";
import { Button } from "@/components/ui/button";
import { Hint } from "@/components/ui/hint";
import type { Deck } from "@/lib/presentations/deck";
import { TemplatePreviewView } from "./templates/template-preview-view";

/**
 * Présentation ouverte par un lecteur de l'espace : aperçu sans moteur, comme
 * pour un membre devant un modèle. Le moteur n'est pas monté, il n'y a donc
 * aucun enregistrement qui finirait en 403.
 */
export function PresentationReadOnlyView({ title, deck }: { title: string; deck: Deck }) {
  const t = useTranslations("presentations");
  return (
    <div className="flex h-full flex-col" data-testid="presentation-readonly">
      <div
        role="status"
        data-testid="presentation-readonly-banner"
        className="flex min-h-9 shrink-0 items-center gap-2 border-b border-primary/30 bg-primary/10 px-3 py-1 text-sm text-foreground"
      >
        <Eye className="h-4 w-4 shrink-0 text-primary" aria-hidden="true" />
        <span className="min-w-0 flex-1 truncate">{t("readOnlyBanner", { name: title })}</span>
        <Hint label={t("backToListTip")}>
          <Button
            variant="ghost"
            size="xs"
            nativeButton={false}
            aria-label={t("backToList")}
            render={<Link href="/presentations" />}
          >
            <ArrowLeft aria-hidden="true" />
            {t("backToList")}
          </Button>
        </Hint>
      </div>
      <div className="min-h-0 flex-1 overflow-y-auto p-4">
        <div className="mx-auto max-w-4xl">
          <TemplatePreviewView deck={deck} description="" isLorIAx={false} hidden={false} showOrigin={false} />
        </div>
      </div>
    </div>
  );
}
