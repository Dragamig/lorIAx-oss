"use client";

import dynamic from "next/dynamic";
import { useEffect, useRef, useCallback } from "react";
import { X, PenLine } from "lucide-react";
import { useWhiteboardSync } from "@/hooks/use-whiteboard-sync";
import { useWhiteboardLibrary } from "@/hooks/use-whiteboard-library";
import { useTheme } from "@/contexts/theme-context";
import { WhiteboardLibraryButton } from "./whiteboard-library";
import { uploadDesignThumbnail } from "./design-thumbnail";
import "@excalidraw/excalidraw/index.css";

// Excalidraw ne supporte pas le SSR — chargement côté client uniquement
const Excalidraw = dynamic(
  () => import("@excalidraw/excalidraw").then((m) => m.Excalidraw),
  { ssr: false }
);

interface WhiteboardModalProps {
  canvasId: string;
  /** Document porteur — requis à la création du canevas côté serveur. */
  documentId?: string;
  title: string;
  onClose: (thumbnailUrl?: string) => void;
}

function readSpaceId(): string | null {
  if (typeof window === "undefined") return null;
  return (window as typeof window & { __loriax_spaceId?: string }).__loriax_spaceId ?? null;
}

export function WhiteboardModal({ canvasId, documentId, title, onClose }: WhiteboardModalProps) {
  const { initialElements, onExcalidrawChange, isSynced } = useWhiteboardSync(canvasId, documentId);
  const { libraryItems, onLibraryChange, isLoaded } = useWhiteboardLibrary();
  const { darkMode: isDark } = useTheme();

  // Bloquer le scroll de la page
  useEffect(() => {
    document.body.style.overflow = "hidden";
    return () => {
      document.body.style.overflow = "";
    };
  }, []);

  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const excalidrawAPIRef = useRef<any>(null);

  const handleClose = useCallback(async () => {
    const api = excalidrawAPIRef.current;
    if (!api) { onClose(); return; }

    try {
      const { exportToBlob } = await import("@excalidraw/excalidraw");
      const elements = api.getSceneElements();
      const appState = api.getAppState();
      const files = api.getFiles();
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      const firstFrame = elements.find((el: any) => el.type === "frame") ?? null;

      const blob = await exportToBlob({
        elements,
        appState,
        files,
        exportingFrame: firstFrame,
        mimeType: "image/png",
      });

      const dataUrl = await new Promise<string>((resolve) => {
        const reader = new FileReader();
        reader.onloadend = () => {
          const result = reader.result;
          if (typeof result !== 'string') {
            onClose();
            return;
          }
          resolve(result);
        };
        reader.readAsDataURL(blob);
      });

      // Miniature enregistrée comme média (`/api/media/<id>`) ; le data URL reste le repli si l'envoi échoue.
      const stored = await uploadDesignThumbnail(dataUrl, readSpaceId());
      onClose(stored ?? dataUrl);
    } catch {
      onClose();
    }
  }, [onClose]);

  // Fermer avec Échap
  useEffect(() => {
    const handler = (e: KeyboardEvent) => {
      if (e.key === "Escape") handleClose();
    };
    window.addEventListener("keydown", handler);
    return () => window.removeEventListener("keydown", handler);
  }, [handleClose]);

  const libraryReturnUrl =
    typeof window !== "undefined" ? window.location.href : "";

  const getApi = useCallback(() => excalidrawAPIRef.current, []);
  const spaceId = readSpaceId();

  const isReady = isSynced && isLoaded && initialElements !== null;

  return (
    <div className="fixed inset-0 z-50 flex flex-col bg-background" role="dialog" aria-modal="true" aria-label={title || "Tableau blanc"}>
      {/* Barre titre */}
      <div className="h-10 flex items-center justify-between px-4 border-b border-border bg-card shrink-0">
        <div className="flex items-center gap-2">
          <PenLine className="h-3.5 w-3.5 text-blue-400 shrink-0" />
          <span className="text-xs font-semibold text-blue-400">Tableau blanc</span>
          <span className="text-xs text-muted-foreground">—</span>
          <span className="text-sm text-foreground truncate">{title || "Tableau blanc"}</span>
        </div>
        <div className="flex items-center gap-1">
        <WhiteboardLibraryButton getApi={getApi} spaceId={spaceId} disabled={!isReady} />
        <button
          onClick={handleClose}
          className="p-1.5 rounded hover:bg-muted text-muted-foreground hover:text-foreground transition-colors"
          title="Fermer (Échap)"
          aria-label="Fermer le tableau blanc"
        >
          <X className="h-4 w-4" />
        </button>
        </div>
      </div>

      {/* Canvas Excalidraw */}
      <div style={{ flex: 1, minHeight: 0, position: "relative" }}>
        {!isReady ? (
          <div className="flex items-center justify-center h-full text-muted-foreground text-sm gap-2">
            <div className="h-4 w-4 animate-spin rounded-full border-2 border-current border-t-transparent" />
            Chargement du tableau blanc...
          </div>
        ) : (
          <Excalidraw
            // eslint-disable-next-line @typescript-eslint/no-explicit-any
            excalidrawAPI={(api: any) => { excalidrawAPIRef.current = api; }}
            // eslint-disable-next-line @typescript-eslint/no-explicit-any
            initialData={{ elements: initialElements, libraryItems: libraryItems as any }}
            onChange={(elements) => onExcalidrawChange(elements)}
            // eslint-disable-next-line @typescript-eslint/no-explicit-any
            onLibraryChange={(items: any) => onLibraryChange(items)}
            theme={isDark ? "dark" : "light"}
            libraryReturnUrl={libraryReturnUrl}
            UIOptions={{ tools: { image: false } }}
          />
        )}
      </div>
    </div>
  );
}
