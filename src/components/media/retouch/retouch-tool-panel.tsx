"use client";

import { useTranslations } from "next-intl";
import { LIBRARY_ACTIONS } from "@/lib/media/actions";
import { mediaContentUrl } from "@/lib/media/urls";
import { AdjustPanel } from "./panels/adjust-panel";
import { CropPanel } from "./panels/crop-panel";
import { DetailPanel } from "./panels/detail-panel";
import { FiltersPanel } from "./panels/filters-panel";
import type { PanelProps } from "./panels/panel-parts";
import { ResizePanel } from "./panels/resize-panel";
import { RotatePanel } from "./panels/rotate-panel";
import { ShapesPanel } from "./panels/shapes-panel";
import { TextPanel } from "./panels/text-panel";
import type { CropDraft } from "./panels/use-crop-draft";
import { RETOUCH_TOOLS, type ToolId } from "./retouch-actions";

export interface RetouchToolPanelProps extends PanelProps {
  tool: ToolId;
  media: { id: string; currentVersion: number };
  cropDraft: CropDraft;
  selectedLayer: string | null;
  onSelectLayer: (id: string | null) => void;
}

/** Panneau de propriétés de l'outil actif, titré par le libellé de l'action du registre. */
export function RetouchToolPanel({ tool, recipe, onChange, media, cropDraft, selectedLayer, onSelectLayer }: RetouchToolPanelProps) {
  const t = useTranslations();
  const action = RETOUCH_TOOLS.find((x) => x.tool === tool)!.action;
  const common = { recipe, onChange };
  return (
    <section aria-label={t("library.retouch.panelLabel")} data-testid="retouch-tool-panel">
      <h2 className="border-border border-b px-3 py-2 text-sm font-semibold">{t(LIBRARY_ACTIONS[action].labelKey)}</h2>
      {tool === "crop" ? <CropPanel {...common} draft={cropDraft} /> : null}
      {tool === "rotate" ? <RotatePanel {...common} hotkeys={false} /> : null}
      {tool === "resize" ? <ResizePanel {...common} /> : null}
      {tool === "adjust" ? <AdjustPanel {...common} /> : null}
      {tool === "filters" ? <FiltersPanel {...common} sourceUrl={mediaContentUrl(media)} /> : null}
      {tool === "detail" ? <DetailPanel {...common} /> : null}
      {tool === "text" ? <TextPanel {...common} selectedId={selectedLayer} onSelect={onSelectLayer} /> : null}
      {tool === "shapes" ? <ShapesPanel {...common} selectedId={selectedLayer} onSelect={onSelectLayer} /> : null}
    </section>
  );
}
