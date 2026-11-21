"use client";

/**
 * Vue de lecture du bloc présentation.
 *
 * Le moteur pèse plusieurs centaines de kilo-octets : il n'est ni importé ni
 * monté tant que l'utilisateur n'ouvre pas la présentation. Un document qui en
 * contient cinq ne charge donc que cinq vignettes. C'est la raison d'être du
 * `next/dynamic` ci-dessous, dont le module n'est demandé qu'au premier rendu
 * de l'incrustation.
 */

import { useCallback, useEffect, useState } from "react";
import { createPortal } from "react-dom";
import dynamic from "next/dynamic";
import { useLocale, useTranslations } from "next-intl";
import { NodeViewWrapper, type NodeViewProps } from "@tiptap/react";
import {
  GripHorizontal,
  Loader2,
  Pencil,
  Play,
  Presentation,
  Trash2,
  X,
} from "lucide-react";
import { Button } from "@/components/ui/button";
import { Hint } from "@/components/ui/hint";
import type { Deck } from "@/lib/presentations/deck";
import { DeckThumbnail } from "@/components/presentations/deck-thumbnail";

const PresentationRuntime = dynamic(
  () =>
    import("@/components/presentations/presentation-runtime").then(
      (m) => m.PresentationRuntime
    ),
  { ssr: false }
);

interface PresentationSummary {
  id: string;
  title: string;
  version: number;
  slideCount: number;
  thumbnailKey: string | null;
}

type LoadState = "idle" | "loading" | "ready" | "missing" | "error";

/** Incrustation plein écran, montée hors de l'arbre de l'éditeur. */
function PresentationOverlay({
  label,
  onClose,
  children,
}: {
  label: string;
  onClose: () => void;
  children: React.ReactNode;
}) {
  useEffect(() => {
    document.body.style.overflow = "hidden";
    // Une entrée d'historique dédiée : le bouton retour ferme la présentation
    // au lieu de quitter le document.
    history.pushState({ presentationOpen: true }, "");

    const onKeydown = (e: KeyboardEvent) => {
      if (e.key === "Escape") onClose();
    };
    const onPopstate = () => onClose();
    window.addEventListener("keydown", onKeydown);
    window.addEventListener("popstate", onPopstate);
    return () => {
      document.body.style.overflow = "";
      window.removeEventListener("keydown", onKeydown);
      window.removeEventListener("popstate", onPopstate);
    };
  }, [onClose]);

  // L'incrustation n'est rendue qu'après un clic, donc toujours côté client.
  if (typeof document === "undefined") return null;

  return createPortal(
    <div
      role="dialog"
      aria-modal="true"
      aria-label={label}
      className="fixed inset-0 z-50 bg-background"
    >
      {children}
    </div>,
    document.body
  );
}

