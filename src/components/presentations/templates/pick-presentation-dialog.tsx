"use client";

import { useTranslations } from "next-intl";
import { TemplateDialogShell } from "./template-dialog-shell";
import { TEMPLATE_GRID_CLASS, TemplateTile } from "./template-tile";
import { TileThumbnailPlaceholder } from "./tile-thumbnail-placeholder";

export interface PickablePresentation {
  id: string;
  title: string;
  slideCount: number;
}

/** Choix de la présentation à enregistrer comme modèle (état vide admin). */
export function PickPresentationDialog({
  presentations,
  onPick,
  onClose,
}: {
  presentations: PickablePresentation[];
  onPick: (p: PickablePresentation) => void;
  onClose: () => void;
}) {
  const t = useTranslations("presentations.templates");
  return (
    <TemplateDialogShell open onClose={onClose} title={t("pickTitle")} className="sm:max-w-3xl">
      <div className={TEMPLATE_GRID_CLASS}>
        {presentations.map((p) => (
          <TemplateTile
            key={p.id}
            title={p.title}
            subtitle={t("slideCount", { count: p.slideCount })}
            tip={t("pickTip", { name: p.title })}
            ariaLabel={t("pickTip", { name: p.title })}
            thumbnail={<TileThumbnailPlaceholder />}
            onClick={() => onPick(p)}
          />
        ))}
      </div>
    </TemplateDialogShell>
  );
}
