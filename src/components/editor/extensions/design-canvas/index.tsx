"use client";

import { useEffect, useRef, useState, useCallback } from "react";
import type { Canvas as FabricCanvas } from "fabric";
import { StudioShell, StudioRail, useStudioTheme } from "@/components/editor/studio-shell";
import { DesignContext, type DesignContextValue } from "./context";
import { DesignTopbar } from "./toolbar";
import { TOOLS, DesignPanel } from "./panels";
import { DesignCanvasArea, DesignPageStrip, DesignBottombar } from "./canvas-area";
import { debounce, migrateToDocument, runWithoutGuidelines, GOOGLE_FONTS_URL, FONTSHARE_URL, PERSIST_PROPS, extractDesignVariables } from "./utils";
import { SaveTemplateDialog } from "./save-template-dialog";
import {
  PAGE_FORMATS,
  SNAP_THRESHOLD,
  type PageFormat,
  type PageDimensions,
  type DesignDocument,
  type DesignPage,
} from "../design-constants";
export type { DesignPage, DesignDocument } from "../design-constants";
import { exportRaster, exportSvg, exportPdf } from "../design-export";
import { attachPageSnapping } from "../design-snapping";
import { duplicateSelection, deleteSelection, groupSelection, ungroupSelection } from "../design-objects";
import type { ToolType } from "./context";

// ── Export sûr ────────────────────────────────────────────────────────────────
// Fabric.Canvas.toCanvasElement() (utilisé par toDataURL) modifie TEMPORAIREMENT
// viewportTransform / width / height / enableRetinaScaling / skipControlsDrawing du
// canvas AFFICHÉ, puis les restaure — mais SANS try/finally (cf. node_modules/
// fabric/dist/index.mjs). Si le rendu d'export jette (getContext('2d') renvoie
// `null` → « can't access property clearRect, t is undefined » : dimensions
// invalides, ou limite de contextes canvas atteinte côté navigateur), la
// restauration n'a jamais lieu : le canvas visible reste à l'échelle d'export
// (ex. 0.15×) et mal transformé → édition gelée, texte non éditable, et les
// exports suivants aggravent la corruption.
//
// On encapsule donc chaque export : (1) garde-fous sur les dimensions pour éviter
// le crash, (2) snapshot/restore systématique pour garantir que le canvas visible
// n'est JAMAIS laissé corrompu, même si toDataURL échoue.
type ExportOptions = { multiplier?: number; format?: string; quality?: number };

function safeToDataURL(canvas: FabricCanvas, options: ExportOptions = {}): string | null {
  const c = canvas as unknown as {
    width: number;
    height: number;
    viewportTransform: number[];
    enableRetinaScaling: boolean;
    skipControlsDrawing: boolean;
    toDataURL: (o: ExportOptions) => string;
    setViewportTransform: (vp: number[]) => void;
    setDimensions: (d: { width: number; height: number }) => void;
    calcOffset: () => void;
    requestRenderAll: () => void;
  };
  const mult = options.multiplier ?? 1;
  const w = c.width;
  const h = c.height;
  // Dimensions / multiplier invalides → le canvas d'export aurait un contexte 2D
  // `null` et ferait planter le rendu interne. On renonce proprement.
  if (
    ![w, h, mult, w * mult, h * mult].every(Number.isFinite) ||
    w <= 0 || h <= 0 || mult <= 0 || w * mult < 1 || h * mult < 1
  ) {
    return null;
  }
  const vpt = Array.isArray(c.viewportTransform) ? [...c.viewportTransform] : null;
  const ow = w;
  const oh = h;
  const retina = c.enableRetinaScaling;
  const skipCtl = c.skipControlsDrawing;
  try {
    // Détache les hooks des smart guides pendant l'export : sinon le handler
    // `before:render` d'AligningGuidelines plante sur le contextTop mis à
    // undefined par Fabric, fige le canvas et vide la miniature. Voir runWithoutGuidelines.
    return runWithoutGuidelines(canvas, () => c.toDataURL(options));
  } catch (err) {
    console.warn("[design] export canvas indisponible :", err);
    return null;
  } finally {
    // Restaure systématiquement l'état que toCanvasElement laisse corrompu si l'export a jeté.
    c.enableRetinaScaling = retina;
    c.skipControlsDrawing = skipCtl;
    if (c.width !== ow || c.height !== oh) c.setDimensions({ width: ow, height: oh });
    if (vpt) c.setViewportTransform(vpt);
    c.calcOffset();
    c.requestRenderAll();
  }
}

// ── Props ─────────────────────────────────────────────────────────────────────

export interface DesignCanvasProps {
  designId: string;
  initialJson: unknown;
  onSave: (doc: DesignDocument, thumbnail: string) => void;
  onClose: () => void;
}