export function PresentationBlockView({
  node,
  updateAttributes,
  deleteNode,
  selected,
  editor,
}: NodeViewProps) {
  const t = useTranslations("presentations");
  const locale = useLocale();
  const { presentationId, title } = node.attrs as {
    presentationId: string | null;
    title: string;
  };
  const isEditable = editor.isEditable;

  const [state, setState] = useState<LoadState>("idle");
  const [summary, setSummary] = useState<PresentationSummary | null>(null);
  const [deck, setDeck] = useState<Deck | null>(null);
  const [openMode, setOpenMode] = useState<"edit" | "play" | null>(null);

  useEffect(() => {
    if (!presentationId) {
      setState("idle");
      return;
    }
    let cancelled = false;
    setState("loading");
    fetch(`/api/presentations/${presentationId}`)
      .then(async (res) => {
        if (res.status === 404 || res.status === 403) return { missing: true } as const;
        if (!res.ok) throw new Error(String(res.status));
        return (await res.json()) as { presentation: PresentationSummary; deck: Deck };
      })
      .then((payload) => {
        if (cancelled) return;
        if ("missing" in payload) {
          setState("missing");
          return;
        }
        setSummary(payload.presentation);
        setDeck(payload.deck);
        setState("ready");
        // Le titre du nœud suit celui de la présentation : la source de vérité
        // est la ligne en base, pas la copie posée dans le document.
        if (isEditable && payload.presentation.title !== title) {
          updateAttributes({ title: payload.presentation.title });
        }
      })
      .catch(() => {
        if (!cancelled) setState("error");
      });
    return () => {
      cancelled = true;
    };
    // `title` est délibérément hors des dépendances : il est écrit par cet effet.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [presentationId, isEditable, updateAttributes]);

  const closeOverlay = useCallback(() => {
    setOpenMode(null);
    if (document.fullscreenElement) void document.exitFullscreen().catch(() => {});
  }, []);

  /**
   * « Lire » présente en plein écran navigateur, « Modifier » ouvre l'éditeur.
   *
   * Le plein écran est demandé ici, dans le clic : l'appel doit partir d'une
   * frame qui vient de recevoir une activation utilisateur, et l'iframe du
   * moteur n'en a aucune quand l'ordre lui arrive par postMessage. On met donc
   * la page entière en plein écran depuis le parent, l'incrustation la remplit,
   * et le moteur n'a plus qu'à présenter dans son cadre.
   */
  const openPlay = useCallback(() => {
    void document.documentElement.requestFullscreen?.().catch(() => {});
    setOpenMode("play");
  }, []);

  /**
   * Le deck écrit remonte avec la version : sans lui, une réouverture rendrait
   * au moteur le deck du premier chargement avec la version à jour, et la
   * retouche suivante écraserait le travail enregistré sans conflit visible.
   */
  const onSaved = useCallback(
    (version: number, slideCount: number, savedDeck: Deck) => {
      setSummary((prev) => (prev ? { ...prev, version, slideCount } : prev));
      setDeck(savedDeck);
    },
    []
  );

  const displayTitle = summary?.title ?? title ?? "";
  /**
   * En plein écran, Échap est consommé par le navigateur : la touche ne parvient
   * ni au moteur ni à l'incrustation. Sortir du plein écran vaut donc fin du
   * diaporama.
   */
  useEffect(() => {
    if (openMode !== "play") return;
    const onChange = () => {
      if (!document.fullscreenElement) closeOverlay();
    };
    document.addEventListener("fullscreenchange", onChange);
    return () => document.removeEventListener("fullscreenchange", onChange);
  }, [openMode, closeOverlay]);

  const canOpen = state === "ready" && !!presentationId && !!deck && !!summary;

  return (
    <NodeViewWrapper
      data-type="presentation-block"
      className={`editor-block-wrapper ${selected ? "is-selected" : ""}`}
    >
      <div className="editor-block" contentEditable={false}>
        <div className={`editor-block-toolbar ${selected ? "is-visible" : ""}`}>
          <div className="flex items-center gap-2 flex-1 min-w-0" data-drag-handle>
            <GripHorizontal className="h-4 w-4 text-muted-foreground cursor-grab shrink-0" />
            <Presentation className="h-3.5 w-3.5 text-muted-foreground shrink-0" />
            <span className="flex-1 truncate px-1.5 py-0.5 text-xs font-medium">
              {displayTitle}
            </span>
          </div>
          <div className="flex items-center gap-1">
            {presentationId && (
              <>
                <Hint label={canOpen ? t("blockPlay") : t("blockLoading")} disabled={!canOpen}>
                  <Button
                    size="xs"
                    variant="ghost"
                    onClick={openPlay}
                    disabled={!canOpen}
                    aria-label={t("blockPlay")}
                  >
                    <Play className="h-3.5 w-3.5" />
                    <span className="text-[11px]">{t("blockPlay")}</span>
                  </Button>
                </Hint>
                {isEditable && (
                  <Hint label={canOpen ? t("blockEdit") : t("blockLoading")} disabled={!canOpen}>
                    <Button
                      size="xs"
                      onClick={() => setOpenMode("edit")}
                      disabled={!canOpen}
                      aria-label={t("blockEdit")}
                    >
                      <Pencil className="h-3.5 w-3.5" />
                      <span className="text-[11px]">{t("blockEdit")}</span>
                    </Button>
                  </Hint>
                )}
              </>
            )}
            {isEditable && (
              <Hint label={t("blockRemove")}>
                <Button
                  variant="ghost"
                  size="icon-sm"
                  onClick={deleteNode}
                  aria-label={t("blockRemove")}
                  className="hover:text-destructive hover:bg-destructive/10"
                >
                  <Trash2 className="h-3.5 w-3.5" />
                </Button>
              </Hint>
            )}
          </div>
        </div>

        {/* La hauteur minimale commune des blocs (400 px) laisserait deux
            bandes vides autour d'un aperçu de diapositive, qui a son propre
            format. Le bloc s'ajuste donc à son contenu. */}
        <div className="editor-block-content !min-h-0">
          {state === "loading" || state === "idle" ? (
            <div className="flex items-center justify-center gap-2 text-muted-foreground/60">
              <Loader2 className="h-5 w-5 animate-spin" />
              <span className="text-sm">{t("blockLoading")}</span>
            </div>
          ) : state === "missing" ? (
            <div className="flex items-center justify-center text-muted-foreground/70">
              <span className="text-sm">{t("blockMissing")}</span>
            </div>
          ) : state === "error" ? (
            <div className="flex items-center justify-center text-destructive/70">
              <span className="text-sm">{t("loadError")}</span>
            </div>
          ) : (
            <button
              type="button"
              onClick={() => (isEditable ? setOpenMode("edit") : openPlay())}
              className="flex w-full flex-col items-center justify-center gap-2 py-2 text-muted-foreground/40 transition-colors hover:text-muted-foreground/60"
            >
              {deck ? (
                // Le cadre suit le format réel du document, il n'est pas figé
                // en 16:9 : une présentation carrée doit se voir carrée.
                <DeckThumbnail
                  deck={deck}
                  className="max-h-56 w-full max-w-lg rounded border border-border shadow-sm"
                />
              ) : (
                <Presentation className="h-10 w-10" />
              )}
              {/* Le titre est déjà porté par l'en-tête du bloc : sous l'aperçu,
                  seul le nombre de diapositives apporte une information. */}
              <span className="text-[11px] text-muted-foreground/60">
                {t("slideCount", { count: summary?.slideCount ?? 0 })}
              </span>
            </button>
          )}
        </div>
      </div>

      {openMode && canOpen && (
        <PresentationOverlay
          label={openMode === "edit" ? t("blockEditLabel") : t("blockPlayLabel")}
          onClose={closeOverlay}
        >
          <div className="h-full">
            <PresentationRuntime
              presentationId={presentationId!}
              initialDeck={deck!}
              initialVersion={summary!.version}
              mode={openMode}
              locale={locale}
              action={
                <Hint label={t("blockClose")}>
                  <Button
                    variant="ghost"
                    size="xs"
                    onClick={closeOverlay}
                    aria-label={t("blockClose")}
                  >
                    <X className="h-3.5 w-3.5" />
                    <span>{t("blockClose")}</span>
                  </Button>
                </Hint>
              }
              onSaved={onSaved}
              onPresentEnd={closeOverlay}
            />
          </div>
        </PresentationOverlay>
      )}
    </NodeViewWrapper>
  );
}
