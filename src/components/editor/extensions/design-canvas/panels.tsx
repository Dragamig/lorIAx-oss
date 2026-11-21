"use client";

import { Hint } from "@/components/ui/hint";
import { useState, useEffect, useCallback, useRef } from "react";
import {
  MousePointer2,
  Type,
  Shapes,
  Image as ImageIcon,
  Pencil,
  Layers,
  LayoutTemplate,
  Plus,
  Check,
  AlignLeft,
  AlignCenter,
  AlignRight,
  ArrowUp,
  ArrowDown,
  Trash2,
  Palette,
  Variable,
} from "lucide-react";
import type { Canvas as FabricCanvas, FabricObject, IText as FabricIText, Shadow as FabricShadow, PencilBrush } from "fabric";
import { toast } from "sonner";
import { useTranslations } from "next-intl";
import { MediaPicker } from "@/components/media/picker/media-picker";
import type { PickedMedia } from "@/components/media/picker/types";
import { cn } from "@/lib/utils";
import { useDesignContext } from "./context";
import type { ToolType } from "./context";
import type { TextPreset } from "./utils";
import { SVG_SHAPES, LINE_SHAPES, TEXT_PRESETS, slugifyVariableKey } from "./utils";
import { FONT_GROUPS } from "../design-constants";
import { DesignBrandPanel } from "../design-brand-panel";

// ─── Sidebar nav ─────────────────────────────────────────────────────────────

export const TOOLS: Array<{ id: ToolType; icon: React.ReactNode; label: string }> = [
  { id: "select", icon: <MousePointer2 size={20} />, label: "Sélection" },
  { id: "text", icon: <Type size={20} />, label: "Texte" },
  { id: "shapes", icon: <Shapes size={20} />, label: "Formes" },
  { id: "image", icon: <ImageIcon size={20} />, label: "Photos" },
  { id: "brand", icon: <Palette size={20} />, label: "Marque" },
  { id: "draw", icon: <Pencil size={20} />, label: "Dessin" },
  { id: "layers", icon: <Layers size={20} />, label: "Calques" },
  { id: "templates", icon: <LayoutTemplate size={20} />, label: "Modèles" },
];

// ─── Shared token-based class strings ────────────────────────────────────────

/** Input chrome classes — colors only; pair with dimension style if needed */
const inputCls =
  "block w-full px-2 py-1 border border-border rounded bg-background text-foreground text-xs";

/** Panel container chrome classes */
const panelCls = "bg-card border-r border-border text-foreground";

/** Shared panel dimension style (width/padding/gap are context-dependent) */
const basePanelDimStyle: React.CSSProperties = {
  width: 280,
  minWidth: 280,
  display: "flex",
  flexDirection: "column",
  overflowY: "auto",
  padding: "12px 10px",
  gap: 12,
};

/** Section title chrome classes */
const sectionTitleCls = "text-muted-foreground";

/** Section title dimension style */
const sectionTitleDimStyle: React.CSSProperties = {
  fontSize: 10,
  fontWeight: 700,
  letterSpacing: "0.08em",
  textTransform: "uppercase",
  marginBottom: 6,
  marginTop: 4,
};

// ─── insertImageFromUrl — standalone, pas de context ─────────────────────────

/** Retourne l'URL à charger dans Fabric.js — proxy pour les images externes afin d'éviter le canvas taché. */
function resolveImageUrl(url: string): string {
  if (url.startsWith("data:") || url.startsWith("/")) return url;
  try {
    const parsed = new URL(url);
    if (parsed.hostname === window.location.hostname) return url;
    return `/api/images/proxy?url=${encodeURIComponent(url)}`;
  } catch {
    return url;
  }
}

export async function insertImageFromUrl(url: string, canvas: FabricCanvas): Promise<void> {
  const { FabricImage } = await import("fabric");
  const safeUrl = resolveImageUrl(url);
  const img = await FabricImage.fromURL(safeUrl, { crossOrigin: "anonymous" });
  const maxW = (canvas.getWidth() / (canvas.getZoom() || 1)) * 0.6;
  if (img.width && img.width > maxW) img.scaleToWidth(maxW);
  img.set({ left: 50, top: 50 });
  canvas.add(img);
  canvas.setActiveObject(img);
  canvas.renderAll();
}

// ─── ShapeButton ──────────────────────────────────────────────────────────────

function ShapeButton({
  children,
  label,
  onClick,
}: {
  children: React.ReactNode;
  label: string;
  onClick: () => void;
}) {
  return (
    <button
      onClick={onClick}
      title={label}
      style={{ padding: "8px 4px", fontSize: 10 }}
      className="flex flex-col items-center gap-1 border border-border rounded-md cursor-pointer bg-background text-muted-foreground transition-colors hover:bg-accent/20 hover:border-ring"
    >
      <svg viewBox="0 0 32 32" width={32} height={32}>
        {children}
      </svg>
      <span>{label}</span>
    </button>
  );
}

// ─── StyleButton ──────────────────────────────────────────────────────────────

function StyleButton({
  active,
  onClick,
  label,
  title,
  style,
}: {
  active: boolean;
  onClick: () => void;
  label: string;
  title: string;
  style?: React.CSSProperties;
}) {
  return (
    <button
      onClick={onClick}
      title={title}
      style={{ padding: "5px 10px", fontSize: 13, ...style }}
      className={cn(
        "border rounded cursor-pointer",
        active
          ? "bg-accent text-accent-foreground border-ring"
          : "bg-background text-muted-foreground border-border"
      )}
    >
      {label}
    </button>
  );
}

// ─── CustomFontPanel ──────────────────────────────────────────────────────────

// Persistant au niveau module : les polices chargées par l'utilisateur survivent
// au démontage du panneau (changement de sélection / d'outil). Les FontFace sont
// déjà ajoutées à `document.fonts`, on ne conserve ici que les noms pour la liste.
const loadedCustomFonts: string[] = [];

