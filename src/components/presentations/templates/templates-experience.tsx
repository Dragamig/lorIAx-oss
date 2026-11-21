"use client";

import { useState } from "react";
import { useTemplates, type TemplateSummary } from "./use-templates";
import { useTemplateFlows } from "./use-template-flows";
import { useTemplateDisplay } from "./template-display";
import { TemplatesSection } from "./templates-section";
import { NewPresentationGallery } from "./new-presentation-gallery";
import { TemplatePreviewDialog } from "./template-preview-dialog";
import { RetireTemplateDialog } from "./retire-template-dialog";
import { ResetTemplateDialog } from "./reset-template-dialog";
import { PickPresentationDialog, type PickablePresentation } from "./pick-presentation-dialog";
import { SaveAsTemplateDialog } from "./save-as-template-dialog";

type Ui =
  | { kind: "preview"; id: string }
  | { kind: "retire"; id: string }
  | { kind: "reset"; id: string }
  | { kind: "pick" }
  | { kind: "save"; presentation: PickablePresentation }
  | null;

/**
 * Section Modèles et toutes ses boîtes (galerie, aperçu, retrait, réinitialisation,
 * enregistrement). Une seule boîte ouverte à la fois. Le rôle admin vient du
 * serveur (`page.tsx`) ; la sécurité réelle reste côté API.
 */
export function TemplatesExperience({
  spaceId,
  isAdmin,
  presentations,
  galleryOpen,
  onGalleryOpenChange,
  onCreateBlank,
  saveTarget = null,
  onSaveTargetClose,
}: {
  spaceId: string;
  isAdmin: boolean;
  presentations: PickablePresentation[];
  galleryOpen: boolean;
  onGalleryOpenChange: (open: boolean) => void;
  onCreateBlank: () => void;
  /** Présentation à enregistrer comme modèle, choisie depuis le menu de sa carte. */
  saveTarget?: PickablePresentation | null;
  onSaveTargetClose?: () => void;
}) {
  const tpl = useTemplates();
  const flows = useTemplateFlows({ spaceId, tpl });
  const display = useTemplateDisplay();
  const [ui, setUi] = useState<Ui>(null);

  const find = (id: string): TemplateSummary | undefined => tpl.allTemplates.find((x) => x.id === id);
  const close = () => setUi(null);
  const target = ui && "id" in ui ? find(ui.id) : undefined;

  const galleryTemplates = tpl.allTemplates.filter((x) => !x.templateHiddenAt);

  return (
    <>
      <TemplatesSection
        tpl={tpl}
        isAdmin={isAdmin}
        onPreview={(x) => setUi({ kind: "preview", id: x.id })}
        onSaveFromPresentation={() => setUi({ kind: "pick" })}
      />

      {galleryOpen ? (
        <NewPresentationGallery
          templates={galleryTemplates}
          loading={tpl.isLoading}
          error={tpl.error}
          onRetry={() => void tpl.refresh()}
          onClose={() => onGalleryOpenChange(false)}
          onBlank={() => {
            onGalleryOpenChange(false);
            onCreateBlank();
          }}
          onUse={async (x) => {
            if (await flows.use(x)) onGalleryOpenChange(false);
          }}
        />
      ) : null}

      {ui?.kind === "preview" && target ? (
        <TemplatePreviewDialog
          template={target}
          isAdmin={isAdmin}
          onClose={close}
          handlers={{
            use: async () => {
              if (await flows.use(target)) close();
            },
            edit: () => {
              close();
              flows.edit(target);
            },
            hide: () => setUi({ kind: "retire", id: target.id }),
            restore: async () => {
              if (await flows.restore(target)) close();
            },
            reset: () => setUi({ kind: "reset", id: target.id }),
          }}
        />
      ) : null}

      {isAdmin && ui?.kind === "retire" && target ? (
        <RetireTemplateDialog name={display.name(target)} onClose={close} onConfirm={() => flows.retire(target)} />
      ) : null}

      {isAdmin && ui?.kind === "reset" && target ? (
        <ResetTemplateDialog name={display.name(target)} onClose={close} onConfirm={() => flows.reset(target)} />
      ) : null}

      {isAdmin && ui?.kind === "pick" ? (
        <PickPresentationDialog
          presentations={presentations}
          onClose={close}
          onPick={(p) => setUi({ kind: "save", presentation: p })}
        />
      ) : null}

      {isAdmin && saveTarget ? (
        <SaveAsTemplateDialog
          initialName={saveTarget.title}
          onClose={() => onSaveTargetClose?.()}
          onSave={(input) => flows.save(saveTarget.id, input)}
        />
      ) : null}

      {isAdmin && ui?.kind === "save" ? (
        <SaveAsTemplateDialog
          initialName={ui.presentation.title}
          onClose={close}
          onSave={(input) => flows.save(ui.presentation.id, input)}
        />
      ) : null}
    </>
  );
}
