"use client";

import { useState, useEffect, useRef, useCallback } from "react";
import type { ExcalidrawElement } from "@excalidraw/excalidraw/element/types";

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

  useEffect(() => {
    // Charger les éléments depuis l'API REST
    fetch(withDoc(canvasId, documentId))
      .then((r) => r.json())
      .then((data) => {
        setInitialElements(Array.isArray(data.elements) ? data.elements : []);
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
        fetch(withDoc(canvasId, documentId), {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ elements: pendingElementsRef.current }),
          keepalive: true,
        }).catch(() => {});
      }
    };
  }, [canvasId, documentId]);

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
        }).catch((err) => {
          if (process.env.NODE_ENV === "development") {
            console.warn("[whiteboard] Erreur sauvegarde:", err);
          }
        });
      }, SAVE_DEBOUNCE_MS);
    },
    [canvasId, documentId]
  );

  return { initialElements, onExcalidrawChange, isSynced };
}