export function CustomFontPanel({ textObj }: { textObj: FabricIText }) {
  const { fabricCanvas: canvas } = useDesignContext();
  const [customFonts, setCustomFonts] = useState<string[]>(() => [...loadedCustomFonts]);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState("");
  const fileInputRef = useRef<HTMLInputElement>(null);

  const loadFontFile = async (file: File) => {
    setError("");
    setLoading(true);
    try {
      const name = file.name.replace(/\.[^.]+$/, "").replace(/[-_]+/g, " ").trim();
      if (customFonts.includes(name)) {
        textObj.set("fontFamily", name);
        canvas?.renderAll();
        setLoading(false);
        return;
      }
      const buffer = await file.arrayBuffer();
      const face = new FontFace(name, buffer);
      const loaded = await face.load();
      document.fonts.add(loaded);
      if (!loadedCustomFonts.includes(name)) loadedCustomFonts.push(name);
      setCustomFonts((prev) => (prev.includes(name) ? prev : [...prev, name]));
      textObj.set("fontFamily", name);
      canvas?.renderAll();
    } catch {
      setError("Impossible de charger cette police.");
    }
    setLoading(false);
  };

  return (
    <>
      <select
        value={textObj.fontFamily ?? "Plus Jakarta Sans"}
        onChange={(e) => {
          textObj.set("fontFamily", e.target.value);
          canvas?.renderAll();
        }}
        style={{ marginBottom: 4 }}
        className={inputCls}
      >
        {/* Polices personnelles d'abord : en tête de liste */}
        {customFonts.length > 0 && (
          <optgroup label="Mes polices">
            {customFonts.map((font) => (
              <option key={font} value={font} style={{ fontFamily: font }}>
                {font}
              </option>
            ))}
          </optgroup>
        )}
        {FONT_GROUPS.map((group) => (
          <optgroup key={group.label} label={group.label}>
            {group.fonts.map((font) => (
              <option key={font} value={font} style={{ fontFamily: font }}>
                {font}
              </option>
            ))}
          </optgroup>
        ))}
      </select>

      {/* Chargement d'un fichier de police local (fixe ou variable) */}
      <div style={{ display: "flex", gap: 4, marginBottom: error ? 4 : 8 }}>
        <input
          ref={fileInputRef}
          type="file"
          accept=".ttf,.otf,.woff,.woff2"
          style={{ display: "none" }}
          onChange={(e) => { const f = e.target.files?.[0]; if (f) loadFontFile(f); e.target.value = ""; }}
        />
        <button
          onClick={() => fileInputRef.current?.click()}
          disabled={loading}
          title="Charger un fichier de police (.ttf, .otf, .woff, .woff2)"
          style={{ gap: 5, padding: "5px 8px", fontSize: 11 }}
          className={cn(
            "flex items-center w-full border border-dashed rounded justify-center",
            loading
              ? "border-border text-muted-foreground/40 cursor-not-allowed bg-background"
              : "border-border text-primary cursor-pointer bg-background"
          )}
        >
          {loading ? "Chargement…" : <><Plus size={12} /> Police locale (.ttf, .otf, .woff…)</>}
        </button>
      </div>
      {error && <p style={{ fontSize: 10, marginBottom: 6 }} className="text-destructive">{error}</p>}

      <label style={{ fontSize: 11 }} className="text-muted-foreground">
        Taille (px)
        <input
          type="number"
          value={Math.round(textObj.fontSize ?? 16)}
          min={6}
          max={400}
          onChange={(e) => {
            textObj.set("fontSize", parseInt(e.target.value));
            canvas?.renderAll();
          }}
          style={{ marginTop: 3 }}
          className={inputCls}
        />
      </label>

      <label style={{ fontSize: 11 }} className="text-muted-foreground">
        Graisse
        {(() => {
          const raw = textObj.fontWeight;
          const w = typeof raw === "number" ? raw : raw === "bold" ? 700 : 400;
          const setW = (v: number) => {
            textObj.set("fontWeight", v);
            canvas?.renderAll();
          };
          return (
            <div style={{ display: "flex", alignItems: "center", gap: 6, marginTop: 3 }}>
              <input
                type="range"
                min={100}
                max={900}
                step={1}
                value={w}
                onChange={(e) => setW(parseInt(e.target.value))}
                style={{ flex: 1, accentColor: "var(--primary)" }}
              />
              <input
                type="number"
                min={100}
                max={900}
                step={1}
                value={w}
                onChange={(e) => setW(Math.min(900, Math.max(100, parseInt(e.target.value) || 400)))}
                style={{ width: 52 }}
                className={inputCls}
              />
            </div>
          );
        })()}
      </label>
    </>
  );
}

// ─── TextShadowControls ───────────────────────────────────────────────────────

export function TextShadowControls({ textObj }: { textObj: FabricObject }) {
  const { fabricCanvas: canvas } = useDesignContext();
  const existingShadow = textObj.shadow as FabricShadow | null;
  const [enabled, setEnabled] = useState(!!existingShadow);
  // Shadow color is CREATIVE CONTENT — default kept as-is
  const [color, setColor] = useState(existingShadow?.color ?? "#000000");
  const [x, setX] = useState(existingShadow?.offsetX ?? 2);
  const [y, setY] = useState(existingShadow?.offsetY ?? 2);
  const [blur, setBlur] = useState(existingShadow?.blur ?? 4);

  const apply = (opts: { enabled: boolean; color: string; x: number; y: number; blur: number }) => {
    if (!opts.enabled) {
      textObj.set("shadow", null);
    } else {
      import("fabric").then(({ Shadow }) => {
        textObj.set("shadow", new Shadow({ color: opts.color, offsetX: opts.x, offsetY: opts.y, blur: opts.blur }));
        canvas?.renderAll();
      });
    }
    canvas?.renderAll();
  };

  return (
    <div style={{ display: "flex", flexDirection: "column", gap: 6 }}>
      <label style={{ fontSize: 11, cursor: "pointer", display: "flex", alignItems: "center", gap: 8 }} className="text-muted-foreground">
        <input
          type="checkbox"
          checked={enabled}
          onChange={(e) => {
            setEnabled(e.target.checked);
            apply({ enabled: e.target.checked, color, x, y, blur });
          }}
        />
        Activer l&apos;ombre
      </label>
      {enabled && (
        <>
          <label style={{ fontSize: 11 }} className="text-muted-foreground">
            Couleur
            {/* Shadow color picker — CREATIVE CONTENT */}
            <input
              type="color"
              value={color}
              onChange={(e) => {
                setColor(e.target.value);
                apply({ enabled, color: e.target.value, x, y, blur });
              }}
              style={{ display: "block", marginTop: 3, width: "100%", height: 26, borderRadius: 4, cursor: "pointer", background: "none" }}
              className="border border-border"
            />
          </label>
          <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr 1fr", gap: 6 }}>
            <label style={{ fontSize: 11 }} className="text-muted-foreground">
              X
              <input
                type="number"
                value={x}
                min={-20}
                max={20}
                onChange={(e) => { const v = parseInt(e.target.value); setX(v); apply({ enabled, color, x: v, y, blur }); }}
                style={{ marginTop: 3 }}
                className={inputCls}
              />
            </label>
            <label style={{ fontSize: 11 }} className="text-muted-foreground">
              Y
              <input
                type="number"
                value={y}
                min={-20}
                max={20}
                onChange={(e) => { const v = parseInt(e.target.value); setY(v); apply({ enabled, color, x, y: v, blur }); }}
                style={{ marginTop: 3 }}
                className={inputCls}
              />
            </label>
            <label style={{ fontSize: 11 }} className="text-muted-foreground">
              Flou
              <input
                type="number"
                value={blur}
                min={0}
                max={30}
                onChange={(e) => { const v = parseInt(e.target.value); setBlur(v); apply({ enabled, color, x, y, blur: v }); }}
                style={{ marginTop: 3 }}
                className={inputCls}
              />
            </label>
          </div>
        </>
      )}
    </div>
  );
}

