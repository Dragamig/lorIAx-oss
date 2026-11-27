"use client";

import { useCallback, useEffect, useMemo, useReducer, useRef, useState } from "react";
import { useTranslations } from "next-intl";
import { Download, Save } from "lucide-react";
import { toast } from "sonner";
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { StudioShell, StudioTopbar } from "@/components/editor/studio-shell";
import { LIBRARY_ACTIONS, type ActionId } from "@/lib/media/actions";
import { cn } from "@/lib/utils";
import { ActionButton } from "../action-button";
import { createHistory, type History } from "./history";
import { CropOverlay } from "./panels/crop-overlay";
import { SavePanel, type SavePanelMedia } from "./panels/save-panel";
import { useCropDraft } from "./panels/use-crop-draft";
import { emptyRecipe, applyOp, outputSize, type RetouchOp, type RetouchRecipe } from "./recipe";
import { actionForKey, RETOUCH_TOOLS, type RetouchActionMap, type ToolId } from "./retouch-actions";
import { RetouchStage } from "./retouch-stage";
import { RetouchToolPanel } from "./retouch-tool-panel";
import { fileNameFor, type SaveOutcome } from "./save-flow";
import { useRetouchCanvas } from "./use-retouch-canvas";
import type { ExportFormat } from "./render";

export interface RetouchDialogMedia extends SavePanelMedia {
  title?: string | null;
  kind: string;
  /** Droit d'écriture sur l'original. */
  canWrite: boolean;
  width?: number | null;
  height?: number | null;
}

export interface RetouchDialogProps {
  /** Média à retoucher ; `null` : fermé. */
  media: RetouchDialogMedia | null;
  /** Espaces où l'on peut écrire (destination d'une copie). */
  spaces: { id: string; name: string }[];
  folders: { id: string; name: string }[];
  /** Le lecteur peut écrire quelque part (copie) : sinon l'enregistrement est désactivé. */
  canWriteSpace: boolean;
  allowNoSpace?: boolean;
  userId?: string;
  onClose: () => void;
  onSaved: (outcome: Exclude<SaveOutcome, { kind: "error" }>) => void;
  /** « Annuler » d'un enregistrement a réussi : rafraîchir la médiathèque. */
  onUndone?: () => void;
}

const ZOOM_STEPS = [10, 25, 50, 75, 100, 150, 200, 300, 400];
const FULL = { x: 0, y: 0, w: 1, h: 1 };

const isTextTarget = (el: EventTarget | null) =>
  el instanceof HTMLElement && (el.isContentEditable || ["INPUT", "TEXTAREA", "SELECT"].includes(el.tagName));

function mergeKeyOf(op: RetouchOp): string | undefined {
  switch (op.type) {
    case "setAdjustment":
      return `adj:${op.key}`;
    case "setAngle":
    case "setBlur":
    case "setSharpen":
    case "resize":
      return op.type;
    case "updateLayer":
      return `layer:${op.id}`;
    default:
      return undefined;
  }
}

export function RetouchDialog({ media, ...rest }: RetouchDialogProps) {
  if (!media) return null;
  return <RetouchStudio key={media.id} media={media} {...rest} />;
}

