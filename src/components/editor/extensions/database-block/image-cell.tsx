"use client";

import { Hint } from "@/components/ui/hint";
import { useEffect, useId, useState, type ReactNode } from "react";
import { useTranslations } from "next-intl";
import { toast } from "sonner";
import { ImagePlus, ImageOff, Replace, X } from "lucide-react";
import { MediaPicker } from "@/components/media/picker/media-picker";
import { normalizeImageCell } from "@/lib/media/cell-values";
import { mediaIdFromUrl, useMediaPresence } from "@/components/media/use-media-presence";

interface ImageCellProps {
  value: string | null;
  onChange: (url: string | null) => void;
  spaceId: string;
  editable: boolean;
}

/** Bouton à icône : info-bulle au survol et au focus clavier, nom accessible. */
function IconAction({
  label,
  onClick,
  className,
  children,
}: {
  label: string;
  onClick: () => void;
  className?: string;
  children: ReactNode;
}) {
  const tipId = useId();
  const [open, setOpen] = useState(false);
  return (
    <span
      className="relative inline-flex"
      onMouseEnter={() => setOpen(true)}
      onMouseLeave={() => setOpen(false)}
      onFocus={() => setOpen(true)}
      onBlur={() => setOpen(false)}
      onKeyDown={(e) => {
        if (e.key === "Escape") setOpen(false);
      }}
    >
      <button
        type="button"
        aria-label={label}
        aria-describedby={open ? tipId : undefined}
        onClick={onClick}
        className={
          className ??
          "inline-flex h-6 w-6 items-center justify-center rounded text-muted-foreground transition-colors hover:text-foreground focus-visible:outline-2 focus-visible:outline-ring"
        }
      >
        {children}
      </button>
      {open ? (
        <span
          id={tipId}
          role="tooltip"
          className="pointer-events-none absolute left-1/2 top-full z-50 mt-1 -translate-x-1/2 whitespace-nowrap rounded-md border border-border bg-popover px-2 py-1 text-xs text-popover-foreground shadow-md"
        >
          {label}
        </span>
      ) : null}
    </span>
  );
}

/** Source affichable d'une valeur de cellule, toutes formes héritées comprises. */
function imageSrc(value: string | null | undefined): string | null {
  const cell = normalizeImageCell(value);
  switch (cell.kind) {
    case "media":
      return `/api/media/${cell.mediaId}`;
    case "external":
    case "data":
      return cell.url;
    case "legacyKey":
      // Alias permanent : la valeur d'origine est servie telle quelle.
      return typeof value === "string" ? value.trim() : null;
    default:
      return null;
  }
}

export function ImageCell({ value, onChange, spaceId, editable }: ImageCellProps) {
  const t = useTranslations("editor.imageCell");
  const [showModal, setShowModal] = useState(false);
  const [pickerOpen, setPickerOpen] = useState(false);
  const [loadFailed, setFailed] = useState(false);

  const src = imageSrc(value);
  const { missing: trashedOrGone } = useMediaPresence(mediaIdFromUrl(src));
  const failed = loadFailed || trashedOrGone;

  // Une nouvelle valeur retente le chargement (remplacement, restauration).
  useEffect(() => {
    setFailed(false);
  }, [src]);

  const picker = editable ? (
    <MediaPicker
      open={pickerOpen}
      onOpenChange={setPickerOpen}
      accept={["image"]}
      mode="single"
      spaceId={spaceId || null}
      tabs={["library", "upload"]}
      onPick={(items) => {
        const picked = items[0];
        if (!picked) return;
        onChange(`/api/media/${picked.id}`);
        toast.success(t("picked"));
      }}
    />
  ) : null;

  const handleRemove = () => {
    const previous = value;
    onChange("");
    toast.success(t("removed"), {
      action: { label: t("undo"), onClick: () => onChange(previous ?? null) },
    });
  };

  if (src) {
    return (
      <div data-row-control onKeyDown={(e) => e.stopPropagation()}>
        <div className="flex items-center gap-1.5 px-2 py-1">
          {failed ? (
            <div
              role="img"
              aria-label={t("missing")}
              data-media-missing="true"
              className="flex h-12 w-12 shrink-0 flex-col items-center justify-center rounded border border-dashed border-border bg-muted text-muted-foreground"
              title={t("missing")}
            >
              <ImageOff className="h-4 w-4" aria-hidden="true" />
            </div>
          ) : (
            <Hint label={t("zoom")} className="shrink-0">
              <button
                type="button"
                aria-label={t("zoom")}
                onClick={() => setShowModal(true)}
                className="shrink-0 overflow-hidden rounded border border-border transition-colors hover:border-primary focus-visible:outline-2 focus-visible:outline-ring"
              >
                {/* eslint-disable-next-line @next/next/no-img-element */}
                <img
                  src={src}
                  alt=""
                  width={48}
                  height={48}
                  className="h-12 w-12 object-cover"
                  onError={() => setFailed(true)}
                />
              </button>
            </Hint>
          )}
          {editable && (
            <>
              <IconAction label={t("replace")} onClick={() => setPickerOpen(true)}>
                <Replace className="h-3.5 w-3.5" aria-hidden="true" />
              </IconAction>
              <IconAction
                label={t("remove")}
                onClick={handleRemove}
                className="inline-flex h-6 w-6 items-center justify-center rounded text-muted-foreground transition-colors hover:text-destructive focus-visible:outline-2 focus-visible:outline-ring"
              >
                <X className="h-3.5 w-3.5" aria-hidden="true" />
              </IconAction>
            </>
          )}
        </div>

        {showModal && !failed && (
          <div
            className="fixed inset-0 z-50 flex items-center justify-center bg-black/60"
            role="dialog"
            aria-modal="true"
            aria-label={t("zoom")}
            onClick={() => setShowModal(false)}
            onKeyDown={(e) => {
              if (e.key === "Escape") setShowModal(false);
            }}
          >
            <div className="relative max-h-[90vh] max-w-[90vw]" onClick={(e) => e.stopPropagation()}>
              {/* eslint-disable-next-line @next/next/no-img-element */}
              <img src={src} alt="" className="max-h-[90vh] max-w-full rounded-lg object-contain" />
              <button
                type="button"
                autoFocus
                aria-label={t("close")}
                title={t("close")}
                onClick={() => setShowModal(false)}
                className="absolute right-2 top-2 rounded-full bg-black/50 p-1 text-white hover:bg-black/70 focus-visible:outline-2 focus-visible:outline-ring"
              >
                <X className="h-5 w-5" aria-hidden="true" />
              </button>
            </div>
          </div>
        )}
        {picker}
      </div>
    );
  }

  // Cellule vide ou valeur illisible : rien n'est réécrit tant que l'utilisateur ne choisit pas.
  if (!editable) return <div className="px-2 py-1 text-xs text-muted-foreground">-</div>;

  return (
    <div data-row-control className="flex items-center gap-1 px-2 py-1" onKeyDown={(e) => e.stopPropagation()}>
      <IconAction label={t("pick")} onClick={() => setPickerOpen(true)}>
        <ImagePlus className="h-3.5 w-3.5" aria-hidden="true" />
      </IconAction>
      {picker}
    </div>
  );
}
