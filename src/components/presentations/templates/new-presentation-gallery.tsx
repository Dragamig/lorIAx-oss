"use client";

import { useTranslations } from "next-intl";
import { AlertTriangle, Plus, RefreshCw } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Hint } from "@/components/ui/hint";
import { useTemplateDisplay } from "./template-display";
import { TemplateDialogShell } from "./template-dialog-shell";
import { TEMPLATE_GRID_CLASS, TemplateTile, TemplateTileSkeleton } from "./template-tile";
import { TileThumbnailPlaceholder } from "./tile-thumbnail-placeholder";
import type { TemplateSummary } from "./use-templates";

/** Galerie de création : tuile Vierge puis modèles non masqués, un clic = utiliser. */
export function NewPresentationGallery({
  templates,
  loading,
  error,
  onRetry,
  onBlank,
  onUse,
  onClose,
}: {
  templates: TemplateSummary[];
  loading: boolean;
  error: boolean;
  onRetry: () => void;
  onBlank: () => void;
  onUse: (template: TemplateSummary) => void;
  onClose: () => void;
}) {
  const t = useTranslations("presentations.templates");
  const display = useTemplateDisplay();
  return (
    <TemplateDialogShell open onClose={onClose} title={t("galleryTitle")} className="sm:max-w-3xl">
      <div className={TEMPLATE_GRID_CLASS} aria-busy={loading || undefined}>
        <TemplateTile
          blank
          title={t("blank")}
          subtitle={t("blankSubtitle")}
          tip={t("blankTip")}
          ariaLabel={t("blankTip")}
          thumbnail={<Plus className="size-7" aria-hidden="true" />}
          onClick={onBlank}
        />
        {loading
          ? Array.from({ length: 3 }, (_, i) => <TemplateTileSkeleton key={i} />)
          : templates
          .filter((tpl) => !tpl.templateHiddenAt)
          .map((tpl) => (
            <TemplateTile
              key={tpl.id}
              title={display.name(tpl)}
              subtitle={t("slideCount", { count: tpl.slideCount })}
              badge={tpl.templateOrigin === "lorIAx" ? "lorIAx" : "org"}
              tip={t("useFromTip", { name: display.name(tpl) })}
              ariaLabel={t("useFromTip", { name: display.name(tpl) })}
              thumbnail={<TileThumbnailPlaceholder />}
              onClick={() => onUse(tpl)}
            />
          ))}
      </div>
      {error ? (
        <div
          role="alert"
          className="border-destructive/30 bg-destructive/10 text-destructive flex items-center gap-3 rounded-lg border p-3 text-sm"
        >
          <AlertTriangle className="size-5 flex-none" aria-hidden="true" />
          <strong className="min-w-0 flex-1">{t("loadError")}</strong>
          <Hint label={t("retryTip")}>
            <Button type="button" variant="outline" size="sm" aria-label={t("retry")} onClick={onRetry}>
              <RefreshCw aria-hidden="true" />
              {t("retry")}
            </Button>
          </Hint>
        </div>
      ) : null}
    </TemplateDialogShell>
  );
}
