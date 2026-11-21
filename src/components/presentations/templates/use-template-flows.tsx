"use client";

/**
 * Parcours des modèles (T10) : chaque action appelle le hook de données, puis
 * émet un toast (erreurs traduites par statut, « Annuler » quand réversible) et
 * navigue si besoin. Les composants restent purement présentationnels.
 */
import { useTranslations } from "next-intl";
import { toast } from "sonner";
import { useRouter } from "@/i18n/routing";
import { getTemplateAction } from "./template-actions";
import { useTemplateDisplay } from "./template-display";
import { UndoToastButton } from "./undo-toast-button";
import type { TemplateActionError, TemplateSummary, useTemplates } from "./use-templates";

type Templates = ReturnType<typeof useTemplates>;

const STATUS_KEY: Record<number, string> = {
  0: "errorNetwork",
  403: "errorForbidden",
  404: "errorNotFound",
  409: "errorConflict",
  422: "errorInvalid",
};

export function useTemplateFlows({ spaceId, tpl }: { spaceId: string; tpl: Templates }) {
  const t = useTranslations("presentations.templates");
  const router = useRouter();
  const display = useTemplateDisplay();

  const fail = async (action: "use" | "saveAsTemplate" | "hide" | "restore" | "reset", e: TemplateActionError) => {
    const def = getTemplateAction(action);
    const key = STATUS_KEY[e.status];
    toast.error(t(def.toastErrorKey!), key ? { description: t(key) } : undefined);
    // Un conflit ou un modèle disparu : la liste affichée est périmée.
    if (e.status === 404 || e.status === 409) await tpl.refresh();
  };

  return {
    /** Crée une présentation depuis un modèle, puis l'ouvre. */
    async use(template: TemplateSummary): Promise<boolean> {
      const res = await tpl.use(template.id, spaceId);
      if (!res.ok) {
        await fail("use", res);
        return false;
      }
      toast.success(t("toastUsed", { name: display.name(template) }));
      router.push(`/presentations/${String(res.presentation.id)}`);
      return true;
    },

    /** Retire (masque) un modèle ; le toast propose de le rétablir. */
    async retire(template: TemplateSummary): Promise<boolean> {
      const res = await tpl.retire(template.id);
      if (!res.ok) {
        await fail("hide", res);
        return false;
      }
      toast.success(t("toastHidden", { name: display.name(template) }), {
        action: (
          <UndoToastButton
            label={t("undo")}
            tip={t("undoTip")}
            onClick={async () => {
              const back = await tpl.unhide(template.id);
              if (back.ok) toast.success(t("toastUndone"));
              else await fail("hide", back);
            }}
          />
        ),
      });
      return true;
    },

    /** Rétablit un modèle masqué dans la liste des membres. */
    async restore(template: TemplateSummary): Promise<boolean> {
      const res = await tpl.unhide(template.id);
      if (!res.ok) {
        await fail("restore", res);
        return false;
      }
      toast.success(t("toastRestored", { name: display.name(template) }));
      return true;
    },

    /** Remplace le contenu d'un modèle LorIAx par la version livrée. */
    async reset(template: TemplateSummary): Promise<boolean> {
      const res = await tpl.reset(template.id, template.version);
      if (!res.ok) {
        await fail("reset", res);
        return false;
      }
      toast.success(t("toastReset", { name: display.name(template) }));
      return true;
    },

    /** Enregistre une présentation existante comme modèle (copie). */
    async save(presentationId: string, input: { name: string; description?: string }) {
      const res = await tpl.saveAsTemplate(presentationId, input);
      if (!res.ok) {
        await fail("saveAsTemplate", res);
        return false;
      }
      toast.success(t("toastSaved", { name: input.name }));
      return true;
    },

    /** Ouvre le modèle dans l'éditeur. */
    edit(template: TemplateSummary) {
      router.push(`/presentations/${template.id}`);
      toast.success(t("toastEditOpened"));
    },
  };
}
