"use client";

import { useCallback, useState } from "react";
import { Image as ImageIcon } from "lucide-react";
import { toast } from "sonner";
import { useTranslations } from "next-intl";
import { Hint } from "@/components/ui/hint";
import { MediaPicker } from "@/components/media/picker/media-picker";
import type { PickedMedia } from "@/components/media/picker/types";

/** Sous-ensemble de l'API impérative d'Excalidraw utilisé ici. */
export type WhiteboardApi = {
  addFiles: (files: unknown[]) => void;
  updateScene: (scene: { elements: unknown[] }) => void;
  getSceneElements: () => readonly unknown[];
  getAppState: () => { scrollX?: number; scrollY?: number; width?: number; height?: number; zoom?: { value: number } };
};

type Measure = (dataUrl: string) => Promise<{ width: number; height: number }>;

const MAX_SIDE = 400;
const FALLBACK = { width: 300, height: 200 };

function measureImage(dataUrl: string): Promise<{ width: number; height: number }> {
  if (typeof Image === "undefined") return Promise.resolve(FALLBACK);
  return new Promise((resolve) => {
    const img = new Image();
    const timer = setTimeout(() => resolve(FALLBACK), 1500);
    img.onload = () => {
      clearTimeout(timer);
      resolve({ width: img.naturalWidth || FALLBACK.width, height: img.naturalHeight || FALLBACK.height });
    };
    img.onerror = () => {
      clearTimeout(timer);
      resolve(FALLBACK);
    };
    img.src = dataUrl;
  });
}

function readAsDataUrl(blob: Blob): Promise<string> {
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = () => (typeof reader.result === "string" ? resolve(reader.result) : reject(new Error("lecture")));
    reader.onerror = () => reject(reader.error ?? new Error("lecture"));
    reader.readAsDataURL(blob);
  });
}

function randomInt(): number {
  return Math.floor(Math.random() * 2 ** 31);
}

/**
 * Insère des médias de la médiathèque comme éléments `image` d'Excalidraw, centrés sur la vue.
 * L'identifiant du média est gardé dans `customData.mediaId` (lu à la sauvegarde pour les usages).
 * Un échec de téléchargement est listé sans bloquer les autres.
 */
export async function insertLibraryImages(
  api: WhiteboardApi,
  items: PickedMedia[],
  opts: { measure?: Measure } = {},
): Promise<{ inserted: number; failed: string[] }> {
  const measure = opts.measure ?? measureImage;
  const state = api.getAppState();
  const zoom = state.zoom?.value || 1;
  const cx = (state.width ?? 0) / 2 / zoom - (state.scrollX ?? 0);
  const cy = (state.height ?? 0) / 2 / zoom - (state.scrollY ?? 0);

  const files: unknown[] = [];
  const elements: unknown[] = [];
  const failed: string[] = [];
  const now = Date.now();

  for (const [i, item] of items.entries()) {
    try {
      const res = await fetch(item.url);
      if (!res.ok) throw new Error(String(res.status));
      const blob = await res.blob();
      const dataURL = await readAsDataUrl(blob);
      const size = await measure(dataURL);
      const ratio = Math.min(1, MAX_SIDE / Math.max(size.width, size.height));
      const width = Math.round(size.width * ratio);
      const height = Math.round(size.height * ratio);
      const fileId = crypto.randomUUID();
      files.push({ id: fileId, dataURL, mimeType: item.mimeType || blob.type, created: now });
      elements.push({
        type: "image",
        id: crypto.randomUUID(),
        x: cx - width / 2 + i * 24,
        y: cy - height / 2 + i * 24,
        width,
        height,
        angle: 0,
        strokeColor: "transparent",
        backgroundColor: "transparent",
        fillStyle: "solid",
        strokeWidth: 1,
        strokeStyle: "solid",
        roughness: 0,
        opacity: 100,
        groupIds: [],
        frameId: null,
        index: null,
        roundness: null,
        seed: randomInt(),
        version: 1,
        versionNonce: randomInt(),
        isDeleted: false,
        boundElements: null,
        updated: now,
        link: null,
        locked: false,
        fileId,
        status: "saved",
        scale: [1, 1],
        crop: null,
        customData: { mediaId: item.id },
      });
    } catch {
      failed.push(item.filename);
    }
  }

  if (elements.length > 0) {
    api.addFiles(files);
    api.updateScene({ elements: [...api.getSceneElements(), ...elements] });
  }
  return { inserted: elements.length, failed };
}

type Props = {
  getApi: () => WhiteboardApi | null;
  spaceId: string | null;
  disabled?: boolean;
};

/** Bouton de la barre du tableau blanc : ouvre le sélecteur de médiathèque et insère les images choisies. */
export function WhiteboardLibraryButton({ getApi, spaceId, disabled = false }: Props) {
  const t = useTranslations("whiteboard");
  const [open, setOpen] = useState(false);

  const handlePick = useCallback(
    async (items: PickedMedia[]) => {
      const api = getApi();
      if (!api) {
        toast.error(t("insertDisabled"));
        return;
      }
      const { inserted, failed } = await insertLibraryImages(api, items);
      for (const name of failed) toast.error(t("insertFailed", { name }));
      if (inserted > 0) toast.success(t("inserted", { count: inserted }));
    },
    [getApi, t],
  );

  const label = disabled ? t("insertDisabled") : t("insertImage");
  return (
    <>
      <Hint label={label} disabled={disabled}>
        <button
          type="button"
          onClick={() => setOpen(true)}
          disabled={disabled}
          aria-label={label}
          className="p-1.5 rounded hover:bg-muted text-muted-foreground hover:text-foreground transition-colors disabled:opacity-50 disabled:cursor-not-allowed focus-visible:outline-2 focus-visible:outline-ring"
        >
          <ImageIcon className="h-4 w-4" aria-hidden="true" />
        </button>
      </Hint>
      <MediaPicker
        open={open}
        onOpenChange={setOpen}
        accept={["image"]}
        mode="multiple"
        max={10}
        spaceId={spaceId}
        tabs={["library", "upload", "bank"]}
        title={t("pickerTitle")}
        onPick={handlePick}
      />
    </>
  );
}
