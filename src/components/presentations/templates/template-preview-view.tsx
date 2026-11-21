"use client";

import { useState } from "react";
import { useTranslations } from "next-intl";
import { Loader2, RefreshCw } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Hint } from "@/components/ui/hint";
import { DeckThumbnail } from "@/components/presentations/deck-thumbnail";
import type { Deck } from "@/lib/presentations/deck";
import { cn } from "@/lib/utils";
import { TemplateBadge } from "./template-badge";

/**
 * Corps d'aperçu d'un modèle : grande vue, bande de diapositives, origine,
 * description. Partagé par la boîte d'aperçu (document chargé à la demande) et
 * par la page d'un modèle ouvert en lecture seule (document déjà chargé).
 */
export function TemplatePreviewView({
  deck,
  failed = false,
  onRetry,
  description,
  isLorIAx,
  hidden,
  showOrigin = true,
}: {
  deck: Deck | null;
  failed?: boolean;
  onRetry?: () => void;
  description: string;
  isLorIAx: boolean;
  hidden: boolean;
  /** Faux hors d'un modèle : pas de pastille d'origine (LorIAx, organisation). */
  showOrigin?: boolean;
}) {
  const t = useTranslations("presentations.templates");
  const [current, setCurrent] = useState(0);
  const slides = deck?.slides ?? [];
  const only = (index: number): Deck | null =>
    deck && slides[index] ? ({ ...deck, slides: [slides[index]] } as Deck) : null;
  const big = only(current);

  return (
    <div className="grid gap-4 md:grid-cols-[1fr_14rem]">
      <div className="grid min-w-0 gap-2">
        <div className="bg-muted flex aspect-video items-center justify-center overflow-hidden rounded-md border">
          {big ? (
            <DeckThumbnail deck={big} className="h-full w-full" />
          ) : failed ? (
            <span className="text-muted-foreground flex flex-col items-center gap-2 px-4 text-center text-sm" role="alert">
              {t("loadError")}
              <Hint label={t("retryTip")}>
                <Button type="button" variant="outline" size="sm" aria-label={t("retry")} onClick={onRetry}>
                  <RefreshCw aria-hidden="true" />
                  {t("retry")}
                </Button>
              </Hint>
            </span>
          ) : (
            <Loader2 className="text-muted-foreground size-6 animate-spin" aria-hidden="true" />
          )}
        </div>
        <div role="group" aria-label={t("previewStrip")} className="flex gap-2 overflow-x-auto pb-1">
          {slides.map((_, i) => {
            const one = only(i);
            return (
              <button
                key={i}
                type="button"
                aria-label={t("slideLabel", { number: i + 1 })}
                aria-current={i === current}
                title={t("slideLabel", { number: i + 1 })}
                onClick={() => setCurrent(i)}
                className={cn(
                  "bg-muted aspect-video min-h-6 min-w-6 w-24 flex-none overflow-hidden rounded border focus-visible:ring-3 focus-visible:ring-ring/50 outline-none",
                  i === current && "border-ring ring-2 ring-ring"
                )}
              >
                {one ? <DeckThumbnail deck={one} className="h-full w-full" /> : null}
              </button>
            );
          })}
        </div>
      </div>
      <div className="grid content-start gap-2 text-sm">
        {showOrigin ? (
          <div className="flex gap-1.5">
            <TemplateBadge kind={isLorIAx ? "lorIAx" : "org"} />
            {hidden ? <TemplateBadge kind="hidden" /> : null}
          </div>
        ) : null}
        {description ? <p>{description}</p> : null}
        {deck ? (
          <dl className="grid grid-cols-[auto_1fr] gap-x-3 gap-y-1">
            <dt className="text-muted-foreground">{t("metaSlides")}</dt>
            <dd>{slides.length}</dd>
          </dl>
        ) : null}
      </div>
    </div>
  );
}
