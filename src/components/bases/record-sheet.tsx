"use client";

import { useEffect, useId, useRef, useState } from "react";
import { Dialog } from "@base-ui/react/dialog";
import { useTranslations } from "next-intl";
import { toast } from "sonner";
import {
  AlertTriangle,
  ChevronLeft,
  ChevronRight,
  ExternalLink,
  FileX,
  Maximize2,
  Minimize2,
  RotateCw,
  X,
} from "lucide-react";
import { DialogOverlay, DialogPortal } from "@/components/ui/dialog";
import { Button, buttonVariants } from "@/components/ui/button";
import { Skeleton } from "@/components/ui/skeleton";
import { Tip } from "@/components/editor/extensions/database-block/row-tip";
import { cn } from "@/lib/utils";
import type { RecordNav } from "@/lib/bases/record-navigation";
import { useNarrowViewport } from "./use-narrow-viewport";

export type RecordSheetStatus = "ready" | "loading" | "error" | "notFound";

export interface RecordSheetProps {
  open: boolean;
  /** Already resolved; empty string = untitled. */
  title: string;
  status: RecordSheetStatus;
  /** Absent = no prev/next controls. */
  nav?: RecordNav;
  /** Defaults to t("entity"). */
  entityLabel?: string;
  /** Button rendered only when provided. */
  openInBasesHref?: string;
  onClose: () => void;
  onNavigate?: (rowId: string) => void;
  /** Retry button rendered only when provided. */
  onRetry?: () => void;
  /** Slot: top of the left column. */
  sections?: React.ReactNode;
  /** Slot: right column; layout is two columns only when provided. */
  aside?: React.ReactNode;
  /** Properties. */
  children: React.ReactNode;
}

export { useNarrowViewport };

