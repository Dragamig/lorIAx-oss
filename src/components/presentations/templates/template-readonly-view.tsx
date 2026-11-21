"use client";

import { useState } from "react";
import { useTranslations } from "next-intl";
import { ArrowLeft } from "lucide-react";
import { Link } from "@/i18n/routing";
import { Button } from "@/components/ui/button";
import { Hint } from "@/components/ui/hint";
import type { Deck } from "@/lib/presentations/deck";
import { TemplateActionButton } from "./template-action-button";
import { TemplateEditBanner } from "./template-edit-banner";
import { TemplatePreviewView } from "./template-preview-view";
import { useTemplateDisplay } from "./template-display";
import { useTemplateFlows } from "./use-template-flows";
import { useTemplates, type TemplateSummary } from "./use-templates";

/**
 * Modèle ouvert par un membre : aperçu sans moteur (bandeau lecture seule,
 * grande vue, bande de diapositives) et « Utiliser ce modèle », qui crée une
 * présentation dans l'espace choisi par le flux habituel.
 */
export function TemplateReadOnlyView({
  template,
  deck,
  spaces,
}: {
  template: TemplateSummary;
  deck: Deck;
  spaces: { id: string; name: string }[];
}) {
  const t = useTranslations("presentations");
  const tt = useTranslations("presentations.templates");
  const display = useTemplateDisplay();
  const [spaceId, setSpaceId] = useState(spaces[0]?.id ?? "");
  const [busy, setBusy] = useState(false);
  // Aucune lecture de la liste : seule l'écriture « utiliser » sert ici.
  const tpl = useTemplates({ enabled: false });
  const flows = useTemplateFlows({ spaceId, tpl });
  const name = display.name(template);

  const disabledReason = !spaceId ? t("noSpace") : busy ? t("saving") : undefined;

  async function use() {
    setBusy(true);
    const ok = await flows.use(template);
    if (!ok) setBusy(false);
  }

  return (
    <div className="flex h-full flex-col" data-testid="template-readonly">
      <TemplateEditBanner kind="readOnly" name={name}>
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
      </TemplateEditBanner>
      <div className="min-h-0 flex-1 overflow-y-auto p-4">
        <div className="mx-auto grid max-w-4xl gap-4">
          <TemplatePreviewView
            deck={deck}
            description={display.description(template)}
            isLorIAx={template.templateOrigin === "lorIAx"}
            hidden={false}
          />
          <div className="flex flex-wrap items-center justify-end gap-2">
            {spaces.length > 1 ? (
              <label className="flex items-center gap-2 text-sm">
                <span className="text-muted-foreground">{tt("chooseSpace")}</span>
                <select
                  value={spaceId}
                  onChange={(e) => setSpaceId(e.target.value)}
                  className="border-input bg-background min-h-6 rounded-md border px-2 py-1 text-sm"
                >
                  {spaces.map((s) => (
                    <option key={s.id} value={s.id}>
                      {s.name}
                    </option>
                  ))}
                </select>
              </label>
            ) : null}
            <TemplateActionButton
              action="use"
              showLabel
              onClick={() => void use()}
              disabledReason={disabledReason}
              className="bg-primary text-primary-foreground hover:bg-primary/90"
            />
          </div>
        </div>
      </div>
    </div>
  );
}
