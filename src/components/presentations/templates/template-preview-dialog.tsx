"use client";

import { useEffect, useState } from "react";
import { useTranslations } from "next-intl";
import type { Deck } from "@/lib/presentations/deck";
import { TemplateActionButton } from "./template-action-button";
import { TemplatePreviewView } from "./template-preview-view";
import { useTemplateDisplay } from "./template-display";
import { TemplateDialogShell } from "./template-dialog-shell";
import type { TemplateSummary } from "./use-templates";

/**
 * Grand aperçu d'un modèle et bande de diapositives. Actions : membre = Utiliser ;
 * admin = Utiliser, Modifier, Retirer (si visible), Réinitialiser (désactivé hors
 * modèles LorIAx). Le rôle vient du serveur ; les boutons admin ne sont pas rendus
 * pour un membre.
 */
export function TemplatePreviewDialog({
  template,
  isAdmin,
  handlers,
  onClose,
}: {
  template: TemplateSummary;
  isAdmin: boolean;
  handlers: Record<"use" | "edit" | "hide" | "restore" | "reset", () => void>;
  onClose: () => void;
}) {
  const t = useTranslations("presentations.templates");
  const display = useTemplateDisplay();
  const name = display.name(template);
  const description = display.description(template);
  const [deck, setDeck] = useState<Deck | null>(null);
  const [failed, setFailed] = useState(false);
  const [attempt, setAttempt] = useState(0);

  useEffect(() => {
    let cancelled = false;
    fetch(`/api/presentations/templates/${template.id}`)
      .then((res) => {
        if (!res.ok) throw new Error("load failed");
        return res.json();
      })
      .then((data: { deck: Deck }) => {
        if (!cancelled) setDeck(data.deck);
      })
      .catch(() => {
        if (!cancelled) setFailed(true);
      });
    return () => {
      cancelled = true;
    };
  }, [template.id, attempt]);

  const isLorIAx = template.templateOrigin === "lorIAx";
  const hidden = Boolean(template.templateHiddenAt);

  return (
    <TemplateDialogShell
      open
      onClose={onClose}
      title={name}
      className="sm:max-w-3xl"
      footer={
        <>
          {isAdmin && !hidden ? (
            <TemplateActionButton action="hide" variant="remove" showLabel onClick={handlers.hide} className="text-destructive" />
          ) : null}
          {isAdmin && hidden ? (
            <TemplateActionButton action="restore" showLabel onClick={handlers.restore} />
          ) : null}
          {isAdmin ? <TemplateActionButton action="edit" showLabel onClick={handlers.edit} /> : null}
          {isAdmin ? (
            <TemplateActionButton
              action="reset"
              showLabel
              onClick={handlers.reset}
              disabledReason={isLorIAx ? undefined : t("resetUnavailableTip")}
            />
          ) : null}
          <TemplateActionButton action="use" showLabel onClick={handlers.use} disabledReason={hidden ? t("useHiddenTip") : undefined} className="bg-primary text-primary-foreground hover:bg-primary/90" />
        </>
      }
    >
      <TemplatePreviewView
        deck={deck}
        failed={failed}
        onRetry={() => {
          setFailed(false);
          setAttempt((n) => n + 1);
        }}
        description={description}
        isLorIAx={isLorIAx}
        hidden={hidden}
      />
    </TemplateDialogShell>
  );
}
