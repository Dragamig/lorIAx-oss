"use client";

/**
 * Éditeur d'une présentation sur sa page dédiée.
 *
 * Deux cas : présentation ordinaire (un admin peut l'enregistrer comme modèle)
 * et modèle ouvert par un admin (bandeau et « Terminer »). Un membre qui ouvre
 * un modèle n'arrive pas ici : la page lui sert un aperçu sans moteur. Le rôle
 * vient du serveur ; le PUT d'un modèle refuse de toute façon un non-admin.
 */
import { useRef, useState } from "react";
import { useTranslations } from "next-intl";
import { toast } from "sonner";
import { Link, useRouter } from "@/i18n/routing";
import { ArrowLeft } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Hint } from "@/components/ui/hint";
import type { Deck } from "@/lib/presentations/deck";
import { PresentationRuntime, type SaveOutcome } from "./presentation-runtime";
import { TemplateActionButton } from "./templates/template-action-button";
import { TemplateEditBanner } from "./templates/template-edit-banner";
import { SaveAsTemplateDialog } from "./templates/save-as-template-dialog";
import { useTemplateDisplay } from "./templates/template-display";
import { useTemplateFlows } from "./templates/use-template-flows";
import { useTemplates, type TemplateSummary } from "./templates/use-templates";

interface PresentationEditorProps {
  presentationId: string;
  initialDeck: Deck;
  initialVersion: number;
  locale: string;
  title: string;
  /** Espace porteur ; nul pour un modèle. */
  spaceId: string | null;
  isTemplate: boolean;
  isAdmin: boolean;
  templateOrigin: string | null;
  templateSeedKey: string | null;
  /** Modèle masqué, vu par un admin. */
  templateHidden?: boolean;
}

const TEMPLATES_LIST = "/presentations";

export function PresentationEditor({
  presentationId,
  initialDeck,
  initialVersion,
  locale,
  title,
  spaceId,
  isTemplate,
  isAdmin,
  templateOrigin,
  templateSeedKey,
  templateHidden = false,
}: PresentationEditorProps) {
  const t = useTranslations("presentations");
  const tt = useTranslations("presentations.templates");
  const router = useRouter();
  const display = useTemplateDisplay();
  const saveControlRef = useRef<(() => Promise<SaveOutcome>) | null>(null);
  const [finishing, setFinishing] = useState(false);
  const [saveOpen, setSaveOpen] = useState(false);
  const [preparing, setPreparing] = useState(false);
  const [engineReady, setEngineReady] = useState(false);
  // Aucune lecture de la liste des modèles ici : seules les écritures servent.
  const tpl = useTemplates({ enabled: false });
  const flows = useTemplateFlows({ spaceId: spaceId ?? "", tpl });

  const templateName = display.name({
    id: presentationId,
    title,
    templateOrigin,
    templateSeedKey,
  } as TemplateSummary);

  async function finish() {
    if (finishing) return;
    setFinishing(true);
    const outcome = (await saveControlRef.current?.()) ?? "error";
    if (outcome === "saved") {
      toast.success(tt("toastEditDone", { name: templateName }));
      router.push(TEMPLATES_LIST);
      return;
    }
    failSave(outcome);
    setFinishing(false);
  }

  /** Version obsolète : l'éditeur affiche déjà « conflit », rien n'est écrasé. */
  function failSave(outcome: "conflict" | "error") {
    toast.error(tt(outcome === "conflict" ? "errorEditConflict" : "toastSaveError"));
  }

  /**
   * La copie est faite depuis la version stockée : on enregistre d'abord les
   * modifications en attente, et la boîte ne s'ouvre qu'après un succès.
   */
  async function openSaveAsTemplate() {
    if (preparing) return;
    setPreparing(true);
    const outcome = (await saveControlRef.current?.()) ?? "error";
    setPreparing(false);
    if (outcome === "saved") setSaveOpen(true);
    else failSave(outcome);
  }

  const backHref = isTemplate || !spaceId
    ? TEMPLATES_LIST
    : { pathname: TEMPLATES_LIST, query: { spaceId } };

  const banner = isTemplate ? (
    <TemplateEditBanner kind="editing" name={templateName} hidden={templateHidden}>
      <TemplateActionButton
        action="done"
        showLabel
        onClick={() => void finish()}
        disabledReason={finishing ? t("saving") : undefined}
      />
    </TemplateEditBanner>
  ) : null;

  return (
    <>
      <PresentationRuntime
        presentationId={presentationId}
        initialDeck={initialDeck}
        initialVersion={initialVersion}
        mode="edit"
        locale={locale}
        banner={banner}
        saveControlRef={saveControlRef}
        onReadyChange={setEngineReady}
        action={
          <div className="flex items-center gap-1">
            {!isTemplate && isAdmin ? (
              <TemplateActionButton
                action="saveAsTemplate"
                showLabel
                onClick={() => void openSaveAsTemplate()}
                disabledReason={
                  preparing
                    ? t("saving")
                    : engineReady
                      ? undefined
                      : tt("saveAsTemplateNotReadyTip")
                }
              />
            ) : null}
            <Hint label={t("backToListTip")}>
              <Button
                variant="ghost"
                size="xs"
                nativeButton={false}
                aria-label={t("backToList")}
                render={<Link href={backHref} />}
              >
                <ArrowLeft aria-hidden="true" />
                {t("backToList")}
              </Button>
            </Hint>
          </div>
        }
      />
      {saveOpen && !isTemplate && isAdmin ? (
        <SaveAsTemplateDialog
          initialName={title}
          onClose={() => setSaveOpen(false)}
          onSave={(input) => flows.save(presentationId, input)}
        />
      ) : null}
    </>
  );
}
