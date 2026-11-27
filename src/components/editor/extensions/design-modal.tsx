"use client";

/**
 * design-modal.tsx
 * Wrapper modale plein-écran pour le canvas Fabric.js.
 * Charge DesignCanvas de façon dynamique (ssr: false) car Fabric.js
 * est une bibliothèque browser-only.
 *
 * Responsabilités :
 * - Charger le JSON canvas via GET /api/designs/[designId] au montage
 * - Sauvegarder via PUT /api/designs/[designId] + mettre à jour thumbnailUrl
 * - Gérer le verrou optimiste via useBlockLock
 */

import dynamic from "next/dynamic";
import { createPortal } from "react-dom";
import { useEffect, useState, useCallback, useRef } from "react";
import { Loader2 } from "lucide-react";
import { toast } from "sonner";
import { useTranslations } from "next-intl";
import { collectMediaIds } from "./design-canvas/collect-media-ids";
import { useBlockLock } from "@/hooks/use-block-lock";
import type { DesignDocument } from "./design-canvas";
import { uploadDesignThumbnail } from "./design-thumbnail";

// Import dynamique — pas de SSR, Fabric.js nécessite window/canvas
const DesignCanvas = dynamic(
  () => import("./design-canvas").then((m) => ({ default: m.DesignCanvas })),
  { ssr: false, loading: () => <DesignModalLoading /> }
);

function DesignModalLoading() {
  return (
    <div
      style={{
        position: "fixed",
        inset: 0,
        background: "#1e1e2e",
        display: "flex",
        alignItems: "center",
        justifyContent: "center",
        zIndex: 50,
        flexDirection: "column",
        gap: 12,
        color: "#a78bfa",
        fontFamily: "-apple-system, BlinkMacSystemFont, 'Segoe UI', sans-serif",
        fontSize: 13,
      }}
    >
      <div
        style={{
          width: 32,
          height: 32,
          borderRadius: "50%",
          border: "3px solid #3b3b5c",
          borderTopColor: "#8b5cf6",
          animation: "spin 0.7s linear infinite",
        }}
      />
      Chargement de l&apos;éditeur de design…
      <style>{`@keyframes spin { to { transform: rotate(360deg); } }`}</style>
    </div>
  );
}

/** Ajoute le document porteur en query : requis à la création du canevas. */
function withDoc(url: string, documentId?: string): string {
  return documentId ? `${url}?documentId=${encodeURIComponent(documentId)}` : url;
}

interface DesignModalProps {
  designId: string;
  /**
   * Document porteur. Indispensable seulement à la création (aucune ligne en
   * base) : ensuite le serveur s'appuie sur le rattachement stocké et ignore
   * ce paramètre.
   */
  documentId?: string;
  title: string;
  /** Miniature actuelle du bloc : remplacée (ancien média à la corbeille) à la fermeture. */
  thumbnailUrl?: string | null;
  lockedBy: string | null;
  lockedAt: string | null;
  onClose: (thumbnail?: string) => void;
  updateAttributes: (attrs: Record<string, unknown>) => void;
}

