"use client";

import { useState, useEffect, useRef, useCallback } from "react";
import type { ExcalidrawElement } from "@excalidraw/excalidraw/element/types";
import { toast } from "sonner";
import { useTranslations } from "next-intl";
import { putExplicitUsages } from "@/lib/media/explicit-usages-client";
import { collectWhiteboardMediaIds } from "@/components/editor/extensions/whiteboard-media-ids";

const SAVE_DEBOUNCE_MS = 3000;

/**
 * `documentId` = document porteur du bloc. Il n'est indispensable qu'à la
 * création (ligne absente en base) : ensuite le serveur s'appuie sur le
 * `document_id` stocké et ignore ce paramètre. Cette tolérance supprime toute
 * contrainte d'ordre entre le déploiement du client et celui du serveur.
 */
function withDoc(canvasId: string, documentId?: string): string {
  const base = `/api/whiteboard/${canvasId}`;
  return documentId ? `${base}?documentId=${encodeURIComponent(documentId)}` : base;
}

export function useWhiteboardSync(canvasId: string, documentId?: string) {
  const [initialElements, setInitialElements] = useState<ExcalidrawElement[] | null>(null);
  const [isSynced, setIsSynced] = useState(false);
  const saveTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const pendingElementsRef = useRef<readonly ExcalidrawElement[] | null>(null);
  const t = useTranslations("whiteboard");
  // Référence stable : l'identité de `t` ne doit pas relancer le chargement de la scène.
  const tRef = useRef(t);
  useEffect(() => {
    tRef.current = t;
  }, [t]);
  // Derniers médias déclarés au serveur : évite les appels inutiles, et fait retirer l'usage d'une image supprimée.
  const syncedMediaRef = useRef<string>("[]");

  /** Usages `explicit` : le serveur ne lit pas la scène. Jamais bloquant ; échec = toast discret. */
  const syncUsages = useCallback(
    async (elements: readonly ExcalidrawElement[]) => {
      const mediaIds = collectWhiteboardMediaIds(elements).sort();
      const key = JSON.stringify(mediaIds);
      if (key === syncedMediaRef.current) return;
      const spaceId =
        (window as typeof window & { __loriax_spaceId?: string }).__loriax_spaceId ?? null;
      const ok = await putExplicitUsages({
        targetType: "whiteboard",
        targetId: canvasId,
        documentId,
        spaceId,
        mediaIds,
      });
      if (ok) syncedMediaRef.current = key;
      else toast.error(tRef.current("usageSyncFailed"));
    },
    [canvasId, documentId]
  );

  useEffect(() => {
    // Charger les éléments depuis l'API REST
    fetch(withDoc(canvasId, documentId))
      .then((r) => r.json())
      .then((data) => {
        const loaded: ExcalidrawElement[] = Array.isArray(data.elements) ? data.elements : [];
        syncedMediaRef.current = JSON.stringify(collectWhiteboardMediaIds(loaded).sort());
        setInitialElements(loaded);
        setIsSynced(true);
      })
      .catch((err) => {
        console.error("[whiteboard] Erreur lors du chargement des données:", err);
        setInitialElements([]);
        setIsSynced(true);
      });

    return () => {
      // Flush immédiat des modifications en attente à la fermeture
      if (saveTimerRef.current) {
        clearTimeout(saveTimerRef.current);
        saveTimerRef.current = null;
      }
      if (pendingElementsRef.current !== null) {
        const pending = pendingElementsRef.current;
        fetch(withDoc(canvasId, documentId), {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ elements: pending }),
          keepalive: true,
        })
          .then((res) => {
            if (res.ok) void syncUsages(pending);
          })
          .catch(() => {});
      }
    };
  }, [canvasId, documentId, syncUsages]);

  const onExcalidrawChange = useCallback(
    (elements: readonly ExcalidrawElement[]) => {
      pendingElementsRef.current = elements;

      if (saveTimerRef.current) clearTimeout(saveTimerRef.current);
      saveTimerRef.current = setTimeout(() => {
        pendingElementsRef.current = null;
        fetch(withDoc(canvasId, documentId), {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ elements }),
        })
          .then((res) => {
            if (res.ok) void syncUsages(elements);
          })
          .catch((err) => {
            if (process.env.NODE_ENV === "development") {
              console.warn("[whiteboard] Erreur sauvegarde:", err);
            }
          });
      }, SAVE_DEBOUNCE_MS);
    },
    [canvasId, documentId, syncUsages]
  );

  return { initialElements, onExcalidrawChange, isSynced };
}
