"use client";

import { useRef, type KeyboardEvent, type PointerEvent } from "react";
import { useTranslations } from "next-intl";
import {
  CROP_HANDLES,
  cropPixels,
  isArrowKey,
  moveCropByKey,
  resizeCropByEdges,
  resizeCropByKey,
  type Crop,
  type CropHandle,
} from "../crop";
import type { CropDraft } from "./use-crop-draft";

const POS: Record<CropHandle, [number, number]> = {
  nw: [0, 0],
  n: [50, 0],
  ne: [100, 0],
  e: [100, 50],
  se: [100, 100],
  s: [50, 100],
  sw: [0, 100],
  w: [0, 50],
};
const CURSOR: Record<CropHandle, string> = {
  nw: "nwse-resize",
  se: "nwse-resize",
  ne: "nesw-resize",
  sw: "nesw-resize",
  n: "ns-resize",
  s: "ns-resize",
  e: "ew-resize",
  w: "ew-resize",
};

type Drag = { handle: CropHandle | "move"; x: number; y: number; start: Crop; w: number; h: number };

/** Zone de recadrage et ses 8 poignées, à poser sur l'aperçu (parent en position relative). */
export function CropOverlay({ draft }: { draft: CropDraft }) {
  const t = useTranslations("library.retouch");
  const drag = useRef<Drag | null>(null);
  const root = useRef<HTMLDivElement>(null);
  const { pending, ratio, bounds, setPending } = draft;
  const px = cropPixels(pending, bounds);
  const zoneText = t("zoneValue", { w: String(px.width), h: String(px.height) });

  const onPointerDown = (handle: CropHandle | "move") => (e: PointerEvent<HTMLDivElement>) => {
    const r = root.current?.getBoundingClientRect();
    if (!r || r.width === 0 || r.height === 0) return;
    e.stopPropagation();
    e.preventDefault();
    e.currentTarget.setPointerCapture?.(e.pointerId);
    drag.current = { handle, x: e.clientX, y: e.clientY, start: pending, w: r.width, h: r.height };
  };
  const onPointerMove = (e: PointerEvent<HTMLDivElement>) => {
    const d = drag.current;
    if (!d) return;
    const dx = (e.clientX - d.x) / d.w;
    const dy = (e.clientY - d.y) / d.h;
    if (d.handle === "move") setPending({ ...d.start, x: d.start.x + dx, y: d.start.y + dy });
    else setPending(resizeCropByEdges(d.start, d.handle, dx, dy, ratio, bounds));
  };
  const endDrag = () => {
    drag.current = null;
  };

  const onBodyKey = (e: KeyboardEvent<HTMLDivElement>) => {
    if (!isArrowKey(e.key)) return;
    e.preventDefault();
    setPending(moveCropByKey(pending, e.key, e.shiftKey, bounds));
  };
  const onHandleKey = (handle: CropHandle) => (e: KeyboardEvent<HTMLDivElement>) => {
    if (!isArrowKey(e.key)) return;
    e.preventDefault();
    e.stopPropagation();
    setPending(resizeCropByKey(pending, handle, e.key, e.shiftKey, ratio, bounds));
  };

  return (
    <div ref={root} className="pointer-events-none absolute inset-0" data-testid="crop-overlay">
      {/* Voile hors de la zone, limité à l'image (le contour évidé suit la zone). */}
      <div
        aria-hidden="true"
        data-testid="crop-dim"
        className="absolute inset-0 bg-black/50"
        style={{
          clipPath: `polygon(evenodd, 0 0, 100% 0, 100% 100%, 0 100%, 0 0, ${pending.x * 100}% ${pending.y * 100}%, ${pending.x * 100}% ${(pending.y + pending.h) * 100}%, ${(pending.x + pending.w) * 100}% ${(pending.y + pending.h) * 100}%, ${(pending.x + pending.w) * 100}% ${pending.y * 100}%, ${pending.x * 100}% ${pending.y * 100}%)`,
        }}
      />
      <div
        tabIndex={0}
        role="group"
        aria-label={t("zoneLabel")}
        title={`${t("zoneLabel")}. ${t("zoneHint")}`}
        onKeyDown={onBodyKey}
        onPointerDown={onPointerDown("move")}
        onPointerMove={onPointerMove}
        onPointerUp={endDrag}
        onPointerCancel={endDrag}
        className="focus-visible:ring-ring pointer-events-auto absolute cursor-move touch-none border-2 border-white outline-none focus-visible:ring-2"
        style={{
          left: `${pending.x * 100}%`,
          top: `${pending.y * 100}%`,
          width: `${pending.w * 100}%`,
          height: `${pending.h * 100}%`,
        }}
      >
        <span aria-hidden="true" className="pointer-events-none absolute inset-y-0 left-1/3 w-px bg-white/50" />
        <span aria-hidden="true" className="pointer-events-none absolute inset-y-0 left-2/3 w-px bg-white/50" />
        <span aria-hidden="true" className="pointer-events-none absolute inset-x-0 top-1/3 h-px bg-white/50" />
        <span aria-hidden="true" className="pointer-events-none absolute inset-x-0 top-2/3 h-px bg-white/50" />
        {CROP_HANDLES.map((h) => {
          const name = t(`handles.${h}`);
          const vertical = h === "n" || h === "s";
          return (
            <div
              key={h}
              role="slider"
              tabIndex={0}
              aria-label={name}
              aria-orientation={vertical ? "vertical" : "horizontal"}
              aria-valuemin={1}
              aria-valuemax={vertical ? bounds.height : bounds.width}
              aria-valuenow={vertical ? px.height : px.width}
              aria-valuetext={zoneText}
              title={t("handleTip", { name })}
              data-handle={h}
              onKeyDown={onHandleKey(h)}
              onPointerDown={onPointerDown(h)}
              onPointerMove={onPointerMove}
              onPointerUp={endDrag}
              onPointerCancel={endDrag}
              className="focus-visible:ring-ring absolute size-6 -translate-x-1/2 -translate-y-1/2 touch-none outline-none after:absolute after:top-1/2 after:left-1/2 after:size-3 after:-translate-x-1/2 after:-translate-y-1/2 after:rounded-sm after:border after:border-black/40 after:bg-white focus-visible:ring-2"
              style={{ left: `${POS[h][0]}%`, top: `${POS[h][1]}%`, cursor: CURSOR[h] }}
            />
          );
        })}
      </div>
    </div>
  );
}