// ── Composant DesignCanvas ────────────────────────────────────────────────────

export function DesignCanvas({ designId: _designId, initialJson, onSave, onClose }: DesignCanvasProps) {
  // Resolve theme tokens for JS/Fabric consumers (smart guides, etc.)
  const studioTheme = useStudioTheme();
  const studioThemeRef = useRef(studioTheme);
  useEffect(() => { studioThemeRef.current = studioTheme; }, [studioTheme]);

  const canvasRef = useRef<HTMLCanvasElement>(null);
  const fabricCanvasRef = useRef<FabricCanvas | null>(null);
  const areaContainerRef = useRef<HTMLDivElement>(null);
  const [fabricCanvas, setFabricCanvas] = useState<FabricCanvas | null>(null);
  const [activeTool, setActiveTool] = useState<ToolType>("select");
  const [zoom, setZoom] = useState(100);
  const [leftPanelWidth, setLeftPanelWidth] = useState(280);
  const [title, setTitle] = useState("Design sans titre");
  const [bgColor, setBgColor] = useState("#ffffff");
  const [pageFormat, setPageFormat] = useState<PageFormat>("a4-portrait");
  const [pageSize, setPageSize] = useState<PageDimensions>(PAGE_FORMATS["a4-portrait"]);
  const [freeDimensions, setFreeDimensions] = useState<PageDimensions>(PAGE_FORMATS["free"]);
  const [panelVisible, setPanelVisible] = useState(true);

  // spaceId — récupéré depuis le global exposé par loriax-editor.tsx
  const spaceId = typeof window !== "undefined"
    ? (window as typeof window & { __loriax_spaceId?: string }).__loriax_spaceId
    : undefined;

  // Charger Google Fonts + Fontshare une seule fois
  useEffect(() => {
    const entries = [
      { id: "studio-google-fonts", href: GOOGLE_FONTS_URL },
      { id: "studio-fontshare", href: FONTSHARE_URL },
    ];
    for (const { id, href } of entries) {
      if (document.getElementById(id)) continue;
      const link = document.createElement("link");
      link.id = id;
      link.rel = "stylesheet";
      link.href = href;
      document.head.appendChild(link);
    }
  }, []);

  // États multi-pages
  const [pages, setPages] = useState<DesignPage[]>([]);
  const [currentPageIndex, setCurrentPageIndex] = useState(0);
  // Ref synchrone (évite les closures obsolètes dans les callbacks)
  const pagesRef = useRef<DesignPage[]>([]);
  // Ref zoom pour calcul de multiplier sans dépendance de callback
  const zoomRef = useRef(100);
  // Miniature haute résolution de la page 0 pour le bloc TipTap
  const tiptapThumbRef = useRef<string | null>(null);

  // Undo / redo history (JSON snapshots)
  const historyRef = useRef<string[]>([]);
  const historyIndexRef = useRef(-1);
  const [canUndo, setCanUndo] = useState(false);
  const [canRedo, setCanRedo] = useState(false);
  // Vrai pendant un chargement programmatique du canvas (undo/redo, changement de
  // page, clear…). Fabric.js v7 émet `object:added`/`object:removed` pour CHAQUE
  // objet pendant `loadFromJSON()`/`clear()` ; sans ce garde-fou, les listeners
  // d'historique repoussent l'état restauré comme un nouveau snapshot et écrasent
  // la pile redo → le retour arrière devient inopérant. Voir handleUndo/handleRedo.
  const isRestoringRef = useRef(false);

  useEffect(() => {
    pagesRef.current = pages;
  }, [pages]);

  useEffect(() => {
    zoomRef.current = zoom;
  }, [zoom]);

  const pushHistory = useCallback(() => {
    const canvas = fabricCanvasRef.current;
    if (!canvas) return;
    const json = JSON.stringify(canvas.toObject(PERSIST_PROPS));
    // Truncate forward history
    historyRef.current = historyRef.current.slice(0, historyIndexRef.current + 1);
    historyRef.current.push(json);
    // Cap at 20 states
    if (historyRef.current.length > 20) historyRef.current.shift();
    historyIndexRef.current = historyRef.current.length - 1;
    setCanUndo(historyIndexRef.current > 0);
    setCanRedo(false);
  }, []);

  const handleUndo = useCallback(() => {
    const canvas = fabricCanvasRef.current;
    if (!canvas || historyIndexRef.current <= 0) return;
    historyIndexRef.current -= 1;
    const snapshot = historyRef.current[historyIndexRef.current];
    isRestoringRef.current = true;
    canvas
      .loadFromJSON(JSON.parse(snapshot))
      .then(() => canvas.renderAll())
      .finally(() => { isRestoringRef.current = false; });
    setCanUndo(historyIndexRef.current > 0);
    setCanRedo(true);
  }, []);

  const handleRedo = useCallback(() => {
    const canvas = fabricCanvasRef.current;
    if (!canvas || historyIndexRef.current >= historyRef.current.length - 1) return;
    historyIndexRef.current += 1;
    const snapshot = historyRef.current[historyIndexRef.current];
    isRestoringRef.current = true;
    canvas
      .loadFromJSON(JSON.parse(snapshot))
      .then(() => canvas.renderAll())
      .finally(() => { isRestoringRef.current = false; });
    setCanUndo(true);
    setCanRedo(historyIndexRef.current < historyRef.current.length - 1);
  }, []);

  // Trigger save
  const triggerSave = useCallback(() => {
    const canvas = fabricCanvasRef.current;
    if (!canvas) return;

    const currentJson = canvas.toObject(PERSIST_PROPS) as object;
    // Miniature page strip (60×44 px display) : résolution réduite suffisante.
    // safeToDataURL gère échec/restauration — l'auto-save ne plante jamais et le
    // canvas visible n'est jamais laissé corrompu.
    const currentThumb = safeToDataURL(canvas, { multiplier: 0.15 });

    const updatedPages = [...pagesRef.current];
    updatedPages[currentPageIndex] = {
      ...updatedPages[currentPageIndex],
      json: currentJson,
      thumbnail: currentThumb,
    };
    pagesRef.current = updatedPages;
    setPages(updatedPages);

    const doc: DesignDocument = {
      version: 2,
      title,
      pages: updatedPages,
    };

    // Miniature TipTap — toujours la première page, minimum 96 DPI.
    // Le canvas est affiché au zoom courant ; multiplier = 100/zoom ramène à la
    // résolution native de la page (ex. A4 = 595×842 CSS px ≈ 96 DPI).
    const mult = 100 / zoomRef.current;
    if (currentPageIndex === 0) {
      const hd = safeToDataURL(canvas, { multiplier: mult, format: "jpeg", quality: 0.9 });
      if (hd) tiptapThumbRef.current = hd;
    }
    const thumb1 =
      tiptapThumbRef.current ??
      safeToDataURL(canvas, { multiplier: mult, format: "jpeg", quality: 0.9 });
    // handleSave (design-modal) n'écrase pas un aperçu valide par une chaîne vide.
    onSave(doc, thumb1 ?? "");
  }, [currentPageIndex, title, onSave]);

  // Debounced auto-save
  // eslint-disable-next-line react-hooks/exhaustive-deps
  const debouncedSave = useCallback(
    debounce(() => triggerSave(), 2000),
    [triggerSave]
  );

  const debouncedSaveRef = useRef<typeof debouncedSave | undefined>(undefined);
  useEffect(() => {
    debouncedSaveRef.current = debouncedSave;
  }, [debouncedSave]);

  // Initialise Fabric.js
  useEffect(() => {
    if (!canvasRef.current) return;
    let cancelled = false;
    // Declared in the effect closure so the cleanup function can access them
    let detachSnapping: (() => void) | null = null;
    let guidelines: { dispose(): void } | null = null;
    let recalcOffset: (() => void) | null = null;
    let scrollEl: HTMLDivElement | null = null;

    // Migration du JSON S3 (v1 → v2 ou v2 déjà)
    const doc = migrateToDocument(initialJson);
    const firstPage = doc.pages[0];

    // Initialiser les états depuis le document
    setPages(doc.pages);
    pagesRef.current = doc.pages;
    setTitle(doc.title);
    setPageFormat(firstPage.format);
    const initFreeDims = firstPage.format === "free" && firstPage.customWidth && firstPage.customHeight
      ? { width: firstPage.customWidth, height: firstPage.customHeight }
      : PAGE_FORMATS["free"];
    setFreeDimensions(initFreeDims);
    const dims = firstPage.format === "free" ? initFreeDims : PAGE_FORMATS[firstPage.format];
    setPageSize(dims);
    setBgColor(firstPage.bgColor);

    (async () => {
      const { Canvas } = await import("fabric");
      if (cancelled || !canvasRef.current) return;

      const canvas = new Canvas(canvasRef.current, {
        width: dims.width,
        height: dims.height,
        backgroundColor: firstPage.bgColor,
        selection: true,
      });
      fabricCanvasRef.current = canvas;
      setFabricCanvas(canvas);

      // Smart guides: object↔object (AligningGuidelines) + page-edge/center snapping
      try {
        const ext = await import("fabric/extensions") as { AligningGuidelines: new (c: FabricCanvas, o?: Record<string, unknown>) => { dispose(): void } };
        // Use the theme ring token at creation time so guides match the app accent color
        const guideColor = studioThemeRef.current.resolve("--ring") || "var(--ring)";
        guidelines = new ext.AligningGuidelines(canvas, {
          margin: SNAP_THRESHOLD,
          width: 1,
          color: guideColor,
        });
        // Exposé sur le canvas pour que runWithoutGuidelines puisse détacher ses
        // hooks de rendu pendant les exports (toDataURL / toSVG / PNG-PDF).
        (canvas as unknown as { __aligningGuidelines?: unknown }).__aligningGuidelines = guidelines;
      } catch (err) {
        console.warn("[design] AligningGuidelines indisponible :", err);
      }
      // Guard: if component unmounted during the extensions import, dispose any
      // partially-constructed guidelines and bail out before attaching to the disposed canvas.
      if (cancelled) { guidelines?.dispose(); guidelines = null; return; }
      detachSnapping = attachPageSnapping(canvas, () => ({
        width: canvas.getWidth() / (canvas.getZoom() || 1),
        height: canvas.getHeight() / (canvas.getZoom() || 1),
      }));

      if (firstPage.json) {
        await canvas.loadFromJSON(firstPage.json);
        canvas.renderAll();
      }

      historyRef.current = [JSON.stringify(canvas.toObject(PERSIST_PROPS))];
      historyIndexRef.current = 0;
      setCanUndo(false);
      setCanRedo(false);

      // Auto-fit zoom so the document is fully visible on open.
      // Deferred to rAF so the container has its final dimensions (flex layout may not
      // be settled synchronously at mount time, especially for tall ratios like 9:16).
      requestAnimationFrame(() => {
        if (cancelled || !areaContainerRef.current) return;
        const containerW = areaContainerRef.current.clientWidth;
        const containerH = areaContainerRef.current.clientHeight;
        if (containerW === 0 || containerH === 0) return;
        const padding = 80;
        const fitZoom = Math.floor(
          Math.min((containerW - padding) / dims.width, (containerH - padding) / dims.height) * 100,
        );
        setZoom(Math.max(10, Math.min(200, fitZoom)));
      });

      // Ne pas historiser/sauvegarder les événements émis pendant un chargement
      // programmatique (undo/redo, changement de page) : ils corrompraient la pile.
      const onCanvasMutation = () => {
        if (isRestoringRef.current) return;
        pushHistory();
        debouncedSaveRef.current?.();
      };
      canvas.on("object:modified", onCanvasMutation);
      canvas.on("object:added", onCanvasMutation);
      canvas.on("object:removed", onCanvasMutation);

      // Fabric ne recale son offset (mapping pointeur → scène) que sur `resize`
      // de la fenêtre. La zone de travail a `overflow:auto` : dès qu'on la fait
      // défiler (ou qu'on scrolle la page), l'offset devient obsolète et les
      // clics/déplacements visent à côté des objets → « impossible de modifier ».
      // On recale donc l'offset à chaque défilement.
      recalcOffset = () => canvas.calcOffset();
      scrollEl = areaContainerRef.current;
      scrollEl?.addEventListener("scroll", recalcOffset, { passive: true });
      window.addEventListener("scroll", recalcOffset, { passive: true });
    })();

    return () => {
      cancelled = true;
      if (recalcOffset) {
        scrollEl?.removeEventListener("scroll", recalcOffset);
        window.removeEventListener("scroll", recalcOffset);
      }
      detachSnapping?.();
      guidelines?.dispose();
      fabricCanvasRef.current?.dispose();
      fabricCanvasRef.current = null;
      setFabricCanvas(null);
    };
    // Only run once on mount
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  // Sync zoom to Fabric canvas
  useEffect(() => {
    const canvas = fabricCanvasRef.current;
    if (!canvas) return;
    canvas.setZoom(zoom / 100);
    canvas.setDimensions({
      width: pageSize.width * (zoom / 100),
      height: pageSize.height * (zoom / 100),
    });
    // Recalculate pointer offsets after zoom/dimensions change so hit-testing stays accurate.
    canvas.calcOffset();
    canvas.renderAll();
    // … et de NOUVEAU à la frame suivante : agrandir le canvas peut décaler le
    // scroll du conteneur (overflow:auto, centrage flex) APRÈS ce passage
    // synchrone, ce qui re-périme l'offset. Sans ce second recalage, après un
    // zoom le clic vise à côté et plus rien ne se sélectionne (bug rapporté).
    const raf = requestAnimationFrame(() => {
      if (fabricCanvasRef.current === canvas) canvas.calcOffset();
    });
    return () => cancelAnimationFrame(raf);
  }, [zoom, pageSize]);

  // Sync drawing mode — Fabric.js v7 exige un PencilBrush explicite
  useEffect(() => {
    const canvas = fabricCanvasRef.current;
    if (!canvas) return;
    if (activeTool === "draw") {
      import("fabric").then(({ PencilBrush }) => {
        if (!canvas.freeDrawingBrush) {
          const brush = new PencilBrush(canvas);
          brush.width = 4;
          brush.color = "#222222";
          canvas.freeDrawingBrush = brush;
        }
        canvas.isDrawingMode = true;
      });
    } else {
      canvas.isDrawingMode = false;
    }
  }, [activeTool]);

  // Toggle panel when clicking same tool twice
  const handleToolChange = useCallback(
    (tool: ToolType) => {
      if (tool === activeTool) {
        setPanelVisible((v) => !v);
      } else {
        setActiveTool(tool);
        setPanelVisible(true);
      }
    },
    [activeTool]
  );

  // Background color change
  const handleBgColorChange = useCallback((color: string) => {
    setBgColor(color);
    // Persister dans la page courante
    setPages((prev) => {
      const updated = [...prev];
      updated[currentPageIndex] = { ...updated[currentPageIndex], bgColor: color };
      pagesRef.current = updated;
      return updated;
    });
    const canvas = fabricCanvasRef.current;
    if (canvas) {
      canvas.set("backgroundColor", color);
      canvas.renderAll();
      debouncedSave();
    }
  }, [currentPageIndex, debouncedSave]);

  // Auto-fit : calcule le zoom pour que la page tienne entièrement dans la zone de
  // travail. Différé en rAF car le conteneur flex peut ne pas être dimensionné au
  // moment de l'appel (montage, changement de format). `dims` permet de viser la
  // nouvelle taille avant que le state `pageSize` ne soit propagé.
  const fitToViewport = useCallback(
    (dims?: PageDimensions) => {
      const target = dims ?? pageSize;
      requestAnimationFrame(() => {
        const el = areaContainerRef.current;
        if (!el) return;
        const containerW = el.clientWidth;
        const containerH = el.clientHeight;
        if (containerW === 0 || containerH === 0) return;
        const padding = 80;
        const fitZoom = Math.floor(
          Math.min((containerW - padding) / target.width, (containerH - padding) / target.height) * 100,
        );
        setZoom(Math.max(10, Math.min(200, fitZoom)));
      });
    },
    [pageSize]
  );

  // Page format change
  const handlePageFormatChange = useCallback(
    async (format: PageFormat) => {
      setPageFormat(format);
      const dims = format === "free" ? freeDimensions : PAGE_FORMATS[format];
      setPageSize(dims);
      setPages((prev) => {
        const updated = [...prev];
        updated[currentPageIndex] = { ...updated[currentPageIndex], format };
        pagesRef.current = updated;
        return updated;
      });
      // Re-cadrer la page au nouveau format (sinon un ratio plus grand déborde de
      // la zone visible). fitToViewport applique le zoom ; l'effet [zoom, pageSize]
      // redimensionne ensuite le canvas Fabric.
      fitToViewport(dims);
    },
    [currentPageIndex, freeDimensions, fitToViewport]
  );

  // Free dimensions change (format "Libre" uniquement)
  const handleFreeDimensionsChange = useCallback(
    (dims: PageDimensions) => {
      setFreeDimensions(dims);
      setPageSize(dims);
      setPages((prev) => {
        const updated = [...prev];
        updated[currentPageIndex] = {
          ...updated[currentPageIndex],
          customWidth: dims.width,
          customHeight: dims.height,
        };
        pagesRef.current = updated;
        return updated;
      });
      const canvas = fabricCanvasRef.current;
      if (canvas) {
        fitToViewport(dims);
        debouncedSave();
      }
    },
    [currentPageIndex, debouncedSave, fitToViewport]
  );

  // Basculer vers une autre page : sauvegarder la courante, charger la suivante
  const switchToPage = useCallback(
    async (nextIndex: number) => {
      const canvas = fabricCanvasRef.current;
      if (!canvas || nextIndex === currentPageIndex) return;

      // 1. Snapshot de la page courante
      const thumbnail = safeToDataURL(canvas, { multiplier: 0.15 });
      const json = canvas.toObject(PERSIST_PROPS) as object;
      // Conserver une miniature HD de la page 0 pour la preview TipTap
      if (currentPageIndex === 0) {
        const hd = safeToDataURL(canvas, { multiplier: 100 / zoomRef.current, format: "jpeg", quality: 0.9 });
        if (hd) tiptapThumbRef.current = hd;
      }
      const updatedPages = [...pagesRef.current];
      updatedPages[currentPageIndex] = { ...updatedPages[currentPageIndex], json, thumbnail };
      pagesRef.current = updatedPages;
      setPages(updatedPages);

      // 2. Charger la page suivante
      const nextPage = updatedPages[nextIndex];
      setCurrentPageIndex(nextIndex);
      setPageFormat(nextPage.format);
      const nextFreeDims = nextPage.format === "free" && nextPage.customWidth && nextPage.customHeight
        ? { width: nextPage.customWidth, height: nextPage.customHeight }
        : PAGE_FORMATS["free"];
      if (nextPage.format === "free") setFreeDimensions(nextFreeDims);
      const dims = nextPage.format === "free" ? nextFreeDims : PAGE_FORMATS[nextPage.format];
      setPageSize(dims);
      setBgColor(nextPage.bgColor);
      canvas.setDimensions({
        width: dims.width * (zoom / 100),
        height: dims.height * (zoom / 100),
      });
      canvas.backgroundColor = nextPage.bgColor;

      isRestoringRef.current = true;
      try {
        if (nextPage.json) {
          await canvas.loadFromJSON(nextPage.json);
        } else {
          canvas.clear();
          canvas.backgroundColor = nextPage.bgColor;
        }
        canvas.renderAll();
      } finally {
        isRestoringRef.current = false;
      }

      // 3. Réinitialiser l'historique (un historique par page, V1)
      historyRef.current = [JSON.stringify(canvas.toObject(PERSIST_PROPS))];
      historyIndexRef.current = 0;
      setCanUndo(false);
      setCanRedo(false);
    },
    [currentPageIndex, zoom]
  );

  const handleAddPage = useCallback(() => {
    const canvas = fabricCanvasRef.current;
    const currentPage = pagesRef.current[currentPageIndex];
    const currentFormat = currentPage?.format ?? "a4-portrait";
    const currentCustomW = currentPage?.customWidth;
    const currentCustomH = currentPage?.customHeight;

    // Snapshot de la page courante
    const updatedPages = [...pagesRef.current];
    if (canvas) {
      updatedPages[currentPageIndex] = {
        ...updatedPages[currentPageIndex],
        json: canvas.toObject(PERSIST_PROPS) as object,
        thumbnail: safeToDataURL(canvas, { multiplier: 0.15 }),
      };
    }

    // Nouvelle page : fond transparent, mêmes dimensions que la page courante
    const newPage: DesignPage = {
      id: crypto.randomUUID(),
      name: `Page ${updatedPages.length + 1}`,
      format: currentFormat,
      bgColor: "transparent",
      json: null,
      thumbnail: null,
      ...(currentFormat === "free" && currentCustomW && currentCustomH
        ? { customWidth: currentCustomW, customHeight: currentCustomH }
        : {}),
    };
    updatedPages.push(newPage);
    pagesRef.current = updatedPages;
    setPages(updatedPages);

    const newIndex = updatedPages.length - 1;
    setCurrentPageIndex(newIndex);
    setPageFormat(currentFormat);

    const dims =
      currentFormat === "free" && currentCustomW && currentCustomH
        ? { width: currentCustomW, height: currentCustomH }
        : PAGE_FORMATS[currentFormat];
    setPageSize(dims);
    if (currentFormat === "free" && currentCustomW && currentCustomH) {
      setFreeDimensions({ width: currentCustomW, height: currentCustomH });
    }
    setBgColor("transparent");

    if (canvas) {
      canvas.setDimensions({
        width: dims.width * (zoom / 100),
        height: dims.height * (zoom / 100),
      });
      isRestoringRef.current = true;
      try {
        canvas.clear();
        canvas.backgroundColor = "";
        canvas.renderAll();
      } finally {
        isRestoringRef.current = false;
      }

      historyRef.current = [JSON.stringify(canvas.toObject(PERSIST_PROPS))];
      historyIndexRef.current = 0;
      setCanUndo(false);
      setCanRedo(false);
    }
  }, [currentPageIndex, zoom]);

  const handleDeletePage = useCallback(
    async (index: number) => {
      if (pagesRef.current.length <= 1) return; // Impossible de supprimer la seule page
      const canvas = fabricCanvasRef.current;

      const updatedPages = pagesRef.current.filter((_, i) => i !== index);
      const newIndex = Math.min(currentPageIndex, updatedPages.length - 1);
      pagesRef.current = updatedPages;
      setPages(updatedPages);

      if (index === currentPageIndex) {
        // On supprime la page active → charger la page à newIndex
        const nextPage = updatedPages[newIndex];
        setCurrentPageIndex(newIndex);
        setPageFormat(nextPage.format);
        setPageSize(PAGE_FORMATS[nextPage.format]);
        setBgColor(nextPage.bgColor);

        if (canvas) {
          const dims = PAGE_FORMATS[nextPage.format];
          canvas.setDimensions({
            width: dims.width * (zoom / 100),
            height: dims.height * (zoom / 100),
          });
          canvas.backgroundColor = nextPage.bgColor;
          isRestoringRef.current = true;
          try {
            if (nextPage.json) {
              await canvas.loadFromJSON(nextPage.json);
              canvas.renderAll();
            } else {
              canvas.clear();
              canvas.backgroundColor = nextPage.bgColor;
              canvas.renderAll();
            }
          } finally {
            isRestoringRef.current = false;
          }
          historyRef.current = [JSON.stringify(canvas.toObject(PERSIST_PROPS))];
          historyIndexRef.current = 0;
          setCanUndo(false);
          setCanRedo(false);
        }
      } else if (index < currentPageIndex) {
        // La page supprimée est avant l'active → décaler l'index
        setCurrentPageIndex(currentPageIndex - 1);
      }
      // Si index > currentPageIndex → aucun changement d'index
    },
    [currentPageIndex, zoom]
  );

  // Exports PNG / JPG / PDF avec résolution configurable
  const handleExport = useCallback(
    async (format: "png" | "jpeg" | "svg" | "pdf", dpi: number, opts: { transparent: boolean }) => {
      const canvas = fabricCanvasRef.current;
      if (!canvas) return;
      try {
        // Discard active selection before export for clean output
        canvas.discardActiveObject();
        canvas.renderAll();
        if (format === "pdf") {
          const updated = [...pagesRef.current];
          updated[currentPageIndex] = {
            ...updated[currentPageIndex],
            json: canvas.toObject(PERSIST_PROPS) as object,
          };
          await exportPdf(updated, dpi, title);
          return;
        }
        if (format === "svg") {
          exportSvg(canvas, pageSize, title);
          return;
        }
        exportRaster(canvas, { format, dpi, zoomPercent: zoomRef.current, transparent: opts.transparent, title });
      } catch (err) {
        alert(`Erreur lors de l'export : ${err instanceof Error ? err.message : "erreur inconnue"}`);
      }
    },
    [title, pageSize, currentPageIndex]
  );

  // Enregistrer comme template de design — ouvre le dialog dédié.
  const [templateDialogOpen, setTemplateDialogOpen] = useState(false);
  const handleSaveAsTemplate = useCallback(async () => {
    setTemplateDialogOpen(true);
  }, []);

  // Construit le DesignDocument courant + extrait les variables, puis POST vers
  // /api/studio/design-templates. Renvoie true si l'enregistrement a réussi.
  const submitTemplate = useCallback(
    async (opts: { name: string; category: string; isGlobal: boolean }): Promise<{ ok: boolean; error?: string }> => {
      const canvas = fabricCanvasRef.current;
      if (!canvas) return { ok: false, error: "Canvas indisponible" };

      const currentJson = canvas.toObject(PERSIST_PROPS) as object;
      const thumb = safeToDataURL(canvas, { multiplier: 0.15 });

      // Snapshot des pages avec la page courante à jour (props custom incluses).
      const pagesSnapshot = pagesRef.current.map((p, i) =>
        i === currentPageIndex ? { ...p, json: currentJson, thumbnail: thumb } : p
      );

      const doc: DesignDocument = {
        version: 2,
        title: opts.name,
        pages: pagesSnapshot,
      };

      // Extraction des variables sur TOUTES les pages (dédupe par clé).
      const variables = extractDesignVariables(pagesSnapshot);

      try {
        const res = await fetch("/api/studio/design-templates", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({
            name: opts.name,
            category: opts.category || undefined,
            isGlobal: opts.isGlobal,
            content: doc,
            variables,
            spaceId: opts.isGlobal ? undefined : spaceId,
          }),
        });
        if (res.ok) return { ok: true };
        const data = await res.json().catch(() => null);
        return { ok: false, error: (data as { error?: string } | null)?.error ?? "Erreur lors de l'enregistrement" };
      } catch {
        return { ok: false, error: "Erreur réseau" };
      }
    },
    [currentPageIndex, spaceId]
  );

  // Keyboard shortcuts
  useEffect(() => {
    const handler = (e: KeyboardEvent) => {
      const target = e.target as HTMLElement;
      // Don't capture if user types in an input
      if (target.tagName === "INPUT" || target.tagName === "TEXTAREA") return;

      if ((e.ctrlKey || e.metaKey) && e.key === "z") {
        e.preventDefault();
        handleUndo();
      } else if ((e.ctrlKey || e.metaKey) && (e.key === "y" || e.key === "Z")) {
        e.preventDefault();
        handleRedo();
      } else if ((e.ctrlKey || e.metaKey) && e.key === "=") {
        e.preventDefault();
        setZoom((z) => Math.min(400, z + 10));
      } else if ((e.ctrlKey || e.metaKey) && e.key === "-") {
        e.preventDefault();
        setZoom((z) => Math.max(10, z - 10));
      } else if ((e.ctrlKey || e.metaKey) && e.key === "s") {
        e.preventDefault();
        triggerSave();
      } else if ((e.ctrlKey || e.metaKey) && (e.key === "d" || e.key === "D")) {
        e.preventDefault();
        const canvas = fabricCanvasRef.current;
        if (canvas) void duplicateSelection(canvas);
      } else if ((e.ctrlKey || e.metaKey) && e.shiftKey && (e.key === "g" || e.key === "G")) {
        e.preventDefault();
        const canvas = fabricCanvasRef.current;
        if (canvas) void ungroupSelection(canvas);
      } else if ((e.ctrlKey || e.metaKey) && (e.key === "g" || e.key === "G")) {
        e.preventDefault();
        const canvas = fabricCanvasRef.current;
        if (canvas) void groupSelection(canvas);
      } else if (e.key === "Delete" || e.key === "Backspace") {
        const canvas = fabricCanvasRef.current;
        if (canvas) deleteSelection(canvas);
      }
    };
    window.addEventListener("keydown", handler);
    return () => window.removeEventListener("keydown", handler);
  }, [handleUndo, handleRedo, triggerSave]);

  const handlePanelDividerMouseDown = (e: React.MouseEvent) => {
    e.preventDefault();
    const startX = e.clientX;
    const startWidth = leftPanelWidth;
    const onMove = (ev: MouseEvent) => {
      setLeftPanelWidth(Math.max(180, Math.min(480, startWidth + ev.clientX - startX)));
    };
    const onUp = () => {
      document.removeEventListener("mousemove", onMove);
      document.removeEventListener("mouseup", onUp);
    };
    document.addEventListener("mousemove", onMove);
    document.addEventListener("mouseup", onUp);
  };

  // Wrap onClose to always flush a save before closing (avoids losing unsaved changes on quick close).
  // La sauvegarde ne doit JAMAIS empêcher la fermeture : si triggerSave lève (canvas
  // taché, etc.), on log et on ferme quand même — sinon le bouton « Fermer » paraît mort.
  const onCloseWithSave = useCallback(() => {
    try {
      triggerSave();
    } catch (err) {
      console.error("[design] échec de la sauvegarde à la fermeture :", err);
    }
    onClose();
  }, [triggerSave, onClose]);

  // ── Context value ─────────────────────────────────────────────────────────

  const contextValue: DesignContextValue = {
    fabricCanvasRef,
    fabricCanvas,
    canvasRef,
    areaContainerRef,
    zoom,
    setZoom,
    fitToViewport: () => fitToViewport(),
    title,
    setTitle,
    bgColor,
    pageFormat,
    pageSize,
    freeDimensions,
    pages,
    currentPageIndex,
    activeTool,
    panelVisible,
    leftPanelWidth,
    canUndo,
    canRedo,
    handleUndo,
    handleRedo,
    triggerSave,
    handleBgColorChange,
    handlePageFormatChange,
    handleFreeDimensionsChange,
    handleToolChange,
    handleExport,
    handleSaveAsTemplate,
    handlePanelDividerMouseDown,
    switchToPage,
    handleAddPage,
    handleDeletePage,
    spaceId,
    onSave,
    onClose: onCloseWithSave,
  };

  // Rail items for StudioRail — built from the TOOLS array defined in panels.tsx
  const railItems = TOOLS.map(({ id, icon, label }) => ({ id: id as string, icon, label }));

  return (
    <DesignContext.Provider value={contextValue}>
      <StudioShell
        className="loriax-design-studio"
        topbar={<DesignTopbar />}
        rail={
          <StudioRail
            items={railItems}
            activeId={activeTool}
            onSelect={(id) => handleToolChange(id as typeof activeTool)}
          />
        }
        panel={
          <>
            {/* DesignPageStrip (80px thumbnail strip) — sits between the rail and the panel,
                matching the original layout order: rail | pagestrip | panel | divider | canvas */}
            <DesignPageStrip />
            {panelVisible && (
              <>
                {/* DesignPanel manages its own per-tool container divs — no StudioPanel wrapper
                    to avoid double-nesting identical structures (DONE_WITH_CONCERNS: StudioPanel). */}
                <DesignPanel />
                {/* Draggable divider between panel and canvas */}
                <div
                  onMouseDown={handlePanelDividerMouseDown}
                  style={{ width: 4, flexShrink: 0, zIndex: 10 }}
                  className="cursor-col-resize transition-colors hover:bg-border"
                />
              </>
            )}
          </>
        }
        bottombar={<DesignBottombar />}
      >
        <DesignCanvasArea />
      </StudioShell>
      <SaveTemplateDialog
        open={templateDialogOpen}
        defaultName={title}
        onClose={() => setTemplateDialogOpen(false)}
        onSubmit={submitTemplate}
      />
    </DesignContext.Provider>
  );
}
