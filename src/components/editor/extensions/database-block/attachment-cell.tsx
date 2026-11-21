"use client";

import { Hint } from "@/components/ui/hint";
import { useState, useEffect, useCallback, useMemo, useRef, useId } from "react";
import { useTranslations } from "next-intl";
import { toast } from "sonner";
import {
  FileIcon,
  FileX,
  Download,
  X,
  Paperclip,
  Plus,
  ChevronUp,
  ChevronDown,
  type LucideIcon,
} from "lucide-react";
import {
  Popover,
  PopoverTrigger,
  PopoverContent,
} from "@/components/ui/popover";
import { MediaPicker } from "@/components/media/picker/media-picker";
import type { PickedMedia } from "@/components/media/picker/types";
import {
  MAX_ATTACHMENTS_PER_CELL,
  normalizeAttachments,
  type AttachmentValue,
  type LegacyAttachment,
  type NormalizedAttachment,
} from "@/lib/media/cell-values";

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

/** Forme cible `{ mediaId, ... }` ou forme héritée (`key`, ou sans `key`). */
export type AttachmentMeta = AttachmentValue | LegacyAttachment;

interface AttachmentCellProps {
  value: AttachmentMeta[] | null | undefined;
  onChange: (value: AttachmentMeta[]) => void;
  readOnly?: boolean;
  spaceId?: string;
}

type Entry = {
  /** Position dans le tableau stocké (les éléments illisibles gardent leur place). */
  index: number;
  norm: NormalizedAttachment;
};

// ---------------------------------------------------------------------------
// Utilitaires
// ---------------------------------------------------------------------------

function formatSize(bytes: number): string {
  if (bytes < 1024) return `${bytes} o`;
  if (bytes < 1024 * 1024) return `${Math.round(bytes / 1024)} Ko`;
  return `${(bytes / (1024 * 1024)).toFixed(1)} Mo`;
}

async function getSignedUrl(key: string): Promise<string> {
  try {
    const res = await fetch(
      `/api/attachments/signed?key=${encodeURIComponent(key)}`
    );
    if (!res.ok) return "";
    const data = await res.json();
    return data.url ?? "";
  } catch {
    return "";
  }
}

function entryId(e: Entry): string {
  return e.norm.kind === "media" ? e.norm.value.mediaId : (e.norm.value.key ?? `idx-${e.index}`);
}

function toAttachment(p: PickedMedia): AttachmentValue {
  return { mediaId: p.id, filename: p.filename, mimeType: p.mimeType, size: p.sizeBytes };
}

/** Bouton icône : info-bulle au survol et au focus clavier, nom accessible. */
function IconButton({
  icon: Icon,
  label,
  onClick,
  disabledReason,
  danger = false,
}: {
  icon: LucideIcon;
  label: string;
  onClick: () => void;
  disabledReason?: string;
  danger?: boolean;
}) {
  const [open, setOpen] = useState(false);
  const tipId = useId();
  const disabled = Boolean(disabledReason);
  const tip = disabledReason ?? label;
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
        aria-disabled={disabled || undefined}
        onClick={() => {
          if (!disabled) onClick();
        }}
        className={`inline-flex h-6 w-6 items-center justify-center rounded text-muted-foreground transition-colors focus-visible:outline-2 focus-visible:outline-ring ${
          danger ? "hover:text-destructive hover:bg-destructive/10" : "hover:text-foreground hover:bg-muted"
        } ${disabled ? "opacity-40 cursor-not-allowed" : ""}`}
      >
        <Icon className="h-3.5 w-3.5" aria-hidden="true" />
      </button>
      {open && (
        <span
          id={tipId}
          role="tooltip"
          className="pointer-events-none absolute bottom-full left-1/2 z-50 mb-1 -translate-x-1/2 whitespace-nowrap rounded bg-popover px-2 py-1 text-xs text-popover-foreground shadow-md ring-1 ring-border"
        >
          {tip}
        </span>
      )}
    </span>
  );
}