function RetouchStudio({
  media,
  spaces,
  folders,
  canWriteSpace,
  allowNoSpace = false,
  userId,
  onClose,
  onSaved,
  onUndone,
}: Omit<RetouchDialogProps, "media"> & { media: RetouchDialogMedia }) {
  const t = useTranslations("library.retouch");
  const tAll = useTranslations();
  const canvasRef = useRef<HTMLCanvasElement>(null);
  // Historique mutable tenu en état ; `bump` relance le rendu après chaque empilement, annulation ou rétablissement.
  const [hist, setHist] = useState<History<RetouchRecipe> | null>(null);
  const [, bump] = useReducer((n: number) => n + 1, 0);
  const recipe = hist ? hist.present : null;
  const [tool, setTool] = useState<ToolId>("crop");
  const [selectedLayer, setSelectedLayer] = useState<string | null>(null);
  const [before, setBefore] = useState(false);
  const [zoom, setZoom] = useState<number | null>(null);
  const [scale, setScale] = useState(100);
  const [saveOpen, setSaveOpen] = useState(false);
  const [discardOpen, setDiscardOpen] = useState(false);

  const url = `/api/media/${media.id}?v=${media.currentVersion}`;
  const cv = useRetouchCanvas({
    url,
    canvasRef,
    onLoaded: (size) => {
      setHist((prev) => prev ?? createHistory(emptyRecipe(size)));
    },
  });
  const { ready, error, retry, setRecipe: drawRecipe, showBefore, exportBlob } = cv;

  const placeholder = useMemo(
    () => emptyRecipe({ width: media.width || 1, height: media.height || 1 }),
    [media.width, media.height],
  );
  const current = recipe ?? placeholder;
  const cropDraft = useCropDraft(current);
  const dirty = Boolean(hist?.canUndo);
  const canUndo = Boolean(hist?.canUndo);
  const canRedo = Boolean(hist?.canRedo);
  const cropDirty =
    tool === "crop" &&
    (cropDraft.pending.x !== current.crop.x ||
      cropDraft.pending.y !== current.crop.y ||
      cropDraft.pending.w !== current.crop.w ||
      cropDraft.pending.h !== current.crop.h);

  // Pendant le recadrage, l'aperçu montre l'image source entière : la zone se règle sur ses coordonnées.
  const previewRecipe = useMemo<RetouchRecipe | null>(() => {
    if (!recipe) return null;
    if (tool !== "crop") return recipe;
    return { ...recipe, crop: FULL, quarterTurns: 0, angle: 0, flipH: false, flipV: false, resize: null, layers: [] };
  }, [recipe, tool]);

  useEffect(() => {
    if (ready && previewRecipe) drawRecipe(previewRecipe);
  }, [ready, previewRecipe, drawRecipe, saveOpen, discardOpen]);
  useEffect(() => {
    if (ready) showBefore(before);
  }, [ready, before, showBefore]);

  const change = useCallback(
    (op: RetouchOp) => {
      if (!hist) return;
      hist.push(applyOp(hist.present, op), mergeKeyOf(op));
      bump();
    },
    [hist],
  );
  const undo = useCallback(() => {
    hist?.undo();
    bump();
  }, [hist]);
  const redo = useCallback(() => {
    hist?.redo();
    bump();
  }, [hist]);

  const getBlob = useCallback(
    async (format: ExportFormat, quality: number) => {
      if (recipe) drawRecipe(recipe);
      return exportBlob(format, quality);
    },
    [recipe, drawRecipe, exportBlob],
  );

  const name = media.title || media.filename;
  const download = useCallback(async () => {
    try {
      const blob = await getBlob("png", 1);
      const href = URL.createObjectURL(blob);
      const a = document.createElement("a");
      a.href = href;
      a.download = fileNameFor(`${name.replace(/\.[^./]+$/, "")}-retouche`, "png");
      document.body.appendChild(a);
      a.click();
      a.remove();
      setTimeout(() => URL.revokeObjectURL(href), 10_000);
      toast.success(t("downloaded"));
    } catch {
      toast.error(t("downloadFailed"));
    }
  }, [getBlob, name, t]);

  const requestClose = useCallback(() => {
    if (dirty) setDiscardOpen(true);
    else onClose();
  }, [dirty, onClose]);

  const zoomBy = (dir: 1 | -1) => {
    const now = scale;
    const next = dir > 0 ? ZOOM_STEPS.find((z) => z > now) : [...ZOOM_STEPS].reverse().find((z) => z < now);
    if (next) setZoom(next);
  };

  const loadingReason = !ready ? t("loading") : undefined;
  const saveReason = !ready
    ? t("loading")
    : !canWriteSpace && !media.canWrite
      ? t("saveReadOnly")
      : !dirty
        ? t("saveNothing")
        : undefined;
  const readOnly = !canWriteSpace && !media.canWrite;

  const actions: RetouchActionMap = {
    closeRetouch: { run: requestClose },
    retouchUndo: { run: undo, disabledReason: canUndo ? undefined : t("nothingToUndo") },
    retouchRedo: { run: redo, disabledReason: canRedo ? undefined : t("nothingToRedo") },
    compareBefore: { run: () => setBefore((b) => !b), disabledReason: loadingReason },
    saveRetouch: { run: () => setSaveOpen(true), disabledReason: saveReason },
    downloadRetouch: { run: () => void download(), disabledReason: loadingReason },
    zoomOut: { run: () => zoomBy(-1), disabledReason: loadingReason },
    zoomIn: { run: () => zoomBy(1), disabledReason: loadingReason },
    zoomFit: { run: () => setZoom(null), disabledReason: loadingReason },
    rotateLeft: { run: () => change({ type: "rotate", quarters: -1 }), disabledReason: loadingReason },
    rotateRight: { run: () => change({ type: "rotate", quarters: 1 }), disabledReason: loadingReason },
    flipH: { run: () => change({ type: "flip", axis: "h" }), disabledReason: loadingReason },
    flipV: { run: () => change({ type: "flip", axis: "v" }), disabledReason: loadingReason },
    ...Object.fromEntries(RETOUCH_TOOLS.map(({ tool: id, action }) => [action, { run: () => setTool(id) }])),
  };

  const btn = (id: ActionId, extra: Partial<React.ComponentProps<typeof ActionButton>> = {}) => (
    <ActionButton id={id} onAction={actions[id]!.run} disabledReason={actions[id]!.disabledReason} {...extra} />
  );

  const natural = before || !previewRecipe ? (recipe ? recipe.source : null) : outputSize(previewRecipe);
  const out = recipe ? outputSize(recipe) : null;

  return (
    <>
      <Dialog
        open
        disablePointerDismissal
        onOpenChange={(next, details) => {
          if (next) return;
          // Échap dans l'outil de recadrage annule d'abord la zone en cours.
          if (details?.reason === "escape-key" && cropDirty) {
            cropDraft.revert();
            return;
          }
          requestClose();
        }}
      >
        <DialogContent
          showCloseButton={false}
          className="top-0 left-0 grid h-dvh w-screen max-w-none translate-x-0 translate-y-0 grid-cols-[minmax(0,1fr)] grid-rows-[minmax(0,1fr)] gap-0 overflow-hidden rounded-none p-0 sm:max-w-none"
          finalFocus={() => document.querySelector<HTMLElement>(`[data-media-id="${media.id}"]`) ?? true}
          onKeyDown={(e) => {
            if (isTextTarget(e.target)) return;
            const id = actionForKey(e.nativeEvent, actions);
            if (!id) return;
            e.preventDefault();
            e.stopPropagation();
            const a = actions[id]!;
            if (!a.disabledReason) a.run();
          }}
        >
          <DialogTitle className="sr-only">{t("dialogTitle", { name })}</DialogTitle>
          <DialogDescription className="sr-only">{t("dialogDescription")}</DialogDescription>
          <StudioShell
            className="min-h-0 min-w-0"
            rowClassName="flex-col md:flex-row"
            mainClassName="order-2"
            topbar={
              <StudioTopbar
                className="overflow-x-auto"
                left={
                  <>
                    {btn("closeRetouch")}
                    <span className="max-w-20 truncate text-sm font-semibold sm:max-w-48" title={name}>
                      {name}
                    </span>
                    {dirty ? (
                      <span className="bg-muted text-muted-foreground hidden shrink-0 rounded-full px-2 py-0.5 text-xs sm:inline" role="status">
                        {t("unsaved")}
                      </span>
                    ) : null}
                    <span className="bg-border mx-1 h-5 w-px" aria-hidden="true" />
                    {btn("retouchUndo")}
                    {btn("retouchRedo")}
                    {btn("compareBefore", { pressed: before })}
                    <span className="hidden items-center gap-1 sm:flex">
                      <span className="bg-border mx-1 h-5 w-px" aria-hidden="true" />
                      {btn("zoomOut")}
                      <span className="text-muted-foreground w-12 text-center text-xs tabular-nums" aria-live="polite">
                        {t("zoomValue", { percent: String(scale) })}
                      </span>
                      {btn("zoomIn")}
                      {btn("zoomFit", { pressed: zoom === null })}
                    </span>
                  </>
                }
                right={
                  <>
                    {btn("downloadRetouch", {
                      variant: "outline",
                      size: "sm",
                      children: (
                        <>
                          <Download aria-hidden="true" />
                          <span className="hidden md:inline">{tAll(LIBRARY_ACTIONS.downloadRetouch.labelKey)}</span>
                        </>
                      ),
                    })}
                    {btn("saveRetouch", {
                      variant: "default",
                      size: "sm",
                      tipAlign: "end",
                      children: (
                        <>
                          <Save aria-hidden="true" />
                          <span className="hidden sm:inline">{tAll(LIBRARY_ACTIONS.saveRetouch.labelKey)}</span>
                        </>
                      ),
                    })}
                  </>
                }
              />
            }
            rail={
              <div
                role="toolbar"
                aria-label={t("toolsLabel")}
                className="bg-card border-border order-1 flex w-full shrink-0 items-center justify-center gap-1 overflow-x-auto border-b p-1.5 md:w-[52px] md:flex-col md:justify-start md:border-r md:border-b-0 md:py-2"
              >
                {RETOUCH_TOOLS.map(({ tool: id, action }) => (
                  <ActionButton
                    key={id}
                    id={action}
                    size="icon"
                    variant={tool === id ? "secondary" : "ghost"}
                    pressed={tool === id}
                    onAction={actions[action]!.run}
                  />
                ))}
              </div>
            }
            panel={
              <aside
                className={cn(
                  "bg-card border-border order-3 max-h-[40%] w-full shrink-0 overflow-y-auto border-t md:max-h-none md:w-72 md:border-t-0 md:border-l",
                )}
              >
                <RetouchToolPanel
                  tool={tool}
                  recipe={current}
                  onChange={change}
                  media={media}
                  cropDraft={cropDraft}
                  selectedLayer={selectedLayer}
                  onSelectLayer={setSelectedLayer}
                />
              </aside>
            }
          >
            <RetouchStage
              canvasRef={canvasRef}
              natural={natural}
              zoom={zoom}
              loading={!ready}
              error={error}
              onRetry={retry}
              readOnly={readOnly}
              outputLabel={out ? t("outputSize", { w: String(out.width), h: String(out.height) }) : null}
              comparing={before}
              onScale={setScale}
              overlay={ready && tool === "crop" && !before && recipe ? <CropOverlay draft={cropDraft} /> : null}
            />
          </StudioShell>
        </DialogContent>
      </Dialog>

      <SavePanel
        open={saveOpen}
        onOpenChange={setSaveOpen}
        media={media}
        canWriteOriginal={media.canWrite}
        spaces={spaces}
        folders={folders}
        allowNoSpace={allowNoSpace}
        getBlob={getBlob}
        userId={userId}
        onUndone={onUndone}
        onSaved={(outcome) => {
          onSaved(outcome);
          onClose();
        }}
      />

      <Dialog open={discardOpen} onOpenChange={setDiscardOpen}>
        <DialogContent showCloseButton={false}>
          <DialogHeader>
            <DialogTitle>{t("discardTitle")}</DialogTitle>
            <DialogDescription>{t("discardBodyNamed", { name })}</DialogDescription>
          </DialogHeader>
          <DialogFooter>
            <ActionButton id="keepEditing" variant="outline" showLabel size="sm" onAction={() => setDiscardOpen(false)} />
            <ActionButton
              id="discardRetouch"
              variant="outline"
              showLabel
              size="sm"
              className="text-destructive"
              onAction={() => {
                setDiscardOpen(false);
                onClose();
              }}
            />
            <ActionButton
              id="saveRetouch"
              variant="default"
              showLabel
              size="sm"
              disabledReason={saveReason}
              onAction={() => {
                setDiscardOpen(false);
                setSaveOpen(true);
              }}
            />
          </DialogFooter>
        </DialogContent>
      </Dialog>
      <span className="sr-only" aria-live="polite">
        {before ? t("comparing") : ""}
      </span>
    </>
  );
}

