// src/components/editor/extensions/design-canvas/context.tsx
"use client";

import { createContext, useContext } from "react";
import type { Canvas as FabricCanvas } from "fabric";
import type { DesignPage, DesignDocument, PageFormat, PageDimensions } from "../design-constants";

export type ToolType =
  | "select"
  | "text"
  | "shapes"
  | "image"
  | "draw"
  | "background"
  | "layers"
  | "templates"
  | "brand";

export interface DesignContextValue {
  // ── Canvas engine
  fabricCanvasRef: React.MutableRefObject<FabricCanvas | null>;
  fabricCanvas: FabricCanvas | null;
  canvasRef: React.RefObject<HTMLCanvasElement | null>;
  areaContainerRef: React.RefObject<HTMLDivElement | null>;

  // ── État UI
  zoom: number;
  setZoom: (z: number) => void;
  fitToViewport: () => void;
  title: string;
  setTitle: (t: string) => void;
  bgColor: string;
  pageFormat: PageFormat;
  pageSize: PageDimensions;
  freeDimensions: PageDimensions;
  pages: DesignPage[];
  currentPageIndex: number;
  activeTool: ToolType;
  panelVisible: boolean;
  leftPanelWidth: number;
  canUndo: boolean;
  canRedo: boolean;

  // ── Actions canvas
  handleUndo: () => void;
  handleRedo: () => void;
  triggerSave: () => void;
  handleBgColorChange: (color: string) => void;
  handlePageFormatChange: (format: PageFormat) => Promise<void>;
  handleFreeDimensionsChange: (dims: PageDimensions) => void;
  handleToolChange: (tool: ToolType) => void;
  handleExport: (
    format: "png" | "jpeg" | "svg" | "pdf",
    dpi: number,
    opts: { transparent: boolean }
  ) => Promise<void>;
  handleSaveToLibrary: (dpi: number, opts: { transparent: boolean }) => Promise<void>;
  handleSaveAsTemplate: () => Promise<void>;
  handlePanelDividerMouseDown: (e: React.MouseEvent) => void;

  // ── Gestion pages
  switchToPage: (index: number) => Promise<void>;
  handleAddPage: () => void;
  handleDeletePage: (index: number) => Promise<void>;

  // ── Props transmises
  spaceId: string | undefined;
  onSave: (doc: DesignDocument, thumbnail: string) => void;
  onClose: () => void;
}

export const DesignContext = createContext<DesignContextValue | null>(null);

export function useDesignContext(): DesignContextValue {
  const ctx = useContext(DesignContext);
  if (!ctx) {
    throw new Error("useDesignContext must be used inside <DesignCanvas>");
  }
  return ctx;
}
