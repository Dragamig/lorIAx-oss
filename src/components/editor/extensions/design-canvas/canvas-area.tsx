"use client";

import { useState, useEffect } from "react";
import { ZoomIn, ZoomOut, ChevronRight, Maximize2 } from "lucide-react";
import { cn } from "@/lib/utils";
import { useDesignContext } from "./context";
import type { DesignPage, PageFormat } from "../design-constants";
import { FORMAT_GROUPS, FORMAT_LABELS } from "../design-constants";

// ─── TopbarIconBtn (utility, local) ──────────────────────────────────────────

function TopbarIconBtn({
  onClick,
  disabled,
  title,
  children,
}: {
  onClick: () => void;
  disabled?: boolean;
  title?: string;
  children: React.ReactNode;
}) {
  return (
    <button
      onClick={onClick}
      disabled={disabled}
      title={title}
      style={{ width: 30, height: 30 }}
      className={cn(
        "flex items-center justify-center rounded-[5px] border-0 bg-transparent transition-colors",
        disabled
          ? "text-muted-foreground/40 cursor-not-allowed"
          : "text-muted-foreground cursor-pointer hover:bg-muted hover:text-foreground"
      )}
    >
      {children}
    </button>
  );
}

// ─── DesignCanvasArea ─────────────────────────────────────────────────────────

export function DesignCanvasArea() {
  const { canvasRef, zoom, pageSize, areaContainerRef, setZoom } = useDesignContext();

  const scaledW = Math.round(pageSize.width * (zoom / 100));
  const scaledH = Math.round(pageSize.height * (zoom / 100));

  const handleWheel = (e: React.WheelEvent<HTMLDivElement>) => {
    if (!e.ctrlKey && !e.metaKey) return;
    e.preventDefault();
    const delta = e.deltaY < 0 ? 10 : -10;
    setZoom(Math.max(10, Math.min(400, zoom + delta)));
  };

  return (
    <div
      ref={areaContainerRef}
      onWheel={handleWheel}
      style={{ padding: 40 }}
      className="flex-1 bg-muted overflow-auto flex items-center justify-center"
    >
      <div
        style={{
          width: scaledW,
          height: scaledH,
          background: "transparent",
          position: "relative",
          flexShrink: 0,
        }}
      >
        {/* Shadow wrapper around the Fabric canvas */}
        <div
          style={{
            position: "absolute",
            inset: 0,
            boxShadow: "0 4px 32px rgba(0,0,0,0.22)",
            borderRadius: 2,
            pointerEvents: "none",
          }}
        />
        <canvas
          ref={canvasRef}
          style={{
            display: "block",
            borderRadius: 2,
          }}
        />
      </div>
    </div>
  );
}

// ─── PageThumb ────────────────────────────────────────────────────────────────

function PageThumb({
  page,
  index,
  isActive,
  canDelete,
}: {
  page: DesignPage;
  index: number;
  isActive: boolean;
  canDelete: boolean;
}) {
  const { switchToPage, handleDeletePage } = useDesignContext();
  const [hovered, setHovered] = useState(false);

  return (
    <div
      onClick={() => void switchToPage(index)}
      onMouseEnter={() => setHovered(true)}
      onMouseLeave={() => setHovered(false)}
      style={{ padding: 2, width: 64 }}
      className={cn(
        "relative cursor-pointer rounded-[4px] shrink-0",
        isActive ? "border-2 border-ring" : "border border-border"
      )}
    >
      <div
        style={{ width: 60, height: 44 }}
        className="bg-card rounded-sm overflow-hidden"
      >
        {page.thumbnail ? (
          // eslint-disable-next-line @next/next/no-img-element
          <img
            src={page.thumbnail}
            alt={page.name}
            style={{ width: "100%", height: "100%", objectFit: "contain" }}
          />
        ) : (
          /* bgColor is CREATIVE CONTENT — do not theme */
          <div style={{ width: "100%", height: "100%", background: page.bgColor }} />
        )}
      </div>
      <span
        style={{
          position: "absolute",
          bottom: 4,
          left: 4,
          fontSize: 9,
          /* rgba overlay kept as-is: semi-transparent black for legibility over variable content */
          background: "rgba(0,0,0,0.55)",
          padding: "1px 3px",
          borderRadius: 2,
        }}
        className="text-foreground"
      >
        {index + 1}
      </span>
      {hovered && canDelete && (
        <button
          onClick={(e) => {
            e.stopPropagation();
            void handleDeletePage(index);
          }}
          title="Supprimer la page"
          style={{
            position: "absolute",
            top: 2,
            right: 2,
            width: 16,
            height: 16,
            borderRadius: 3,
            fontSize: 11,
            lineHeight: 1,
            padding: 0,
          }}
          className="flex items-center justify-center border-0 cursor-pointer bg-destructive text-destructive-foreground"
        >
          ×
        </button>
      )}
    </div>
  );
}

// ─── DesignPageStrip ──────────────────────────────────────────────────────────

