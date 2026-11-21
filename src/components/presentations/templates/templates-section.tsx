"use client";

import { useTranslations } from "next-intl";
import { AlertTriangle, BookmarkPlus, LayoutTemplate, RefreshCw } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Hint } from "@/components/ui/hint";
import { cn } from "@/lib/utils";
import { useTemplateDisplay } from "./template-display";
import { TEMPLATE_GRID_CLASS, TemplateTile, TemplateTileSkeleton } from "./template-tile";
import { TileThumbnailPlaceholder } from "./tile-thumbnail-placeholder";
import type { TemplateFilter, TemplateSummary, useTemplates } from "./use-templates";

type Templates = ReturnType<typeof useTemplates>;

/** Section « Modèles » de la liste : filtres, grille, états chargement / erreur / vide. */
export function TemplatesSection({
  tpl,
  isAdmin,
  onPreview,
  onSaveFromPresentation,
}: {
  tpl: Templates;
  isAdmin: boolean;
  onPreview: (template: TemplateSummary) => void;
  onSaveFromPresentation: () => void;
}) {
  const t = useTranslations("presentations.templates");
  const display = useTemplateDisplay();
  // Défense en profondeur : un membre ne voit jamais un modèle masqué.
  const visible = (tpl.templates ?? []).filter((x) => isAdmin || !x.templateHiddenAt);
  const orgCount = tpl.allTemplates.filter(
    (x) => x.templateOrigin !== "lorIAx" && (isAdmin || !x.templateHiddenAt)
  ).length;
  const total = tpl.allTemplates.filter((x) => isAdmin || !x.templateHiddenAt).length;

  const chip = (value: TemplateFilter, label: string) => (
    <Hint label={label} key={value}>
      <button
        type="button"
        aria-pressed={tpl.filter === value}
        aria-label={label}
        onClick={() => tpl.setFilter(value)}
        className={cn(
          "min-h-6 rounded-full border px-3 text-xs font-medium outline-none focus-visible:ring-3 focus-visible:ring-ring/50",
          tpl.filter === value
            ? "border-primary bg-primary/10 text-primary"
            : "border-border text-muted-foreground hover:text-foreground"
        )}
      >
        {label}
      </button>
    </Hint>
  );

  let body;
  if (tpl.isLoading) {
    body = (
      <div className={TEMPLATE_GRID_CLASS} aria-busy="true" aria-label={t("title")}>
        {Array.from({ length: 4 }, (_, i) => (
          <TemplateTileSkeleton key={i} />
        ))}
      </div>
    );
  } else if (tpl.error) {
    body = (
      <div
        role="alert"
        className="border-destructive/30 bg-destructive/10 text-destructive flex items-center gap-3 rounded-lg border p-4 text-sm"
      >
        <AlertTriangle className="size-5 flex-none" aria-hidden="true" />
        <div className="min-w-0 flex-1">
          <strong>{t("loadError")}</strong>
        </div>
        <Hint label={t("retryTip")}>
          <Button type="button" variant="outline" size="sm" aria-label={t("retry")} onClick={() => void tpl.refresh()}>
            <RefreshCw aria-hidden="true" />
            {t("retry")}
          </Button>
        </Hint>
      </div>
    );
  } else if (visible.length === 0) {
    body = (
      <div className="text-muted-foreground flex flex-col items-center gap-3 rounded-lg border border-dashed p-8 text-center text-sm">
        <LayoutTemplate className="size-8" aria-hidden="true" />
        {isAdmin ? (
          <>
            <strong className="text-foreground">{t("emptyAdminTitle")}</strong>
            <span>{t("emptyAdminBody")}</span>
            <Hint label={t("saveAsTemplateTip")}>
              <Button type="button" variant="outline" size="sm" aria-label={t("emptyAction")} onClick={onSaveFromPresentation}>
                <BookmarkPlus aria-hidden="true" />
                {t("emptyAction")}
              </Button>
            </Hint>
          </>
        ) : (
          <span>{t("emptyMemberBody")}</span>
        )}
      </div>
    );
  } else {
    body = (
      <div className={TEMPLATE_GRID_CLASS}>
        {visible.map((x) => (
          <TemplateTile
            key={x.id}
            title={display.name(x)}
            subtitle={t("slideCount", { count: x.slideCount })}
            badge={x.templateHiddenAt ? "hidden" : x.templateOrigin === "lorIAx" ? "lorIAx" : "org"}
            tip={t("previewTip", { name: display.name(x) })}
            ariaLabel={t("previewTip", { name: display.name(x) })}
            thumbnail={<TileThumbnailPlaceholder />}
            onClick={() => onPreview(x)}
          />
        ))}
      </div>
    );
  }

  return (
    <section aria-labelledby="templates-heading" className="mt-10">
      <div className="mb-3 flex flex-wrap items-center justify-between gap-2">
        <h2 id="templates-heading" className="text-lg font-semibold">
          {t("title")}
          {!tpl.isLoading && !tpl.error ? (
            <span className="text-muted-foreground ml-2 text-sm font-normal">{total}</span>
          ) : null}
        </h2>
        <div role="group" aria-label={t("filterGroup")} className="flex gap-1.5">
          {chip("all", t("filterAll"))}
          {chip("lorIAx", t("filterLorIAx"))}
          {chip("organization", t("filterOrg", { count: orgCount }))}
        </div>
      </div>
      {body}
    </section>
  );
}
