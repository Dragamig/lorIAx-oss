"use client";

import { useState, useEffect, useCallback, useRef } from "react";
import {
  Undo2,
  Redo2,
  PaintBucket,
  X,
  Save,
  LayoutTemplate,
  LibraryBig,
  MoreHorizontal,
  AlignStartVertical,
  AlignCenterVertical,
  AlignEndVertical,
  AlignStartHorizontal,
  AlignCenterHorizontal,
  AlignEndHorizontal,
  AlignHorizontalDistributeCenter,
  AlignVerticalDistributeCenter,
  Copy,
  Group as GroupIcon,
  Ungroup,
  RotateCw,
} from "lucide-react";
import type { FabricObject, IText as FabricIText } from "fabric";
import { cn } from "@/lib/utils";
import { useTranslations } from "next-intl";
import { StudioTopbar } from "@/components/editor/studio-shell";
import { useDesignContext } from "./context";
import { applyAlignment, type AlignAction } from "../design-align";
import { duplicateSelection, deleteSelection, groupSelection, ungroupSelection } from "../design-objects";
import { type DesignUnit, pxToUnit, unitToPx } from "./utils";

// ─── TopbarIconBtn ─────────────────────────────────────────────────────────────

export function TopbarIconBtn({
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

// ─── DesignTopbar ─────────────────────────────────────────────────────────────

export function DesignTopbar() {
  const tLib = useTranslations("designCanvas");
  const {
    title, setTitle,
    handleUndo, handleRedo, triggerSave, handleSaveAsTemplate, handleExport, handleSaveToLibrary, onClose,
    fabricCanvas, canUndo, canRedo,
    bgColor, handleBgColorChange, pageSize,
  } = useDesignContext();

  // Alias local pour réduire les diff avec le monolithe
  const canvas = fabricCanvas;
  const onUndo = handleUndo;
  const onRedo = handleRedo;
  const onSave = triggerSave;
  const onSaveAsTemplate = handleSaveAsTemplate;
  const onExport = handleExport;
  const onBgColorChange = handleBgColorChange;
  const onTitleChange = setTitle;

  const [showMenu, setShowMenu] = useState(false);
  const [exportDpi, setExportDpi] = useState(300);
  const [exportTransparent, setExportTransparent] = useState(false);

  // ── Unité de mesure ──────────────────────────────────────────────────────────
  const [unit, setUnit] = useState<DesignUnit>("px");

  // ── Sélection contextuelle ───────────────────────────────────────────────────
  const [selObj, setSelObj] = useState<FabricObject | null>(null);
  const [selCount, setSelCount] = useState(0);
  // fillColor / strokeColor are CREATIVE CONTENT state — default values intentionally kept as-is
  const [fillColor, setFillColor] = useState("#8b5cf6");
  const [strokeColor, setStrokeColor] = useState("#000000");
  // Valeurs internes en px (source de vérité)
  const posXPxRef = useRef(0);
  const posYPxRef = useRef(0);
  const objWPxRef = useRef(0);
  const objHPxRef = useRef(0);
  const strokeWPxRef = useRef(0);
  // Valeurs affichées (chaînes dans l'unité courante)
  const [posXStr, setPosXStr] = useState("0");
  const [posYStr, setPosYStr] = useState("0");
  const [objWStr, setObjWStr] = useState("0");
  const [objHStr, setObjHStr] = useState("0");
  const [strokeWidthStr, setStrokeWidthStr] = useState("0");
  const [isBold, setIsBold] = useState(false);
  const [isItalic, setIsItalic] = useState(false);
  const [isGroup, setIsGroup] = useState(false);
  const [angleStr, setAngleStr] = useState("0");

  const syncDimStrings = useCallback((u: DesignUnit) => {
    setPosXStr(pxToUnit(posXPxRef.current, u));
    setPosYStr(pxToUnit(posYPxRef.current, u));
    setObjWStr(pxToUnit(objWPxRef.current, u));
    setObjHStr(pxToUnit(objHPxRef.current, u));
    setStrokeWidthStr(pxToUnit(strokeWPxRef.current, u));
  }, []);

  // Re-convertir l'affichage quand l'unité change
  useEffect(() => { syncDimStrings(unit); }, [unit, syncDimStrings]);

  const syncFromObj = useCallback((obj: FabricObject | null, u: DesignUnit) => {
    if (!obj) { setSelObj(null); setIsGroup(false); setAngleStr("0"); return; }
    setSelObj(obj);
    // These defaults (#8b5cf6, #000000) are CREATIVE CONTENT fallbacks — keep as-is
    setFillColor(typeof obj.fill === "string" && obj.fill !== "transparent" ? obj.fill : "#8b5cf6");
    setStrokeColor(typeof obj.stroke === "string" && obj.stroke ? obj.stroke : "#000000");
    posXPxRef.current = obj.left ?? 0;
    posYPxRef.current = obj.top ?? 0;
    objWPxRef.current = (obj.width ?? 0) * (obj.scaleX ?? 1);
    objHPxRef.current = (obj.height ?? 0) * (obj.scaleY ?? 1);
    strokeWPxRef.current = obj.strokeWidth ?? 0;
    setPosXStr(pxToUnit(posXPxRef.current, u));
    setPosYStr(pxToUnit(posYPxRef.current, u));
    setObjWStr(pxToUnit(objWPxRef.current, u));
    setObjHStr(pxToUnit(objHPxRef.current, u));
    setStrokeWidthStr(pxToUnit(strokeWPxRef.current, u));
    const textObj = obj as FabricIText;
    setIsBold(textObj.fontWeight === "bold");
    setIsItalic(textObj.fontStyle === "italic");
    setIsGroup(obj.type === "group");
    setAngleStr(String(Math.round(obj.angle ?? 0)));
  }, []);

  // Wrapper stable pour les event listeners
  const unitRef = useRef<DesignUnit>("px");
  useEffect(() => { unitRef.current = unit; }, [unit]);

  useEffect(() => {
    if (!canvas) return;
    const onSel = () => {
      syncFromObj(canvas.getActiveObject() ?? null, unitRef.current);
      setSelCount(canvas.getActiveObjects().length);
    };
    const onTransform = () => {
      const o = canvas.getActiveObject();
      if (!o) return;
      posXPxRef.current = o.left ?? 0;
      posYPxRef.current = o.top ?? 0;
      objWPxRef.current = (o.width ?? 0) * (o.scaleX ?? 1);
      objHPxRef.current = (o.height ?? 0) * (o.scaleY ?? 1);
      strokeWPxRef.current = o.strokeWidth ?? 0;
      const u = unitRef.current;
      setPosXStr(pxToUnit(posXPxRef.current, u));
      setPosYStr(pxToUnit(posYPxRef.current, u));
      setObjWStr(pxToUnit(objWPxRef.current, u));
      setObjHStr(pxToUnit(objHPxRef.current, u));
      setStrokeWidthStr(pxToUnit(strokeWPxRef.current, u));
    };
    const onRotate = () => {
      const o = canvas.getActiveObject();
      if (o) setAngleStr(String(Math.round(o.angle ?? 0)));
    };
    canvas.on("selection:created", onSel);
    canvas.on("selection:updated", onSel);
    canvas.on("selection:cleared", onSel);
    canvas.on("object:moving", onTransform);
    canvas.on("object:scaling", onTransform);
    canvas.on("object:modified", onTransform);
    canvas.on("object:rotating", onRotate);
    return () => {
      canvas.off("selection:created", onSel);
      canvas.off("selection:updated", onSel);
      canvas.off("selection:cleared", onSel);
      canvas.off("object:moving", onTransform);
      canvas.off("object:scaling", onTransform);
      canvas.off("object:modified", onTransform);
      canvas.off("object:rotating", onRotate);
    };
  }, [canvas, syncFromObj]);

  // Shared chrome input class (toolbar contextual bar inputs)
  const ctxInputCls = "bg-background text-foreground border border-border rounded text-[11px] text-center px-1 py-0.5";

  // ── Selection context bar — passed as-is to StudioTopbar center slot ─────────
  const selectionContextBar = selObj ? (
    <>
      <div style={{ width: 1, height: 20, margin: "0 4px" }} className="bg-border" />
      {/* Remplissage — CREATIVE CONTENT color picker */}
      <label title="Remplissage" className="flex items-center gap-0.5 cursor-pointer text-[10px] text-muted-foreground">
        <span>F</span>
        <input
          type="color"
          value={fillColor}
          onChange={(e) => {
            setFillColor(e.target.value);
            selObj.set("fill", e.target.value);
            canvas?.renderAll();
          }}
          style={{ width: 20, height: 20, borderRadius: 3, cursor: "pointer", padding: 0 }}
          className="border border-input"
        />
      </label>
      {/* Contour — CREATIVE CONTENT color picker */}
      <label title="Contour" className="flex items-center gap-0.5 cursor-pointer text-[10px] text-muted-foreground">
        <span>C</span>
        <input
          type="color"
          value={strokeColor}
          onChange={(e) => {
            setStrokeColor(e.target.value);
            selObj.set("stroke", e.target.value);
            canvas?.renderAll();
          }}
          style={{ width: 20, height: 20, borderRadius: 3, cursor: "pointer", padding: 0 }}
          className="border border-input"
        />
      </label>
      {/* Épaisseur contour — dans l'unité courante */}
      <input
        type="text"
        inputMode="decimal"
        value={strokeWidthStr}
        title={`Épaisseur contour (${unit})`}
        onChange={(e) => {
          const raw = e.target.value.replace(/[^0-9.]/g, "");
          setStrokeWidthStr(raw);
          const px = Math.max(0, unitToPx(raw, unit));
          strokeWPxRef.current = px;
          selObj.set("strokeWidth", px);
          canvas?.renderAll();
        }}
        style={{ width: unit === "px" ? 36 : 44 }}
        className={ctxInputCls}
      />
      <div style={{ width: 1, height: 20, margin: "0 2px" }} className="bg-border" />
      {/* Position X */}
      <label title={`Position X (${unit})`} className="flex items-center gap-0.5 text-[10px] text-muted-foreground">
        X
        <input
          type="text"
          inputMode="decimal"
          value={posXStr}
          onChange={(e) => {
            const raw = e.target.value.replace(/[^0-9.\-]/g, "");
            setPosXStr(raw);
            const px = unitToPx(raw, unit);
            posXPxRef.current = px;
            selObj.set("left", px);
            canvas?.renderAll();
          }}
          style={{ width: unit === "px" ? 44 : 52 }}
          className={ctxInputCls}
        />
      </label>
      {/* Position Y */}
      <label title={`Position Y (${unit})`} className="flex items-center gap-0.5 text-[10px] text-muted-foreground">
        Y
        <input
          type="text"
          inputMode="decimal"
          value={posYStr}
          onChange={(e) => {
            const raw = e.target.value.replace(/[^0-9.\-]/g, "");
            setPosYStr(raw);
            const px = unitToPx(raw, unit);
            posYPxRef.current = px;
            selObj.set("top", px);
            canvas?.renderAll();
          }}
          style={{ width: unit === "px" ? 44 : 52 }}
          className={ctxInputCls}
        />
      </label>
      {/* Largeur */}
      <label title={`Largeur (${unit})`} className="flex items-center gap-0.5 text-[10px] text-muted-foreground">
        L
        <input
          type="text"
          inputMode="decimal"
          value={objWStr}
          onChange={(e) => {
            const raw = e.target.value.replace(/[^0-9.]/g, "");
            setObjWStr(raw);
            const px = Math.max(1, unitToPx(raw, unit));
            objWPxRef.current = px;
            const currentW = selObj.width ?? 1;
            selObj.set("scaleX", px / currentW);
            canvas?.renderAll();
          }}
          style={{ width: unit === "px" ? 44 : 52 }}
          className={ctxInputCls}
        />
      </label>
      {/* Hauteur */}
      <label title={`Hauteur (${unit})`} className="flex items-center gap-0.5 text-[10px] text-muted-foreground">
        H
        <input
          type="text"
          inputMode="decimal"
          value={objHStr}
          onChange={(e) => {
            const raw = e.target.value.replace(/[^0-9.]/g, "");
            setObjHStr(raw);
            const px = Math.max(1, unitToPx(raw, unit));
            objHPxRef.current = px;
            const currentH = selObj.height ?? 1;
            selObj.set("scaleY", px / currentH);
            canvas?.renderAll();
          }}
          style={{ width: unit === "px" ? 44 : 52 }}
          className={ctxInputCls}
        />
      </label>
      {/* Style texte (IText uniquement) */}
      {selObj.type === "i-text" || selObj.type === "text" || selObj.type === "textbox" ? (
        <>
          <div style={{ width: 1, height: 20, margin: "0 2px" }} className="bg-border" />
          <button
            onClick={() => {
              const next = !isBold;
              setIsBold(next);
              selObj.set("fontWeight", next ? "bold" : "normal");
              canvas?.renderAll();
            }}
            title="Gras"
            style={{ padding: "3px 6px", fontSize: 12, fontWeight: 700 }}
            className={cn(
              "border border-border rounded cursor-pointer",
              isBold ? "bg-accent text-accent-foreground" : "bg-background text-muted-foreground"
            )}
          >B</button>
          <button
            onClick={() => {
              const next = !isItalic;
              setIsItalic(next);
              selObj.set("fontStyle", next ? "italic" : "normal");
              canvas?.renderAll();
            }}
            title="Italique"
            style={{ padding: "3px 6px", fontSize: 12, fontStyle: "italic" }}
            className={cn(
              "border border-border rounded cursor-pointer",
              isItalic ? "bg-accent text-accent-foreground" : "bg-background text-muted-foreground"
            )}
          >I</button>
        </>
      ) : null}
      {/* Alignement */}
      <div style={{ width: 1, height: 20, margin: "0 2px" }} className="bg-border" />
      {(
        [
          { a: "left", icon: <AlignStartVertical size={13} />, t: "Aligner à gauche" },
          { a: "center-h", icon: <AlignCenterVertical size={13} />, t: "Centrer horizontalement" },
          { a: "right", icon: <AlignEndVertical size={13} />, t: "Aligner à droite" },
          { a: "top", icon: <AlignStartHorizontal size={13} />, t: "Aligner en haut" },
          { a: "middle-v", icon: <AlignCenterHorizontal size={13} />, t: "Centrer verticalement" },
          { a: "bottom", icon: <AlignEndHorizontal size={13} />, t: "Aligner en bas" },
        ] as Array<{ a: AlignAction; icon: React.ReactNode; t: string }>
      ).map(({ a, icon, t }) => (
        <TopbarIconBtn key={a} onClick={() => { if (canvas) void applyAlignment(canvas, a, pageSize); }} title={t}>
          {icon}
        </TopbarIconBtn>
      ))}
      {selCount >= 3 && (
        <>
          <TopbarIconBtn onClick={() => { if (canvas) void applyAlignment(canvas, "distribute-h", pageSize); }} title="Distribuer horizontalement">
            <AlignHorizontalDistributeCenter size={13} />
          </TopbarIconBtn>
          <TopbarIconBtn onClick={() => { if (canvas) void applyAlignment(canvas, "distribute-v", pageSize); }} title="Distribuer verticalement">
            <AlignVerticalDistributeCenter size={13} />
          </TopbarIconBtn>
        </>
      )}
      <div style={{ width: 1, height: 20, margin: "0 2px" }} className="bg-border" />
      {/* Angle */}
      <label title="Rotation (°)" className="flex items-center gap-0.5 text-[10px] text-muted-foreground">
        <RotateCw size={11} />
        <input
          type="text"
          inputMode="decimal"
          value={angleStr}
          onChange={(e) => {
            const raw = e.target.value.replace(/[^0-9.\-]/g, "");
            setAngleStr(raw);
            const deg = parseFloat(raw);
            if (!Number.isNaN(deg)) {
              selObj.rotate(deg);
              selObj.setCoords();
              canvas?.renderAll();
            }
          }}
          style={{ width: 36 }}
          className={ctxInputCls}
        />
      </label>
      {/* Dupliquer */}
      <TopbarIconBtn onClick={() => { if (canvas) void duplicateSelection(canvas); }} title="Dupliquer (Ctrl+D)">
        <Copy size={13} />
      </TopbarIconBtn>
      {/* Grouper / Dégrouper */}
      {selCount >= 2 && (
        <TopbarIconBtn onClick={() => { if (canvas) void groupSelection(canvas); }} title="Grouper (Ctrl+G)">
          <GroupIcon size={13} />
        </TopbarIconBtn>
      )}
      {isGroup && (
        <TopbarIconBtn onClick={() => { if (canvas) void ungroupSelection(canvas); }} title="Dégrouper (Ctrl+Shift+G)">
          <Ungroup size={13} />
        </TopbarIconBtn>
      )}
    </>
  ) : undefined;

  return (
    <StudioTopbar
      left={
        <>
          {/* Undo / Redo */}
          <TopbarIconBtn onClick={onUndo} disabled={!canUndo} title="Annuler (Ctrl+Z)">
            <Undo2 size={16} />
          </TopbarIconBtn>
          <TopbarIconBtn onClick={onRedo} disabled={!canRedo} title="Rétablir (Ctrl+Y)">
            <Redo2 size={16} />
          </TopbarIconBtn>
          <div style={{ width: 1, height: 20, margin: "0 4px" }} className="bg-border" />
          {/* Background color shortcut */}
          <label title="Couleur de fond" className="flex items-center gap-1 cursor-pointer">
            <PaintBucket size={14} className="text-muted-foreground" />
            {/* bgColor picker controls CREATIVE CONTENT — border chrome only */}
            <input
              type="color"
              value={bgColor}
              onChange={(e) => onBgColorChange(e.target.value)}
              style={{ width: 22, height: 22, borderRadius: 3, cursor: "pointer", background: "none", padding: 0 }}
              className="border border-input"
            />
          </label>
        </>
      }
      center={
        /* Inner flex container: title (flex-1) + unit selector + optional selection context bar */
        <div className="flex items-center gap-1 flex-1 min-w-0">
          {/* Title */}
          <input
            type="text"
            value={title}
            onChange={(e) => onTitleChange(e.target.value)}
            placeholder="Design sans titre"
            style={{
              flex: 1,
              minWidth: 120,
              maxWidth: 300,
              fontSize: 13,
              fontWeight: 600,
              padding: "2px 4px",
              textAlign: "center",
              transition: "border-color 0.15s",
            }}
            className="bg-transparent border-0 border-b border-transparent text-foreground outline-none focus:border-ring"
          />
          {/* Sélecteur d'unité — toujours visible */}
          <div style={{ display: "flex", gap: 1, marginLeft: 4 }}>
            {(["px", "cm", "mm"] as DesignUnit[]).map((u) => (
              <button
                key={u}
                onClick={() => setUnit(u)}
                style={{
                  padding: "2px 5px",
                  fontSize: 10,
                  borderRadius: u === "px" ? "4px 0 0 4px" : u === "mm" ? "0 4px 4px 0" : "0",
                  fontWeight: unit === u ? 700 : 400,
                }}
                className={cn(
                  "border border-border cursor-pointer",
                  unit === u
                    ? "bg-accent text-accent-foreground"
                    : "bg-background text-muted-foreground"
                )}
              >{u}</button>
            ))}
          </div>
          {/* Barre contextuelle sélection — passée telle quelle dans le slot center */}
          {selectionContextBar}
        </div>
      }
      right={
        <>
          {/* Save + actions menu */}
          <div style={{ display: "flex", alignItems: "center", gap: 2, position: "relative" }}>
            <button
              onClick={onSave}
              style={{ gap: 5, padding: "5px 12px", fontSize: 12, fontWeight: 600 }}
              className="flex items-center border-0 rounded-[5px_0_0_5px] bg-primary text-primary-foreground cursor-pointer transition-colors hover:bg-primary/90"
            >
              <Save size={14} />
              Enregistrer
            </button>
            <button
              onClick={() => setShowMenu((v) => !v)}
              title="Plus d'actions"
              style={{ width: 26, height: 28 }}
              className="flex items-center justify-center border-0 border-l border-primary/80 rounded-[0_5px_5px_0] bg-primary text-primary-foreground cursor-pointer transition-colors hover:bg-primary/90"
            >
              <MoreHorizontal size={14} />
            </button>
            {showMenu && (
              <div
                style={{
                  position: "absolute",
                  top: "calc(100% + 4px)",
                  right: 0,
                  boxShadow: "0 4px 16px rgba(0,0,0,0.4)",
                  zIndex: 100,
                  minWidth: 200,
                  overflow: "hidden",
                }}
                className="bg-card border border-border rounded-md"
              >
                <button
                  onClick={() => { setShowMenu(false); void onSaveAsTemplate(); }}
                  style={{ gap: 8, padding: "9px 14px", fontSize: 12 }}
                  className="flex items-center w-full border-0 bg-transparent text-foreground cursor-pointer text-left transition-colors hover:bg-muted"
                >
                  <LayoutTemplate size={14} className="text-primary" />
                  Enregistrer comme template
                </button>
                {/* Séparateur */}
                <div style={{ height: 1, margin: "2px 0" }} className="bg-border" />
                {/* Sélecteur résolution */}
                <div style={{ padding: "8px 14px 4px" }}>
                  <div style={{ fontSize: 10, marginBottom: 5, textTransform: "uppercase", letterSpacing: "0.05em" }} className="text-muted-foreground">Résolution (ppp)</div>
                  <div style={{ display: "flex", gap: 4 }}>
                    {([72, 150, 300, 600] as const).map((v) => (
                      <button
                        key={v}
                        onClick={() => setExportDpi(v)}
                        style={{ flex: 1, padding: "4px 2px", fontSize: 11, fontWeight: exportDpi === v ? 600 : 400 }}
                        className={cn(
                          "border rounded cursor-pointer",
                          exportDpi === v
                            ? "bg-accent text-accent-foreground border-primary"
                            : "bg-background text-muted-foreground border-border"
                        )}
                      >
                        {v}
                      </button>
                    ))}
                  </div>
                </div>
                {/* Transparent background option */}
                <label style={{ gap: 6, padding: "6px 14px", fontSize: 11 }} className="flex items-center text-muted-foreground cursor-pointer">
                  <input type="checkbox" checked={exportTransparent} onChange={(e) => setExportTransparent(e.target.checked)} />
                  Fond transparent (PNG)
                </label>
                {/* Enregistrer l'export PNG dans la médiathèque */}
                <button
                  onClick={() => { setShowMenu(false); void handleSaveToLibrary(exportDpi, { transparent: exportTransparent }); }}
                  title={tLib("saveToLibrary")}
                  aria-label={tLib("saveToLibrary")}
                  style={{ gap: 8, padding: "9px 14px", fontSize: 12 }}
                  className="flex items-center w-full border-0 bg-transparent text-foreground cursor-pointer text-left transition-colors hover:bg-muted"
                >
                  <LibraryBig size={14} className="text-primary" />
                  {tLib("saveToLibrary")}
                </button>
                {/* Exports */}
                {(["png", "jpeg", "svg", "pdf"] as const).map((fmt) => {
                  const labels: Record<string, string> = {
                    png: "Exporter en PNG",
                    jpeg: "Exporter en JPG",
                    svg: "Exporter en SVG",
                    pdf: "Exporter en PDF (toutes les pages)",
                  };
                  // Format indicator dot colors (chrome UI, using standard Tailwind palette)
                  const dotCls: Record<string, string> = {
                    png: "bg-emerald-400",
                    jpeg: "bg-blue-400",
                    svg: "bg-amber-400",
                    pdf: "bg-red-400",
                  };
                  return (
                    <button
                      key={fmt}
                      onClick={() => { setShowMenu(false); void onExport(fmt, exportDpi, { transparent: exportTransparent }); }}
                      style={{ gap: 8, padding: "9px 14px", fontSize: 12 }}
                      className="flex items-center w-full border-0 bg-transparent text-foreground cursor-pointer text-left transition-colors hover:bg-muted"
                    >
                      <span style={{ width: 8, height: 8, borderRadius: 2, display: "inline-block" }} className={dotCls[fmt]} />
                      {labels[fmt]}
                    </button>
                  );
                })}
              </div>
            )}
          </div>
          {/* Close */}
          <TopbarIconBtn onClick={onClose} title="Fermer">
            <X size={16} />
          </TopbarIconBtn>
        </>
      }
    />
  );
}

// Suppress unused import warning — deleteSelection is re-exported for consumers
void (deleteSelection as unknown);
