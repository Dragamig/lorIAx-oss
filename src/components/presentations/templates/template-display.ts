"use client";

import { useTranslations } from "next-intl";
import type { TemplateSummary } from "./use-templates";

/**
 * Nom et description affichés d'un modèle : traduits pour les modèles LorIAx
 * (clé `lorIAx.<seedKey>`), sinon ceux de la base.
 */
export function useTemplateDisplay() {
  const t = useTranslations("presentations.templates");
  const translated = (tpl: TemplateSummary, field: "name" | "description") => {
    if (tpl.templateOrigin !== "lorIAx" || !tpl.templateSeedKey) return null;
    const key = `lorIAx.${tpl.templateSeedKey}.${field}`;
    return t.has(key) ? t(key) : null;
  };
  return {
    name: (tpl: TemplateSummary) => translated(tpl, "name") ?? tpl.title,
    description: (tpl: TemplateSummary) =>
      translated(tpl, "description") ?? tpl.templateDescription ?? "",
  };
}