export function DesignModal({
  designId,
  documentId,
  title: _title,
  thumbnailUrl,
  lockedBy,
  lockedAt,
  onClose,
  updateAttributes,
}: DesignModalProps) {
  const t = useTranslations("designCanvas");
  const [mounted, setMounted] = useState(false);
  const [canvasJson, setCanvasJson] = useState<unknown>(null);
  const [loading, setLoading] = useState(true);
  // Dernière miniature produite par l'enregistrement automatique : envoyée une
  // seule fois par session d'édition, à la fermeture (pas toutes les 2 s).
  const latestThumbRef = useRef<string>("");
  const flushedRef = useRef(false);
  const updateAttributesRef = useRef(updateAttributes);
  updateAttributesRef.current = updateAttributes;

  const flushThumbnail = useCallback(async () => {
    const thumb = latestThumbRef.current;
    if (!thumb || flushedRef.current) return;
    flushedRef.current = true;
    // L'espace du document porteur : sans lui, le média serait orphelin et
    // « manquant » pour les autres lecteurs.
    const spaceId =
      typeof window !== "undefined"
        ? (window as typeof window & { __loriax_spaceId?: string }).__loriax_spaceId
        : undefined;
    const stored = await uploadDesignThumbnail(thumb, spaceId ?? null);
    updateAttributesRef.current({ thumbnailUrl: stored ?? thumb });
    // L'ancienne miniature n'est pas touchée ici : une copie du document peut la
    // partager, un Ctrl+Z peut la réafficher. Le ramassage planifié la met à la
    // corbeille après 7 jours sans aucun usage (media/stale-thumbnails.ts).
  }, []);
  const flushRef = useRef(flushThumbnail);
  flushRef.current = flushThumbnail;

  const { isLockedByOther, acquireLock, releaseLock } = useBlockLock({
    lockedBy,
    lockedAt,
    modalOpen: true,
    updateAttributes,
  });

  // Charger le JSON canvas depuis l'API au montage
  useEffect(() => {
    fetch(withDoc(`/api/designs/${designId}`, documentId))
      .then((r) => r.json())
      .then((data) => {
        setCanvasJson(data);
        setLoading(false);
      })
      .catch(() => {
        setCanvasJson(null);
        setLoading(false);
      });
  }, [designId, documentId]);

  // Acquisition du verrou + setup navigation/clavier
  useEffect(() => {
    setMounted(true);
    document.body.style.overflow = "hidden";

    if (!isLockedByOther) {
      acquireLock();
    }

    // Intercepter le bouton retour navigateur
    history.pushState({ designOpen: true }, "");

    const handleClose = () => {
      releaseLock();
      void flushRef.current();
      onClose();
    };

    const onKeydown = (e: KeyboardEvent) => {
      if (e.key === "Escape") handleClose();
    };
    const onPopstate = () => handleClose();

    window.addEventListener("keydown", onKeydown);
    window.addEventListener("popstate", onPopstate);

    return () => {
      document.body.style.overflow = "";
      releaseLock();
      void flushRef.current();
      window.removeEventListener("keydown", onKeydown);
      window.removeEventListener("popstate", onPopstate);
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const handleClose = useCallback(() => {
    releaseLock();
    void flushThumbnail();
    onClose();
  }, [releaseLock, flushThumbnail, onClose]);

  // Sauvegarder en S3 via PUT + mettre à jour thumbnailUrl dans le bloc
  const handleSave = useCallback(
    async (doc: DesignDocument, thumbnail: string) => {
      const saved = await fetch(withDoc(`/api/designs/${designId}`, documentId), {
        method: "PUT",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(doc),
      }).catch(() => null);
      // Usages `explicit` : le serveur ne peut pas lire le design (S3). Un échec ne bloque pas la sauvegarde.
      if (saved?.ok) {
        const spaceId =
          (window as typeof window & { __loriax_spaceId?: string }).__loriax_spaceId ?? null;
        const synced = await fetch("/api/media/usages/explicit", {
          method: "PUT",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({
            targetType: "design",
            targetId: designId,
            documentId: documentId ?? null,
            spaceId,
            mediaIds: collectMediaIds(doc),
          }),
        }).catch(() => null);
        if (!synced?.ok) toast.error(t("usageSyncFailed"));
      }
      // Ne jamais effacer un aperçu valide : si la génération de miniature a
      // échoué (canvas taché, etc.), `thumbnail` est vide → on garde l'ancien.
      // La miniature n'est envoyée qu'à la fermeture (voir flushThumbnail).
      if (thumbnail) latestThumbRef.current = thumbnail;
    },
    [designId, documentId, t]
  );

  if (!mounted) return null;

  // Si verrouillé par un autre utilisateur, afficher un message bloquant
  if (isLockedByOther) {
    return typeof document !== "undefined"
      ? createPortal(
          <div
            role="dialog"
            aria-modal="true"
            aria-label="Design verrouillé"
            style={{
              position: "fixed",
              inset: 0,
              background: "rgba(0,0,0,0.75)",
              display: "flex",
              alignItems: "center",
              justifyContent: "center",
              zIndex: 50,
              flexDirection: "column",
              gap: 16,
              color: "#e2e8f0",
              fontFamily:
                "-apple-system, BlinkMacSystemFont, 'Segoe UI', sans-serif",
              fontSize: 14,
            }}
          >
            <div
              style={{
                background: "#1e1e2e",
                borderRadius: 12,
                padding: "32px 40px",
                maxWidth: 400,
                textAlign: "center",
                border: "1px solid #3b3b5c",
              }}
            >
              <p style={{ color: "#f97316", fontWeight: 600, marginBottom: 8 }}>
                Canvas verrouillé
              </p>
              <p style={{ color: "#94a3b8", fontSize: 13 }}>
                Ce canvas est en cours d&apos;édition par un autre utilisateur.
                Réessayez dans quelques instants.
              </p>
              <button
                onClick={handleClose}
                style={{
                  marginTop: 20,
                  padding: "8px 24px",
                  background: "#3b3b5c",
                  color: "#e2e8f0",
                  border: "none",
                  borderRadius: 6,
                  cursor: "pointer",
                  fontSize: 13,
                }}
              >
                Fermer
              </button>
            </div>
          </div>,
          document.body
        )
      : null;
  }

  const content = (
    <div
      role="dialog"
      aria-modal="true"
      aria-label="Éditeur de design"
      style={{
        position: "fixed",
        inset: 0,
        zIndex: 50,
      }}
    >
      {loading ? (
        <div
          style={{
            position: "fixed",
            inset: 0,
            background: "#1e1e2e",
            display: "flex",
            alignItems: "center",
            justifyContent: "center",
            flexDirection: "column",
            gap: 12,
            color: "#a78bfa",
            fontFamily:
              "-apple-system, BlinkMacSystemFont, 'Segoe UI', sans-serif",
            fontSize: 13,
          }}
        >
          <Loader2
            className="animate-spin"
            style={{ width: 32, height: 32 }}
          />
          Chargement du canvas…
        </div>
      ) : (
        <DesignCanvas
          designId={designId}
          initialJson={canvasJson}
          onSave={handleSave}
          onClose={handleClose}
        />
      )}
    </div>
  );

  return typeof document !== "undefined"
    ? createPortal(content, document.body)
    : null;
}