// ─── VariableControls (data-binding d'un calque texte) ────────────────────────

/** Propriétés custom Fabric d'un calque « rendu variable ». */
type VariableLayer = FabricIText & {
  layerId?: string;
  variableKey?: string;
  variableLabel?: string;
};

/**
 * Bloc « Rendre variable » du panneau texte : transforme un calque texte en
 * variable de data-binding (template de design). Pose 3 props custom stables sur
 * l'objet Fabric : `layerId` (uuid), `variableKey`, `variableLabel`.
 * La sérialisation de ces props est assurée par PERSIST_PROPS (voir utils.tsx).
 */
export function VariableControls({ textObj }: { textObj: FabricIText }) {
  const { fabricCanvas: canvas, triggerSave } = useDesignContext();
  const obj = textObj as VariableLayer;
  const [editing, setEditing] = useState(false);
  const [keyInput, setKeyInput] = useState("");
  const [labelInput, setLabelInput] = useState("");
  const [error, setError] = useState("");
  // Force un re-render local après mutation des props custom (hors state React).
  const [, forceRender] = useState(0);
  const bump = () => forceRender((n) => n + 1);

  const isVariable = typeof obj.variableKey === "string" && !!obj.variableKey;

  const openForm = () => {
    const currentText = typeof textObj.text === "string" ? textObj.text : "";
    setKeyInput(obj.variableKey ?? slugifyVariableKey(currentText));
    setLabelInput(obj.variableLabel ?? currentText.slice(0, 60));
    setError("");
    setEditing(true);
  };

  const commit = () => {
    const key = slugifyVariableKey(keyInput);
    if (!key) { setError("Clé invalide."); return; }
    const label = labelInput.trim() || key;
    // Unicité de la clé parmi les autres calques variabilisés du canvas courant.
    const clash = (canvas?.getObjects() ?? []).some(
      (o) => o !== textObj && (o as VariableLayer).variableKey === key
    );
    if (clash) { setError("Cette clé est déjà utilisée par un autre calque."); return; }

    obj.set({
      layerId: obj.layerId ?? crypto.randomUUID(),
      variableKey: key,
      variableLabel: label,
    } as Partial<FabricObject>);
    canvas?.requestRenderAll();
    // Passe par le flux de mutation standard (historique + auto-save + miniature).
    canvas?.fire("object:modified", { target: textObj } as never);
    triggerSave();
    setEditing(false);
    bump();
  };

  const removeVariable = () => {
    // Unset des 3 props custom : mises à undefined (JSON.stringify les élimine à
    // la sérialisation, et extractDesignVariables ignore une variableKey absente).
    obj.set({
      layerId: undefined,
      variableKey: undefined,
      variableLabel: undefined,
    } as Partial<FabricObject>);
    canvas?.requestRenderAll();
    canvas?.fire("object:modified", { target: textObj } as never);
    triggerSave();
    setEditing(false);
    bump();
  };

  return (
    <>
      <p style={{ ...sectionTitleDimStyle, marginTop: 10 }} className={sectionTitleCls}>
        Variable de données
      </p>

      {isVariable && !editing && (
        <div
          style={{ padding: "8px 10px", borderRadius: 6, fontSize: 11 }}
          className="border border-primary/40 bg-primary/10 text-foreground"
        >
          <div style={{ display: "flex", alignItems: "center", gap: 6 }}>
            <Variable size={13} className="text-primary" />
            <span
              style={{ fontFamily: "monospace", fontWeight: 600 }}
              className="text-primary"
            >
              {obj.variableKey}
            </span>
          </div>
          {obj.variableLabel && (
            <div style={{ marginTop: 3 }} className="text-muted-foreground">
              {obj.variableLabel}
            </div>
          )}
          <div style={{ display: "flex", gap: 6, marginTop: 8 }}>
            <button
              onClick={openForm}
              style={{ flex: 1, padding: "4px 8px", fontSize: 11 }}
              className="border border-border rounded bg-background text-foreground cursor-pointer"
            >
              Modifier
            </button>
            <button
              onClick={removeVariable}
              style={{ flex: 1, padding: "4px 8px", fontSize: 11 }}
              className="border border-destructive/50 rounded bg-destructive/10 text-destructive cursor-pointer"
            >
              Retirer
            </button>
          </div>
        </div>
      )}

      {!isVariable && !editing && (
        <button
          onClick={openForm}
          style={{ display: "flex", alignItems: "center", justifyContent: "center", gap: 6, width: "100%", padding: "7px 10px", fontSize: 12 }}
          className="border border-border rounded-md bg-background text-foreground cursor-pointer hover:bg-muted"
        >
          <Variable size={14} className="text-primary" />
          Rendre variable
        </button>
      )}

      {editing && (
        <div style={{ display: "flex", flexDirection: "column", gap: 6 }}>
          <label style={{ fontSize: 11 }} className="text-muted-foreground">
            Clé
            <input
              value={keyInput}
              onChange={(e) => setKeyInput(e.target.value)}
              placeholder="client_nom"
              style={{ marginTop: 3, fontFamily: "monospace" }}
              className={inputCls}
            />
          </label>
          <label style={{ fontSize: 11 }} className="text-muted-foreground">
            Libellé
            <input
              value={labelInput}
              onChange={(e) => setLabelInput(e.target.value)}
              placeholder="Nom du client"
              style={{ marginTop: 3 }}
              className={inputCls}
            />
          </label>
          {error && (
            <p style={{ fontSize: 11 }} className="text-destructive">{error}</p>
          )}
          <div style={{ display: "flex", gap: 6, marginTop: 2 }}>
            <button
              onClick={() => { setEditing(false); setError(""); }}
              style={{ flex: 1, padding: "5px 8px", fontSize: 11 }}
              className="border border-border rounded bg-background text-foreground cursor-pointer"
            >
              Annuler
            </button>
            <button
              onClick={commit}
              style={{ flex: 1, padding: "5px 8px", fontSize: 11, fontWeight: 600 }}
              className="border-0 rounded bg-primary text-primary-foreground cursor-pointer"
            >
              Valider
            </button>
          </div>
        </div>
      )}
    </>
  );
}