export function RecordSheet({
  open,
  title,
  status,
  nav,
  entityLabel,
  openInBasesHref,
  onClose,
  onNavigate,
  onRetry,
  sections,
  aside,
  children,
}: RecordSheetProps) {
  const t = useTranslations("recordSheet");
  const narrow = useNarrowViewport();
  const [fullscreen, setFullscreen] = useState(false);
  const closeRef = useRef<HTMLButtonElement>(null);
  const headerRef = useRef<HTMLElement>(null);
  const onCloseRef = useRef(onClose);
  useEffect(() => {
    onCloseRef.current = onClose;
  });
  const hintId = useId();
  const effectiveFullscreen = fullscreen || narrow;
  // Two columns need room: on a narrow viewport the aside stacks under the fields.
  const twoColumns = effectiveFullscreen && !narrow;
  const entity = entityLabel ?? t("entity");
  const displayTitle = title.trim() === "" ? t("untitled") : title;
  const split = aside !== undefined && aside !== null;

  function toggleFullscreen() {
    if (narrow) return;
    const next = !fullscreen;
    setFullscreen(next);
    toast(next ? t("toastFullscreen") : t("toastSidePanel"));
  }

  function goPrev() {
    if (nav?.prevId) onNavigate?.(nav.prevId);
    else toast.info(nav?.outOfList ? t("prevDisabledOutOfList") : t("edgeFirst"));
  }

  // Un tooltip ouvert (focus clavier sur un bouton de l'en-tête) absorbe le premier Échap.
  // Écoute en capture sur window, limitée à l'en-tête : les champs en édition gardent leur
  // propre Échap (annulation, fermeture d'un sélecteur), traité plus bas dans l'arbre.
  useEffect(() => {
    if (!open) return;
    const onEsc = (e: KeyboardEvent) => {
      if (e.key !== "Escape") return;
      if (!headerRef.current?.contains(e.target as Node | null)) return;
      e.preventDefault();
      e.stopPropagation();
      onCloseRef.current();
    };
    window.addEventListener("keydown", onEsc, true);
    return () => window.removeEventListener("keydown", onEsc, true);
  }, [open]);

  function goNext() {
    if (nav?.nextId) onNavigate?.(nav.nextId);
    else toast.info(t("edgeLast"));
  }

  function onKeyDown(e: React.KeyboardEvent) {
    if (!e.altKey) return;
    if (e.key === "ArrowLeft") {
      e.preventDefault();
      if (nav) goPrev();
    } else if (e.key === "ArrowRight") {
      e.preventDefault();
      if (nav) goNext();
    } else if (e.key === "Enter") {
      e.preventDefault();
      toggleFullscreen();
    }
  }

  const prevDisabled = !nav?.prevId;
  const nextDisabled = !nav?.nextId;
  const prevDisabledLabel = nav?.outOfList ? t("prevDisabledOutOfList") : t("prevDisabled");
  const fullscreenLabel = narrow
    ? t("fullscreenForced")
    : effectiveFullscreen
      ? t("exitFullscreen")
      : t("fullscreen");

  return (
    <Dialog.Root
      open={open}
      onOpenChange={(o, details) => {
        if (o) return;
        // Un champ en édition qui a traité Échap (annulation) garde la fiche ouverte.
        if (
          details.reason === "escape-key" &&
          details.event.defaultPrevented &&
          !headerRef.current?.contains(details.event.target as Node | null)
        ) {
          details.cancel();
          return;
        }
        onClose();
      }}
    >
      <DialogPortal>
        <DialogOverlay />
        <Dialog.Popup
          aria-modal="true"
          initialFocus={closeRef}
          aria-label={t("dialogLabel", { entity, title: displayTitle })}
          data-fullscreen={effectiveFullscreen ? "true" : "false"}
          data-layout={split ? "split" : "single"}
          onKeyDown={onKeyDown}
          className={cn(
            "fixed inset-y-0 right-0 z-50 flex flex-col border-l border-border bg-background text-foreground shadow-xl outline-none duration-150 data-open:animate-in data-open:slide-in-from-right data-closed:animate-out data-closed:slide-out-to-right",
            effectiveFullscreen ? "w-full" : "w-[min(780px,100%)]",
          )}
        >
          <header ref={headerRef} className="flex h-12 shrink-0 items-center gap-2 border-b border-border px-3">
            {nav && (
              <div className="flex shrink-0 items-center gap-1">
                <Tip label={prevDisabled ? prevDisabledLabel : t("prev")} kbd="Alt+←">
                  <Button
                    variant="ghost"
                    size="icon-sm"
                    aria-label={t("prev")}
                    aria-describedby={prevDisabled ? `${hintId}-prev` : undefined}
                    aria-disabled={prevDisabled ? "true" : undefined}
                    className={cn(prevDisabled && "opacity-50")}
                    onClick={goPrev}
                  >
                    <ChevronLeft aria-hidden="true" />
                  </Button>
                </Tip>
                <Tip label={nextDisabled ? t("nextDisabled") : t("next")} kbd="Alt+→">
                  <Button
                    variant="ghost"
                    size="icon-sm"
                    aria-label={t("next")}
                    aria-describedby={nextDisabled ? `${hintId}-next` : undefined}
                    aria-disabled={nextDisabled ? "true" : undefined}
                    className={cn(nextDisabled && "opacity-50")}
                    onClick={goNext}
                  >
                    <ChevronRight aria-hidden="true" />
                  </Button>
                </Tip>
                {prevDisabled && (
                  <span id={`${hintId}-prev`} className="sr-only">
                    {prevDisabledLabel}
                  </span>
                )}
                {nextDisabled && (
                  <span id={`${hintId}-next`} className="sr-only">
                    {t("nextDisabled")}
                  </span>
                )}
                <span
                  aria-live="polite"
                  className="px-1 text-xs whitespace-nowrap text-muted-foreground"
                >
                  {nav.outOfList
                    ? t("positionOutOfList")
                    : t("position", { entity, n: nav.index + 1, total: nav.total })}
                </span>
              </div>
            )}
            <h2 title={displayTitle} className="min-w-0 flex-1 truncate text-sm font-semibold">
              {displayTitle}
            </h2>
            <div className="flex shrink-0 items-center gap-1">
              {openInBasesHref && (
                <Tip label={t("openInBases")}>
                  <a
                    href={openInBasesHref}
                    aria-label={t("openInBases")}
                    className={buttonVariants({ variant: "ghost", size: "icon-sm" })}
                  >
                    <ExternalLink aria-hidden="true" />
                  </a>
                </Tip>
              )}
              <Tip label={fullscreenLabel} kbd={narrow ? undefined : t("kbdFullscreen")}>
                <Button
                  variant="ghost"
                  size="icon-sm"
                  aria-label={fullscreenLabel}
                  aria-disabled={narrow ? "true" : undefined}
                  className={cn(narrow && "opacity-50")}
                  onClick={toggleFullscreen}
                >
                  {effectiveFullscreen && !narrow ? (
                    <Minimize2 aria-hidden="true" />
                  ) : (
                    <Maximize2 aria-hidden="true" />
                  )}
                </Button>
              </Tip>
              <Tip label={t("close")} kbd={t("kbdEscape")}>
                <Dialog.Close
                  render={
                    <Button ref={closeRef} variant="ghost" size="icon-sm" aria-label={t("close")} />
                  }
                >
                  <X aria-hidden="true" />
                </Dialog.Close>
              </Tip>
            </div>
          </header>

          {status === "ready" && (
            <div
              className={cn(
                "min-h-0 flex-1",
                split
                  ? cn(
                      "grid gap-0",
                      twoColumns
                        ? "grid-cols-[minmax(0,1.1fr)_minmax(0,1fr)]"
                        : "grid-cols-1 overflow-y-auto",
                    )
                  : "overflow-y-auto",
              )}
            >
              <div className={cn("min-w-0 p-4", split && twoColumns && "overflow-y-auto")}>
                {sections}
                {children}
              </div>
              {split && (
                <div
                  className={cn(
                    "min-w-0 border-border p-4",
                    twoColumns ? "overflow-y-auto border-l" : "border-t",
                  )}
                >
                  {aside}
                </div>
              )}
            </div>
          )}

          {status === "loading" && (
            <div
              role="status"
              aria-label={t("loading")}
              className="flex flex-1 flex-col gap-3 p-4"
            >
              <Skeleton className="h-6 w-2/3" />
              <Skeleton className="h-4 w-full" />
              <Skeleton className="h-4 w-5/6" />
            </div>
          )}

          {status === "error" && (
            <div className="flex flex-1 flex-col items-center justify-center gap-3 p-6 text-center">
              <AlertTriangle className="size-8 text-muted-foreground" aria-hidden="true" />
              <p className="text-sm font-medium">{t("errorTitle")}</p>
              {onRetry && (
                <Tip label={t("retry")}>
                  <Button variant="outline" size="sm" onClick={onRetry}>
                    <RotateCw aria-hidden="true" />
                    {t("retry")}
                  </Button>
                </Tip>
              )}
            </div>
          )}

          {status === "notFound" && (
            <div className="flex flex-1 flex-col items-center justify-center gap-2 p-6 text-center">
              <FileX className="size-8 text-muted-foreground" aria-hidden="true" />
              <p className="text-sm font-medium">{t("notFoundTitle")}</p>
              <p className="text-sm text-muted-foreground">{t("notFoundBody")}</p>
            </div>
          )}
        </Dialog.Popup>
      </DialogPortal>
    </Dialog.Root>
  );
}