export function DesignPageStrip() {
  const { pages, currentPageIndex, handleAddPage } = useDesignContext();

  return (
    <div
      style={{ width: 80, minWidth: 80 }}
      className="bg-card border-r border-border flex flex-col items-center pt-2 pb-2 gap-1.5 overflow-y-auto overflow-x-hidden"
    >
      {pages.map((page, index) => (
        <PageThumb
          key={page.id}
          page={page}
          index={index}
          isActive={index === currentPageIndex}
          canDelete={pages.length > 1}
        />
      ))}
      <button
        onClick={handleAddPage}
        title="Ajouter une page"
        style={{ marginTop: 4, width: 32, height: 32, fontSize: 20 }}
        className="rounded-md bg-background border border-dashed border-border text-muted-foreground cursor-pointer flex items-center justify-center shrink-0"
      >
        +
      </button>
    </div>
  );
}

// ─── FreeDimInputs ────────────────────────────────────────────────────────────

export function FreeDimInputs({ dimInputStyle }: { dimInputStyle?: React.CSSProperties }) {
  const { freeDimensions, handleFreeDimensionsChange } = useDesignContext();

  const [wStr, setWStr] = useState(String(freeDimensions.width));
  const [hStr, setHStr] = useState(String(freeDimensions.height));

  // Sync si freeDimensions change depuis l'extérieur (ex: changement de page)
  useEffect(() => {
    setWStr(String(freeDimensions.width));
    setHStr(String(freeDimensions.height));
  }, [freeDimensions.width, freeDimensions.height]);

  // dimInputStyle prop preserved for callers that override; default uses tokens
  const defaultInputCls = "px-1.5 py-0.5 border border-border rounded bg-background text-foreground text-[11px]";

  const commitW = () => {
    const w = Math.max(100, Math.min(5000, parseInt(wStr) || freeDimensions.width));
    setWStr(String(w));
    if (w !== freeDimensions.width) handleFreeDimensionsChange({ ...freeDimensions, width: w });
  };
  const commitH = () => {
    const h = Math.max(100, Math.min(5000, parseInt(hStr) || freeDimensions.height));
    setHStr(String(h));
    if (h !== freeDimensions.height) handleFreeDimensionsChange({ ...freeDimensions, height: h });
  };

  const wWidth = Math.max(52, wStr.length * 8 + 20);
  const hWidth = Math.max(52, hStr.length * 8 + 20);

  return (
    <>
      <input
        type="text"
        inputMode="numeric"
        pattern="[0-9]*"
        value={wStr}
        onChange={(e) => setWStr(e.target.value.replace(/\D/g, ""))}
        onBlur={commitW}
        onKeyDown={(e) => { if (e.key === "Enter") { e.currentTarget.blur(); } }}
        title="Largeur en pixels"
        style={dimInputStyle ? { ...dimInputStyle, width: wWidth } : { width: wWidth }}
        className={dimInputStyle ? undefined : defaultInputCls}
      />
      <span className="text-[11px] text-muted-foreground">×</span>
      <input
        type="text"
        inputMode="numeric"
        pattern="[0-9]*"
        value={hStr}
        onChange={(e) => setHStr(e.target.value.replace(/\D/g, ""))}
        onBlur={commitH}
        onKeyDown={(e) => { if (e.key === "Enter") { e.currentTarget.blur(); } }}
        title="Hauteur en pixels"
        style={dimInputStyle ? { ...dimInputStyle, width: hWidth } : { width: hWidth }}
        className={dimInputStyle ? undefined : defaultInputCls}
      />
      <span className="text-[11px] text-muted-foreground">px</span>
    </>
  );
}

// ─── DesignBottombar ──────────────────────────────────────────────────────────

export function DesignBottombar() {
  const { zoom, setZoom, fitToViewport, pageFormat, handlePageFormatChange } = useDesignContext();

  return (
    <div
      style={{ height: 36, minHeight: 36, paddingLeft: 12, paddingRight: 12, gap: 8 }}
      className="bg-card flex items-center border-t border-border shrink-0"
    >
      {/* Format selector */}
      <div className="flex items-center gap-1.5">
        <ChevronRight size={12} className="text-muted-foreground" />
        <span className="text-[11px] text-muted-foreground">Pages</span>
        <select
          value={pageFormat}
          onChange={(e) => void handlePageFormatChange(e.target.value as PageFormat)}
          className="bg-background border border-border rounded text-foreground text-[11px] px-1.5 py-0.5 cursor-pointer"
        >
          {FORMAT_GROUPS.map((group) => (
            <optgroup key={group.label} label={group.label}>
              {group.formats.map((f) => (
                <option key={f} value={f}>
                  {FORMAT_LABELS[f]}
                </option>
              ))}
            </optgroup>
          ))}
        </select>
        {pageFormat === "free" && (
          <FreeDimInputs />
        )}
      </div>

      <div style={{ flex: 1 }} />

      {/* Zoom controls */}
      <div className="flex items-center gap-1">
        <TopbarIconBtn onClick={() => setZoom(Math.max(10, zoom - 10))} title="Réduire">
          <ZoomOut size={14} />
        </TopbarIconBtn>
        <button
          onClick={() => setZoom(100)}
          style={{ minWidth: 48, padding: "2px 6px" }}
          className="border border-border rounded bg-background text-foreground text-[11px] cursor-pointer"
          title="Réinitialiser à 100%"
        >
          {zoom}%
        </button>
        <TopbarIconBtn onClick={() => setZoom(Math.min(400, zoom + 10))} title="Agrandir">
          <ZoomIn size={14} />
        </TopbarIconBtn>
        <TopbarIconBtn onClick={() => fitToViewport()} title="Ajuster à l'écran">
          <Maximize2 size={14} />
        </TopbarIconBtn>
      </div>
    </div>
  );
}