// ─── ImagePanel ───────────────────────────────────────────────────────────────

export function ImagePanel() {
  const { fabricCanvas: canvas, spaceId } = useDesignContext();
  const t = useTranslations("designCanvas");
  const [pickerOpen, setPickerOpen] = useState(false);

  const handlePick = useCallback(
    async (items: PickedMedia[]) => {
      if (!canvas) return;
      let inserted = 0;
      for (const item of items) {
        try {
          await insertImageFromUrl(item.url, canvas);
          inserted += 1;
        } catch {
          toast.error(t("insertFailed", { name: item.filename }));
        }
      }
      if (inserted > 0) toast.success(t("inserted", { count: inserted }));
    },
    [canvas, t]
  );

  return (
    <div style={basePanelDimStyle} className={panelCls}>
      <Hint label={canvas ? t("choose") : t("chooseDisabled")} disabled={!canvas} className="w-full">
        <button
          type="button"
          onClick={() => setPickerOpen(true)}
          disabled={!canvas}
          aria-label={t("choose")}
          style={{ gap: 8, padding: "24px 12px", fontSize: 12, textAlign: "center", width: "100%" }}
          className="flex flex-col items-center border-2 border-dashed border-border rounded-lg cursor-pointer text-muted-foreground hover:bg-accent/20 focus-visible:outline-2 focus-visible:outline-ring disabled:cursor-not-allowed disabled:opacity-50"
        >
          <ImageIcon size={32} strokeWidth={1.5} aria-hidden="true" />
          {t("choose")}
        </button>
      </Hint>
      <MediaPicker
        open={pickerOpen}
        onOpenChange={setPickerOpen}
        accept={["image"]}
        mode="multiple"
        max={10}
        spaceId={spaceId ?? null}
        tabs={["library", "upload", "bank"]}
        title={t("pickerTitle")}
        onPick={handlePick}
      />
    </div>
  );
}

// ─── DesignPanel ──────────────────────────────────────────────────────────────