// ---------------------------------------------------------------------------
// Composant
// ---------------------------------------------------------------------------

export function AttachmentCell({
  value,
  onChange,
  readOnly = false,
  spaceId,
}: AttachmentCellProps) {
  const t = useTranslations("editor.attachmentCell");
  const raw = useMemo<unknown[]>(() => (Array.isArray(value) ? value : []), [value]);
  const entries = useMemo<Entry[]>(() => {
    const out: Entry[] = [];
    raw.forEach((r, index) => {
      const norm = normalizeAttachments([r]).items[0];
      if (norm) out.push({ index, norm });
    });
    return out;
  }, [raw]);

  const [open, setOpen] = useState(false);
  const [pickerOpen, setPickerOpen] = useState(false);
  const [thumbnails, setThumbnails] = useState<Map<string, string>>(new Map());
  const [missing, setMissing] = useState<Set<string>>(new Set());
  const triggerRef = useRef<HTMLElement | null>(null);

  const count = raw.length;
  const remaining = Math.max(0, MAX_ATTACHMENTS_PER_CELL - count);
  const limitReason = remaining === 0 ? t("limit", { max: MAX_ATTACHMENTS_PER_CELL }) : undefined;

  const idsKey = entries.map(entryId).join(",");

  // Média manquant : la fiche du média rend 404 (corbeille, purge, autre organisation).
  useEffect(() => {
    if (!open) return;
    const ids = entries
      .filter((e) => e.norm.kind === "media")
      .map((e) => (e.norm as { value: AttachmentValue }).value.mediaId);
    if (ids.length === 0) return;
    let cancelled = false;
    Promise.all(
      ids.map(async (id) => {
        try {
          const res = await fetch(`/api/media/${id}/meta`);
          if (res.status === 404) return { id, gone: true };
          // Un média à la corbeille reste lisible par /meta : il compte comme manquant.
          const body = res.ok ? ((await res.json()) as { media?: { deletedAt?: string | null } }) : null;
          return { id, gone: Boolean(body?.media?.deletedAt) };
        } catch {
          return { id, gone: false };
        }
      })
    ).then((results) => {
      if (cancelled) return;
      setMissing(new Set(results.filter((r) => r.gone).map((r) => r.id)));
    });
    return () => {
      cancelled = true;
    };
    // Relancé seulement si la liste de médias change ou à l'ouverture
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [open, idsKey]);

  // Miniatures des anciennes pièces image : URL signée
  useEffect(() => {
    const toFetch = entries.filter(
      (e) =>
        e.norm.kind === "legacy" &&
        e.norm.resolvable &&
        (e.norm.value.mimeType ?? "").startsWith("image/") &&
        !thumbnails.has(e.norm.value.key as string)
    );
    if (toFetch.length === 0) return;
    let cancelled = false;
    Promise.all(
      toFetch.map(async (e) => {
        const key = (e.norm as { value: LegacyAttachment }).value.key as string;
        return { key, url: await getSignedUrl(key) };
      })
    ).then((results) => {
      if (cancelled) return;
      setThumbnails((prev) => {
        const next = new Map(prev);
        for (const { key, url } of results) if (url) next.set(key, url);
        return next;
      });
    });
    return () => {
      cancelled = true;
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [idsKey]);

  const write = useCallback(
    (next: unknown[]) => onChange(next as AttachmentMeta[]),
    [onChange]
  );

  const handleDownload = useCallback(
    async (e: Entry) => {
      if (e.norm.kind === "media") {
        window.open(`/api/media/${e.norm.value.mediaId}?download=1`, "_blank", "noopener,noreferrer");
        return;
      }
      const key = e.norm.value.key;
      if (!key) return;
      const url = await getSignedUrl(key);
      if (url) window.open(url, "_blank", "noopener,noreferrer");
      else toast.error(t("notFound"));
    },
    [t]
  );

  const handleRemove = useCallback(
    (e: Entry) => {
      const before = raw;
      write(raw.filter((_, i) => i !== e.index));
      const name = e.norm.value.filename || t("unnamed");
      toast(t("removed", { name }), {
        action: { label: t("undo"), onClick: () => write(before) },
      });
    },
    [raw, write, t]
  );

  const handleMove = useCallback(
    (e: Entry, dir: -1 | 1) => {
      const pos = entries.indexOf(e);
      const other = entries[pos + dir];
      if (!other) return;
      const before = raw;
      const next = [...raw];
      [next[e.index], next[other.index]] = [next[other.index], next[e.index]];
      write(next);
      toast(t("moved", { name: e.norm.value.filename || t("unnamed") }), {
        action: { label: t("undo"), onClick: () => write(before) },
      });
    },
    [entries, raw, write, t]
  );

  const handlePick = useCallback(
    (picked: PickedMedia[]) => {
      const room = Math.max(0, MAX_ATTACHMENTS_PER_CELL - raw.length);
      const kept = picked.slice(0, room);
      if (kept.length === 0) {
        toast.error(t("limit", { max: MAX_ATTACHMENTS_PER_CELL }));
        return;
      }
      const before = raw;
      write([...raw, ...kept.map(toAttachment)]);
      if (kept.length < picked.length) toast.error(t("limit", { max: MAX_ATTACHMENTS_PER_CELL }));
      toast.success(t("added", { count: kept.length }), {
        action: { label: t("undo"), onClick: () => write(before) },
      });
    },
    [raw, write, t]
  );

  const picker = !readOnly && (
    <MediaPicker
      open={pickerOpen}
      onOpenChange={setPickerOpen}
      onPick={handlePick}
      mode="multiple"
      max={Math.max(1, remaining)}
      spaceId={spaceId ?? null}
      tabs={["library", "upload"]}
      title={t("pickerTitle")}
      finalFocus={() => triggerRef.current}
    />
  );

  // ---------------------------------------------------------------------------
  // Rendu : cellule vide
  // ---------------------------------------------------------------------------

  if (entries.length === 0 && count === 0) {
    if (readOnly) {
      return <div className="px-2 py-1 text-muted-foreground text-xs">{t("empty")}</div>;
    }
    return (
      <div className="flex items-center gap-1 px-2 py-1">
        <Hint label={t("add")}>
          <button
            type="button"
            ref={(el) => {
              triggerRef.current = el;
            }}
            onClick={() => setPickerOpen(true)}
            className="flex h-6 min-w-6 items-center justify-center gap-1 rounded text-muted-foreground hover:text-foreground transition-colors text-xs focus-visible:outline-2 focus-visible:outline-ring"
            aria-label={t("add")}
          >
            <Paperclip className="h-3.5 w-3.5" aria-hidden="true" />
          </button>
        </Hint>
        {picker}
      </div>
    );
  }

  // ---------------------------------------------------------------------------
  // Rendu : badge + popover
  // ---------------------------------------------------------------------------

  return (
    <>
      <Popover open={open} onOpenChange={setOpen}>
        <PopoverTrigger
          ref={(el: HTMLElement | null) => {
            triggerRef.current = el;
          }}
          aria-label={t("open", { count })}
          className="flex min-h-6 items-center gap-1 px-2 py-1 rounded text-xs font-medium text-foreground hover:bg-accent transition-colors"
        >
          <Paperclip className="h-3 w-3 text-muted-foreground" aria-hidden="true" />
          <span>{t("count", { count })}</span>
        </PopoverTrigger>

        <PopoverContent className="w-80 p-2" sideOffset={6}>
          <ul className="flex flex-col gap-1" aria-label={t("listLabel")}>
            {entries.map((e, pos) => {
              const v = e.norm.value;
              const isMedia = e.norm.kind === "media";
              const mediaId = isMedia ? (e.norm.value as AttachmentValue).mediaId : null;
              const isMissing = mediaId ? missing.has(mediaId) : false;
              const unresolvable = e.norm.kind === "legacy" && !e.norm.resolvable;
              const mime = v.mimeType ?? "";
              const isImage = mime.startsWith("image/");
              const legacyKey = e.norm.kind === "legacy" ? e.norm.value.key : undefined;
              const thumbUrl = isMedia
                ? isImage && !isMissing
                  ? `/api/media/${mediaId}`
                  : undefined
                : legacyKey
                  ? thumbnails.get(legacyKey)
                  : undefined;
              const name = v.filename || t("unnamed");
              const downloadDisabled = isMissing
                ? t("missing")
                : unresolvable
                  ? t("notFound")
                  : undefined;

              return (
                <li
                  key={`${entryId(e)}-${pos}`}
                  className="flex items-center gap-2 rounded p-1 hover:bg-muted/60 transition-colors"
                >
                  <div className="shrink-0 w-12 h-12 flex items-center justify-center rounded overflow-hidden border border-border bg-muted">
                    {thumbUrl ? (
                      // eslint-disable-next-line @next/next/no-img-element
                      <img
                        src={thumbUrl}
                        alt=""
                        className="w-12 h-12 object-cover"
                        onError={(ev) => {
                          (ev.target as HTMLImageElement).style.display = "none";
                          if (mediaId) setMissing((prev) => new Set(prev).add(mediaId));
                        }}
                      />
                    ) : isMissing || unresolvable ? (
                      <FileX className="h-5 w-5 text-muted-foreground" aria-hidden="true" />
                    ) : (
                      <FileIcon className="h-5 w-5 text-muted-foreground" aria-hidden="true" />
                    )}
                  </div>

                  <div className="flex-1 min-w-0">
                    <p className="text-xs font-medium truncate text-foreground" title={name}>
                      {name}
                    </p>
                    <p className="text-xs text-muted-foreground">
                      {isMissing ? t("missing") : unresolvable ? t("notFound") : formatSize(v.size ?? 0)}
                    </p>
                  </div>

                  <div className="flex items-center gap-0.5 shrink-0">
                    {!readOnly && (
                      <>
                        <IconButton
                          icon={ChevronUp}
                          label={t("moveUp")}
                          disabledReason={pos === 0 ? t("alreadyFirst") : undefined}
                          onClick={() => handleMove(e, -1)}
                        />
                        <IconButton
                          icon={ChevronDown}
                          label={t("moveDown")}
                          disabledReason={pos === entries.length - 1 ? t("alreadyLast") : undefined}
                          onClick={() => handleMove(e, 1)}
                        />
                      </>
                    )}
                    <IconButton
                      icon={Download}
                      label={t("download")}
                      disabledReason={downloadDisabled}
                      onClick={() => handleDownload(e)}
                    />
                    {!readOnly && (
                      <IconButton
                        icon={X}
                        label={t("remove")}
                        danger
                        onClick={() => handleRemove(e)}
                      />
                    )}
                  </div>
                </li>
              );
            })}
          </ul>

          {!readOnly && (
            <Hint label={limitReason ?? t("add")} className="mt-2 w-full">
              <button
                type="button"
                aria-label={t("add")}
                aria-disabled={limitReason ? true : undefined}
                onClick={() => {
                  if (limitReason) return;
                  setPickerOpen(true);
                }}
                className={`w-full flex items-center justify-center gap-1.5 rounded border border-dashed border-border px-2 py-1.5 text-xs text-muted-foreground hover:text-foreground hover:border-foreground/30 transition-colors focus-visible:outline-2 focus-visible:outline-ring ${
                  limitReason ? "opacity-40 cursor-not-allowed" : ""
                }`}
              >
                <Plus className="h-3.5 w-3.5" aria-hidden="true" />
                {t("add")}
              </button>
            </Hint>
          )}
        </PopoverContent>
      </Popover>
      {picker}
    </>
  );
}
