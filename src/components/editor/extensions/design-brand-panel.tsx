// src/components/editor/extensions/design-brand-panel.tsx
// Panneau « Marque » du Studio : applique le Brand Kit de l'organisation.
"use client";

import { useEffect, useState } from "react";
import type { Canvas as FabricCanvas, IText as FabricIText } from "fabric";
import type { BrandKitData } from "@/lib/studio/brand-kit-schema";

async function insertLogo(url: string, canvas: FabricCanvas) {
  const { FabricImage } = await import("fabric");
  // Logos are served from /api/media/... (same origin) — no proxy needed.
  // Use resolveImageUrl-compatible logic: pass through same-origin URLs as-is.
  const safeUrl = url.startsWith("/") ? url : url;
  const img = await FabricImage.fromURL(safeUrl, { crossOrigin: "anonymous" });
  const maxW = canvas.getWidth() * 0.6;
  if ((img.width ?? 0) > maxW) img.scaleToWidth(maxW);
  img.set({ left: 50, top: 50 });
  canvas.add(img);
  canvas.setActiveObject(img);
  canvas.renderAll();
  // object:added fires automatically → pushHistory + debouncedSave
}

const sectionTitle: React.CSSProperties = {
  fontSize: 10,
  color: "#666688",
  textTransform: "uppercase",
  letterSpacing: "0.08em",
  fontWeight: 700,
  margin: "14px 0 8px",
};

export function DesignBrandPanel({
  canvas,
  onBgColorChange,
}: {
  canvas: FabricCanvas | null;
  onBgColorChange: (color: string) => void;
}) {
  const [kit, setKit] = useState<BrandKitData | null>(null);
  const [loadError, setLoadError] = useState(false);

  useEffect(() => {
    fetch("/api/studio/brand-kit")
      .then((r) => (r.ok ? r.json() : Promise.reject()))
      .then(setKit)
      .catch(() => setLoadError(true));
  }, []);

  const applyColor = (color: string) => {
    if (!canvas) return;
    const active = canvas.getActiveObject();
    if (active) {
      active.set("fill", color);
      canvas.renderAll();
      // Mirrors fill-change pattern from existing properties panel (no explicit fire)
    } else {
      onBgColorChange(color);
    }
  };

  const applyFont = (font: string) => {
    if (!canvas) return;
    const active = canvas.getActiveObject() as FabricIText | null;
    if (
      active &&
      (active.type === "i-text" || active.type === "text" || active.type === "textbox")
    ) {
      active.set("fontFamily", font);
      canvas.renderAll();
    }
  };

  if (loadError)
    return <p style={{ fontSize: 12, color: "#888" }}>Brand kit indisponible.</p>;
  if (!kit)
    return <p style={{ fontSize: 12, color: "#888" }}>Chargement…</p>;

  const empty =
    kit.colors.length === 0 &&
    kit.logos.length === 0 &&
    !kit.fontHeading &&
    !kit.fontBody;

  return (
    <>
      <div style={{ fontSize: 13, fontWeight: 600, color: "#e0e0f0" }}>Marque</div>
      {empty ? (
        <p style={{ fontSize: 11, color: "#888", marginTop: 10, lineHeight: 1.5 }}>
          Aucun élément de marque défini. Un administrateur peut les configurer dans
          Organisation → Identité de marque.
        </p>
      ) : (
        <>
          {kit.colors.length > 0 && (
            <>
              <div style={sectionTitle}>Couleurs</div>
              <div style={{ display: "flex", flexWrap: "wrap", gap: 6 }}>
                {kit.colors.map((c, i) => (
                  <button
                    key={`${c}-${i}`}
                    onClick={() => applyColor(c)}
                    title={`${c} — applique à la sélection, ou au fond si rien n'est sélectionné`}
                    style={{
                      width: 28,
                      height: 28,
                      borderRadius: 5,
                      border: "1px solid #333",
                      background: c,
                      cursor: "pointer",
                    }}
                  />
                ))}
              </div>
            </>
          )}
          {kit.logos.length > 0 && (
            <>
              <div style={sectionTitle}>Logos</div>
              <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 6 }}>
                {kit.logos.map((logo, i) => (
                  <button
                    key={`${logo.url}-${i}`}
                    onClick={() => {
                      if (canvas) void insertLogo(logo.url, canvas);
                    }}
                    title={`Insérer « ${logo.name} »`}
                    style={{
                      background: "#252535",
                      border: "1px solid #333",
                      borderRadius: 6,
                      padding: 6,
                      cursor: "pointer",
                    }}
                  >
                    {/* eslint-disable-next-line @next/next/no-img-element */}
                    <img
                      src={logo.url}
                      alt={logo.name}
                      style={{ width: "100%", height: 48, objectFit: "contain" }}
                    />
                  </button>
                ))}
              </div>
            </>
          )}
          {(kit.fontHeading || kit.fontBody) && (
            <>
              <div style={sectionTitle}>Polices</div>
              {kit.fontHeading && (
                <button
                  onClick={() => applyFont(kit.fontHeading!)}
                  title="Appliquer au texte sélectionné"
                  style={{
                    display: "block",
                    width: "100%",
                    textAlign: "left",
                    background: "#252535",
                    border: "1px solid #333",
                    borderRadius: 6,
                    padding: "8px 10px",
                    marginBottom: 6,
                    cursor: "pointer",
                    color: "#e0e0f0",
                    fontSize: 16,
                    fontFamily: kit.fontHeading,
                  }}
                >
                  {kit.fontHeading}{" "}
                  <span style={{ fontSize: 10, color: "#888", fontFamily: "inherit" }}>
                    · titres
                  </span>
                </button>
              )}
              {kit.fontBody && (
                <button
                  onClick={() => applyFont(kit.fontBody!)}
                  title="Appliquer au texte sélectionné"
                  style={{
                    display: "block",
                    width: "100%",
                    textAlign: "left",
                    background: "#252535",
                    border: "1px solid #333",
                    borderRadius: 6,
                    padding: "8px 10px",
                    cursor: "pointer",
                    color: "#e0e0f0",
                    fontSize: 13,
                    fontFamily: kit.fontBody,
                  }}
                >
                  {kit.fontBody}{" "}
                  <span style={{ fontSize: 10, color: "#888" }}>· corps</span>
                </button>
              )}
            </>
          )}
        </>
      )}
    </>
  );
}