export function DesignPanel() {
  const { activeTool, fabricCanvas: canvas, bgColor, handleBgColorChange: onBgColorChange, leftPanelWidth: width } = useDesignContext();
  const [selectedObject, setSelectedObject] = useState<FabricObject | null>(null);

  // Sync selected object state
  useEffect(() => {
    if (!canvas) return;
    const update = () => setSelectedObject(canvas.getActiveObject() ?? null);
    canvas.on("selection:created", update);
    canvas.on("selection:updated", update);
    canvas.on("selection:cleared", update);
    return () => {
      canvas.off("selection:created", update);
      canvas.off("selection:updated", update);
      canvas.off("selection:cleared", update);
    };
  }, [canvas]);

  // Override width from context — shadows module-level basePanelDimStyle
  const panelDimStyle: React.CSSProperties = { ...basePanelDimStyle, width, minWidth: width };

  const addShape = useCallback(
    async (shapeId: string) => {
      if (!canvas) return;
      const { Rect, Circle, Path, Line } = await import("fabric");
      const z = canvas.getZoom() || 1;
      const centerX = canvas.getWidth() / z / 2;
      const centerY = canvas.getHeight() / z / 2;

      let obj: FabricObject;

      switch (shapeId) {
        case "rect":
          // Default fill is CREATIVE CONTENT — kept as-is
          obj = new Rect({ left: centerX - 50, top: centerY - 40, width: 100, height: 80, fill: "#8b5cf6" });
          break;
        case "circle":
          obj = new Circle({ left: centerX - 50, top: centerY - 50, radius: 50, fill: "#8b5cf6" });
          break;
        case "triangle":
          obj = new Path("M 0 80 L 80 80 L 40 0 Z", {
            left: centerX - 40,
            top: centerY - 40,
            fill: "#8b5cf6",
          });
          break;
        case "star":
          obj = new Path(
            "M 40 0 L 50 30 L 80 30 L 57 48 L 66 78 L 40 60 L 14 78 L 23 48 L 0 30 L 30 30 Z",
            { left: centerX - 40, top: centerY - 40, fill: "#8b5cf6", scaleX: 0.8, scaleY: 0.8 }
          );
          break;
        case "diamond":
          obj = new Path("M 50 0 L 100 50 L 50 100 L 0 50 Z", {
            left: centerX - 50,
            top: centerY - 50,
            fill: "#8b5cf6",
          });
          break;
        case "hexagon":
          obj = new Path("M 50 0 L 100 25 L 100 75 L 50 100 L 0 75 L 0 25 Z", {
            left: centerX - 50,
            top: centerY - 50,
            fill: "#8b5cf6",
          });
          break;
        case "arrow":
          obj = new Path("M 0 35 L 60 35 L 60 10 L 100 50 L 60 90 L 60 65 L 0 65 Z", {
            left: centerX - 50,
            top: centerY - 50,
            fill: "#8b5cf6",
            scaleX: 0.8,
            scaleY: 0.8,
          });
          break;
        case "bubble":
          obj = new Path("M 10 0 Q 0 0 0 10 L 0 60 Q 0 70 10 70 L 20 70 L 30 85 L 40 70 L 90 70 Q 100 70 100 60 L 100 10 Q 100 0 90 0 Z", {
            left: centerX - 50,
            top: centerY - 50,
            fill: "#8b5cf6",
            scaleX: 0.8,
            scaleY: 0.8,
          });
          break;
        case "pentagon":
          obj = new Path("M 50 0 L 100 38 L 81 100 L 19 100 L 0 38 Z", {
            left: centerX - 50,
            top: centerY - 50,
            fill: "#8b5cf6",
          });
          break;
        case "line":
          obj = new Line([0, 0, 120, 0], {
            left: centerX - 60,
            top: centerY,
            stroke: "#8b5cf6",
            strokeWidth: 3,
          });
          break;
        case "dashed-line":
          obj = new Line([0, 0, 120, 0], {
            left: centerX - 60,
            top: centerY,
            stroke: "#8b5cf6",
            strokeWidth: 3,
            strokeDashArray: [8, 5],
          });
          break;
        case "arrow-line":
          obj = new Path("M 0 0 L 110 0 M 90 -10 L 120 0 L 90 10", {
            left: centerX - 60,
            top: centerY,
            stroke: "#8b5cf6",
            strokeWidth: 3,
            fill: "transparent",
          });
          break;
        default:
          return;
      }

      canvas.add(obj);
      canvas.setActiveObject(obj);
      canvas.renderAll();
      // setActiveObject programmatique ne déclenche pas selection:created (Fabric v7) :
      // on le fire manuellement pour que la barre contextuelle (fond/contour/position)
      // et le panneau latéral reflètent immédiatement la forme créée.
      setSelectedObject(obj);
      canvas.fire("selection:created", { selected: [obj] } as never);
    },
    [canvas]
  );

  const addPreset = useCallback(
    async (preset: TextPreset) => {
      if (!canvas) return;
      const { IText } = await import("fabric");
      await document.fonts.ready;
      const obj = new IText(preset.label, {
        left: canvas.getWidth() / (canvas.getZoom() || 1) / 2 - preset.fontSize * 2.5,
        top: canvas.getHeight() / (canvas.getZoom() || 1) / 2 - preset.fontSize / 2,
        fontSize: preset.fontSize,
        fontWeight: preset.fontWeight,
        fontStyle: preset.fontStyle as "normal" | "italic" | "oblique",
        fontFamily: preset.fontFamily,
        // Default text fill is CREATIVE CONTENT — kept as-is
        fill: "#222222",
      });
      canvas.add(obj);
      canvas.setActiveObject(obj);
      canvas.renderAll();
      // Idem : synchroniser état + barre contextuelle pour le texte fraîchement ajouté.
      setSelectedObject(obj);
      canvas.fire("selection:created", { selected: [obj] } as never);
    },
    [canvas]
  );

  // ─── Panel: Formes ────────────────────────────────────────────────────────
  if (activeTool === "shapes") {
    return (
      <div style={panelDimStyle} className={panelCls}>
        <p style={sectionTitleDimStyle} className={sectionTitleCls}>Lignes</p>
        <div style={{ display: "grid", gridTemplateColumns: "repeat(3, 1fr)", gap: 6 }}>
          {LINE_SHAPES.map((s) => (
            <ShapeButton key={s.id} label={s.label} onClick={() => addShape(s.id)}>
              {s.preview}
            </ShapeButton>
          ))}
        </div>
        <p style={sectionTitleDimStyle} className={sectionTitleCls}>Formes de base</p>
        <div style={{ display: "grid", gridTemplateColumns: "repeat(3, 1fr)", gap: 6 }}>
          {SVG_SHAPES.slice(0, 4).map((s) => (
            <ShapeButton key={s.id} label={s.label} onClick={() => addShape(s.id)}>
              {s.preview}
            </ShapeButton>
          ))}
        </div>
        <p style={sectionTitleDimStyle} className={sectionTitleCls}>Formes avancées</p>
        <div style={{ display: "grid", gridTemplateColumns: "repeat(3, 1fr)", gap: 6 }}>
          {SVG_SHAPES.slice(4).map((s) => (
            <ShapeButton key={s.id} label={s.label} onClick={() => addShape(s.id)}>
              {s.preview}
            </ShapeButton>
          ))}
        </div>
      </div>
    );
  }

  // ─── Panel: Texte ────────────────────────────────────────────────────────
  if (activeTool === "text") {
    const textObj =
      selectedObject?.type === "i-text" || selectedObject?.type === "text"
        ? (selectedObject as FabricIText)
        : null;

    return (
      <div style={panelDimStyle} className={panelCls}>
        {/* ── Préréglages ── */}
        <p style={sectionTitleDimStyle} className={sectionTitleCls}>Préréglages</p>
        <div style={{ display: "flex", flexDirection: "column", gap: 4 }}>
          {TEXT_PRESETS.map((preset) => (
            <button
              key={preset.label}
              onClick={() => addPreset(preset)}
              style={{
                width: "100%",
                padding: "8px 12px",
                borderRadius: 6,
                cursor: "pointer",
                fontSize: preset.fontSize > 30 ? 18 : preset.fontSize > 18 ? 14 : 12,
                fontWeight: preset.fontWeight as React.CSSProperties["fontWeight"],
                fontStyle: preset.fontStyle as React.CSSProperties["fontStyle"],
                fontFamily: preset.fontFamily,
                textAlign: "left",
              }}
              className="border border-border bg-background text-foreground"
            >
              {preset.label}
            </button>
          ))}
        </div>

        {textObj && (
          <>
            <div style={{ height: 1, margin: "8px 0" }} className="bg-border" />

            {/* Police & taille */}
            <p style={sectionTitleDimStyle} className={sectionTitleCls}>Police &amp; taille</p>
            <CustomFontPanel textObj={textObj} />

            {/* Style */}
            <p style={{ ...sectionTitleDimStyle, marginTop: 10 }} className={sectionTitleCls}>Style</p>
            <div style={{ display: "flex", gap: 4, flexWrap: "wrap" }}>
              <StyleButton
                active={textObj.fontWeight === "bold"}
                onClick={() => {
                  textObj.set("fontWeight", textObj.fontWeight === "bold" ? "normal" : "bold");
                  canvas?.renderAll();
                }}
                label="G"
                title="Gras"
                style={{ fontWeight: "bold" }}
              />
              <StyleButton
                active={textObj.fontStyle === "italic"}
                onClick={() => {
                  textObj.set("fontStyle", textObj.fontStyle === "italic" ? "normal" : "italic");
                  canvas?.renderAll();
                }}
                label="I"
                title="Italique"
                style={{ fontStyle: "italic" }}
              />
              <StyleButton
                active={!!textObj.underline}
                onClick={() => {
                  textObj.set("underline", !textObj.underline);
                  canvas?.renderAll();
                }}
                label="U"
                title="Souligné"
                style={{ textDecoration: "underline" }}
              />
              <StyleButton
                active={!!textObj.linethrough}
                onClick={() => {
                  textObj.set("linethrough", !textObj.linethrough);
                  canvas?.renderAll();
                }}
                label="S"
                title="Barré"
                style={{ textDecoration: "line-through" }}
              />
            </div>
            <div style={{ display: "flex", gap: 4, marginTop: 6 }}>
              {(["left", "center", "right"] as const).map((align) => (
                <button
                  key={align}
                  onClick={() => { textObj.set("textAlign", align); canvas?.renderAll(); }}
                  title={align}
                  style={{ flex: 1, padding: "5px" }}
                  className={cn(
                    "border rounded cursor-pointer flex justify-center",
                    textObj.textAlign === align
                      ? "bg-accent text-accent-foreground border-ring"
                      : "bg-background text-muted-foreground border-border"
                  )}
                >
                  {align === "left" ? <AlignLeft size={14} /> : align === "center" ? <AlignCenter size={14} /> : <AlignRight size={14} />}
                </button>
              ))}
            </div>

            {/* Espacement */}
            <p style={{ ...sectionTitleDimStyle, marginTop: 10 }} className={sectionTitleCls}>Espacement</p>
            <label style={{ fontSize: 11 }} className="text-muted-foreground">
              Interlettrage : {textObj.charSpacing ?? 0}
              <input
                type="range"
                min={-50}
                max={200}
                value={textObj.charSpacing ?? 0}
                onChange={(e) => {
                  textObj.set("charSpacing", parseInt(e.target.value));
                  canvas?.renderAll();
                }}
                style={{ display: "block", width: "100%", marginTop: 4, accentColor: "var(--primary)" }}
              />
            </label>
            <label style={{ fontSize: 11, marginTop: 8 }} className="text-muted-foreground">
              Interligne : {Number(textObj.lineHeight ?? 1.16).toFixed(1)}
              <input
                type="range"
                min={50}
                max={300}
                value={Math.round(Number(textObj.lineHeight ?? 1.16) * 100)}
                onChange={(e) => {
                  textObj.set("lineHeight", parseInt(e.target.value) / 100);
                  canvas?.renderAll();
                }}
                style={{ display: "block", width: "100%", marginTop: 4, accentColor: "var(--primary)" }}
              />
            </label>

            {/* Ombre */}
            <p style={{ ...sectionTitleDimStyle, marginTop: 10 }} className={sectionTitleCls}>Ombre</p>
            <TextShadowControls textObj={textObj} />

            {/* Couleur — CREATIVE CONTENT color picker */}
            <p style={{ ...sectionTitleDimStyle, marginTop: 10 }} className={sectionTitleCls}>Couleur</p>
            <input
              type="color"
              value={typeof textObj.fill === "string" ? textObj.fill : "#000000"}
              onChange={(e) => {
                textObj.set("fill", e.target.value);
                canvas?.renderAll();
              }}
              style={{
                display: "block",
                marginTop: 3,
                width: "100%",
                height: 28,
                borderRadius: 4,
                cursor: "pointer",
                background: "none",
              }}
              className="border border-border"
            />

            {/* Variable de données (data-binding des templates de design) */}
            <div style={{ height: 1, margin: "10px 0 0" }} className="bg-border" />
            <VariableControls textObj={textObj} />
          </>
        )}
      </div>
    );
  }

  // ─── Panel: Image — 3 onglets (Téléverser / Bibliothèque / Unsplash) ───
  if (activeTool === "image") {
    return <ImagePanel />;
  }

  // ─── Panel: Marque ───────────────────────────────────────────────────────
  if (activeTool === "brand") {
    return (
      <div style={panelDimStyle} className={panelCls}>
        <DesignBrandPanel canvas={canvas} onBgColorChange={onBgColorChange} />
      </div>
    );
  }

  // ─── Panel: Dessin ───────────────────────────────────────────────────────
  if (activeTool === "draw") {
    return (
      <div style={panelDimStyle} className={panelCls}>
        <p style={sectionTitleDimStyle} className={sectionTitleCls}>Pinceau libre</p>
        <label style={{ fontSize: 11 }} className="text-muted-foreground">
          Épaisseur
          <input
            type="range"
            min={1}
            max={30}
            defaultValue={4}
            onChange={(e) => {
              if (canvas?.freeDrawingBrush) {
                canvas.freeDrawingBrush.width = parseInt(e.target.value);
              }
            }}
            style={{ display: "block", width: "100%", marginTop: 4, accentColor: "var(--primary)" }}
          />
        </label>
        <label style={{ fontSize: 11, marginTop: 8 }} className="text-muted-foreground">
          Couleur
          {/* Drawing brush defaultValue is CREATIVE CONTENT — kept as-is */}
          <input
            type="color"
            defaultValue="#222222"
            onChange={(e) => {
              if (canvas?.freeDrawingBrush) {
                (canvas.freeDrawingBrush as PencilBrush).color = e.target.value;
              }
            }}
            style={{ display: "block", marginTop: 3, width: "100%", height: 28, borderRadius: 4, cursor: "pointer" }}
            className="border border-border"
          />
        </label>
        <p style={{ fontSize: 11, marginTop: 8 }} className={sectionTitleCls}>
          Le mode dessin est actif. Cliquer et glisser sur le canvas pour tracer.
        </p>
      </div>
    );
  }

  // ─── Panel: Fond ────────────────────────────────────────────────────────
  if (activeTool === "background") {
    // presetColors are CREATIVE CONTENT (artboard background color palette) — kept as-is
    const presetColors = [
      "#ffffff", "#f8f8f8", "#f0f0f0", "#e8e8e8",
      "#fef3c7", "#fee2e2", "#dbeafe", "#dcfce7",
      "#1e1b4b", "#0f172a", "#111827", "#18181b",
      "#7c3aed", "#2563eb", "#dc2626", "#16a34a",
    ];
    return (
      <div style={panelDimStyle} className={panelCls}>
        <p style={sectionTitleDimStyle} className={sectionTitleCls}>Couleur de fond de page</p>
        {/* bgColor picker — CREATIVE CONTENT */}
        <input
          type="color"
          value={bgColor}
          onChange={(e) => onBgColorChange(e.target.value)}
          style={{ width: "100%", height: 36, borderRadius: 6, cursor: "pointer", background: "none", marginBottom: 8 }}
          className="border border-border"
        />
        <p style={sectionTitleDimStyle} className={sectionTitleCls}>Couleurs préréglées</p>
        <div style={{ display: "grid", gridTemplateColumns: "repeat(4, 1fr)", gap: 6 }}>
          {presetColors.map((c) => (
            <button
              key={c}
              onClick={() => onBgColorChange(c)}
              /* background: c is CREATIVE CONTENT (preset artboard color) */
              style={{ width: "100%", aspectRatio: "1", background: c, borderRadius: 4, cursor: "pointer" }}
              className={cn(
                "border",
                c === bgColor ? "border-2 border-primary" : "border border-border"
              )}
              title={c}
            />
          ))}
        </div>
      </div>
    );
  }

  // ─── Panel: Calques ──────────────────────────────────────────────────────
  if (activeTool === "layers") {
    const objects = canvas?.getObjects() ?? [];
    return (
      <div style={panelDimStyle} className={panelCls}>
        <p style={sectionTitleDimStyle} className={sectionTitleCls}>Calques ({objects.length})</p>
        {objects.length === 0 && (
          <p style={{ fontSize: 11 }} className={sectionTitleCls}>Aucun élément sur le canvas.</p>
        )}
        <div style={{ display: "flex", flexDirection: "column", gap: 4 }}>
          {[...objects].reverse().map((obj: FabricObject, idx) => {
            const isActive = canvas?.getActiveObject() === obj;
            const varKey = (obj as FabricObject & { variableKey?: string }).variableKey;
            const label = (obj as FabricObject & { name?: string }).name || obj.type || `Objet ${objects.length - idx}`;
            return (
              <button
                key={idx}
                onClick={() => {
                  canvas?.setActiveObject(obj);
                  canvas?.renderAll();
                }}
                onDoubleClick={(e) => e.stopPropagation()}
                style={{ gap: 8, padding: "6px 8px", fontSize: 11, textAlign: "left" }}
                className={cn(
                  "flex items-center border rounded-[5px] cursor-pointer",
                  isActive
                    ? "bg-accent/30 text-foreground border-ring"
                    : "bg-background text-foreground border-border"
                )}
              >
                <Layers size={12} />
                <span style={{ flex: 1, overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>{label}</span>
                {varKey && (
                  <span
                    title={`Variable : ${varKey}`}
                    style={{ display: "inline-flex", alignItems: "center", gap: 3, padding: "1px 5px", borderRadius: 4, fontSize: 9, fontFamily: "monospace", maxWidth: 90, overflow: "hidden" }}
                    className="bg-primary/15 text-primary"
                  >
                    <Variable size={9} />
                    <span style={{ overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>{varKey}</span>
                  </span>
                )}
              </button>
            );
          })}
        </div>
      </div>
    );
  }

  // ─── Panel: Select (propriétés objet) ───────────────────────────────────
  if (activeTool === "select") {
    return <SelectPropertiesPanel obj={selectedObject} />;
  }

  // ─── Panel: Templates ────────────────────────────────────────────────────
  if (activeTool === "templates") {
    return <DesignTemplatesPanel />;
  }

  return null;
}

// ─── SelectPropertiesPanel ────────────────────────────────────────────────────

export function SelectPropertiesPanel({ obj }: { obj: FabricObject | null }) {
  const { fabricCanvas: canvas, leftPanelWidth: width } = useDesignContext();
  // fillColor / strokeColor are CREATIVE CONTENT defaults — kept as-is
  const [fillColor, setFillColor] = useState<string>("#8b5cf6");
  const [strokeColor, setStrokeColor] = useState<string>("#000000");
  const [strokeWidth, setStrokeWidth] = useState<number>(0);
  const [opacity, setOpacity] = useState<number>(100);

  // Re-sync local state quand l'objet sélectionné change
  useEffect(() => {
    if (!obj) return;
    // These defaults (#8b5cf6, #000000) are CREATIVE CONTENT fallbacks — keep as-is
    setFillColor(typeof obj.fill === "string" && obj.fill !== "transparent" ? obj.fill : "#8b5cf6");
    setStrokeColor(typeof obj.stroke === "string" && obj.stroke ? obj.stroke : "#000000");
    setStrokeWidth(obj.strokeWidth ?? 0);
    setOpacity(Math.round((obj.opacity ?? 1) * 100));
  }, [obj]);

  const selectPanelDimStyle: React.CSSProperties = { ...basePanelDimStyle, width, minWidth: width };

  const selectInputCls = cn(inputCls, "mt-0.5");

  const actionBtnCls =
    "flex-1 flex items-center gap-1 px-2 py-1 bg-background text-foreground border border-border rounded cursor-pointer text-[11px]";

  if (!obj) {
    return (
      <div style={selectPanelDimStyle} className={panelCls}>
        <p style={{ ...sectionTitleDimStyle, marginTop: 8 }} className={sectionTitleCls}>Propriétés</p>
        <p style={{ fontSize: 11 }} className={sectionTitleCls}>Sélectionner un élément sur le canvas.</p>
      </div>
    );
  }

  return (
    <div style={selectPanelDimStyle} className={panelCls}>
      <p style={sectionTitleDimStyle} className={sectionTitleCls}>Propriétés</p>

      {/* Remplissage — CREATIVE CONTENT color picker */}
      <label style={{ fontSize: 11 }} className="text-muted-foreground">
        Remplissage
        <input
          type="color"
          value={fillColor}
          onChange={(e) => {
            setFillColor(e.target.value);
            obj.set("fill", e.target.value);
            canvas?.renderAll();
          }}
          style={{ display: "block", marginTop: 3, width: "100%", height: 28, borderRadius: 4, cursor: "pointer" }}
          className="border border-border"
        />
      </label>

      {/* Couleur bordure — CREATIVE CONTENT color picker */}
      <label style={{ fontSize: 11, marginTop: 6, display: "block" }} className="text-muted-foreground">
        Bordure
        <input
          type="color"
          value={strokeColor}
          onChange={(e) => {
            setStrokeColor(e.target.value);
            obj.set("stroke", e.target.value);
            canvas?.renderAll();
          }}
          style={{ display: "block", marginTop: 3, width: "100%", height: 28, borderRadius: 4, cursor: "pointer" }}
          className="border border-border"
        />
      </label>

      {/* Épaisseur bordure */}
      <label style={{ fontSize: 11, marginTop: 6, display: "block" }} className="text-muted-foreground">
        Épaisseur bordure
        <input
          type="text"
          inputMode="numeric"
          pattern="[0-9]*"
          value={strokeWidth}
          onChange={(e) => {
            const v = Math.max(0, parseInt(e.target.value.replace(/\D/g, "")) || 0);
            setStrokeWidth(v);
            obj.set("strokeWidth", v);
            canvas?.renderAll();
          }}
          style={{ marginTop: 3 }}
          className={selectInputCls}
        />
      </label>

      {/* Opacité */}
      <label style={{ fontSize: 11, marginTop: 6, display: "block" }} className="text-muted-foreground">
        Opacité : {opacity}%
        <input
          type="range"
          min={0}
          max={100}
          value={opacity}
          onChange={(e) => {
            const v = parseInt(e.target.value);
            setOpacity(v);
            obj.set("opacity", v / 100);
            canvas?.renderAll();
          }}
          style={{ display: "block", width: "100%", marginTop: 4, accentColor: "var(--primary)" }}
        />
      </label>

      {/* Avancer / Reculer */}
      <div style={{ display: "flex", gap: 6, marginTop: 10 }}>
        <button
          onClick={() => { canvas?.bringObjectForward(obj); canvas?.renderAll(); }}
          title="Avancer"
          className={actionBtnCls}
        >
          <ArrowUp size={13} /> Avancer
        </button>
        <button
          onClick={() => { canvas?.sendObjectBackwards(obj); canvas?.renderAll(); }}
          title="Reculer"
          className={actionBtnCls}
        >
          <ArrowDown size={13} /> Reculer
        </button>
      </div>

      {/* Supprimer */}
      <button
        onClick={() => {
          canvas?.remove(obj);
          canvas?.discardActiveObject();
          canvas?.renderAll();
        }}
        style={{ marginTop: 6, padding: "5px 10px", width: "auto", fontSize: 11 }}
        className="flex items-center gap-1 bg-destructive/20 text-destructive border border-destructive/50 rounded cursor-pointer"
      >
        <Trash2 size={13} /> Supprimer
      </button>
    </div>
  );
}

// ─── DesignTemplatesPanel ─────────────────────────────────────────────────────

interface DesignTemplateEntry {
  id?: string;
  name: string;
  description?: string;
  content: unknown;
  icon?: string;
}

export function DesignTemplatesPanel() {
  const { fabricCanvas: canvas, spaceId: _spaceId, triggerSave } = useDesignContext();
  const [templates, setTemplates] = useState<DesignTemplateEntry[]>([]);
  const [loading, setLoading] = useState(true);
  const [applied, setApplied] = useState<string | null>(null);

  useEffect(() => {
    fetch("/api/templates?category=design")
      .then((r) => r.json())
      .then((data) => {
        if (Array.isArray(data)) setTemplates((data as DesignTemplateEntry[]).filter((t) => (t as DesignTemplateEntry & { category?: string }).category === "design"));
      })
      .catch(() => {})
      .finally(() => setLoading(false));
  }, []);

  const applyTemplate = async (tmpl: DesignTemplateEntry) => {
    if (!canvas || !tmpl.content) return;
    const doc = tmpl.content as { pages?: { json?: unknown }[] } | null;
    const json = doc?.pages?.[0]?.json ?? doc;
    if (!json) return;
    await canvas.loadFromJSON(json);
    canvas.renderAll();
    triggerSave();
    setApplied(tmpl.name);
    setTimeout(() => setApplied(null), 1500);
  };

  const templatesPanelDimStyle: React.CSSProperties = {
    width: 280,
    minWidth: 180,
    display: "flex",
    flexDirection: "column",
    overflowY: "auto",
    padding: "12px 10px",
    gap: 8,
  };

  return (
    <div style={templatesPanelDimStyle} className={panelCls}>
      <p style={sectionTitleDimStyle} className={sectionTitleCls}>Templates de design</p>
      {loading && (
        <p style={{ fontSize: 11 }} className={sectionTitleCls}>Chargement…</p>
      )}
      {!loading && templates.length === 0 && (
        <p style={{ fontSize: 11 }} className={sectionTitleCls}>
          Aucun template disponible.<br />Enregistrez un design comme template via le menu ···.
        </p>
      )}
      {templates.map((tmpl) => (
        <button
          key={tmpl.id ?? tmpl.name}
          onClick={() => applyTemplate(tmpl)}
          style={{ gap: 8, padding: "8px 10px", fontSize: 12, textAlign: "left" }}
          className="flex items-center w-full border border-border rounded-md bg-background text-foreground cursor-pointer"
        >
          <LayoutTemplate size={14} style={{ flexShrink: 0 }} className="text-primary" />
          <span style={{ flex: 1, overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>
            {tmpl.name}
          </span>
          {applied === tmpl.name && <Check size={13} style={{ flexShrink: 0 }} className="text-emerald-400" />}
        </button>
      ))}
    </div>
  );
}
