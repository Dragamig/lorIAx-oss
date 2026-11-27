"use client";

import { useEffect, useRef, useState } from "react";
import { useTranslations } from "next-intl";
import { FileText, ImageIcon, Paperclip, X } from "lucide-react";
import { Tip } from "@/components/editor/extensions/database-block/row-tip";
import { cn } from "@/lib/utils";
import type { DraftAttachment } from "./use-compose-draft";

export const MAX_ATTACHMENTS_BYTES = 20 * 1024 * 1024;

interface MediaItem {
  id: string;
  filename: string;
  mimeType: string;
  sizeBytes: number;
  kind: string;
  thumbnailUrl: string | null;
}

const outline =
  "inline-flex h-8 cursor-pointer items-center gap-1.5 rounded-md border border-border bg-background px-2.5 text-xs font-medium text-foreground outline-none hover:bg-muted focus-visible:ring-2 focus-visible:ring-ring aria-disabled:cursor-not-allowed aria-disabled:opacity-50";

const total = (list: DraftAttachment[]) => list.reduce((s, a) => s + a.size, 0);

export interface AttachmentPickerProps {
  attachments: DraftAttachment[];
  onChange: (next: DraftAttachment[]) => void;
  onBusyChange?: (busy: boolean) => void;
}

export function AttachmentPicker({ attachments, onChange, onBusyChange }: AttachmentPickerProps) {
  const t = useTranslations("mailing.compose.attach");
  const fileRef = useRef<HTMLInputElement>(null);
  const [error, setError] = useState<string | null>(null);
  const [uploading, setUploading] = useState(false);
  const [mediaOpen, setMediaOpen] = useState(false);
  const latest = useRef(attachments);
  latest.current = attachments;

  useEffect(() => onBusyChange?.(uploading), [uploading, onBusyChange]);

  async function upload(files: File[]) {
    setError(null);
    setUploading(true);
    try {
      for (const file of files) {
        if (file.size > MAX_ATTACHMENTS_BYTES) {
          setError(t("tooLarge", { name: file.name }));
          continue;
        }
        if (total(latest.current) + file.size > MAX_ATTACHMENTS_BYTES) {
          setError(t("totalTooLarge"));
          continue;
        }
        const form = new FormData();
        form.append("file", file);
        try {
          const res = await fetch("/api/mail/attachments", { method: "POST", body: form });
          if (!res.ok) {
            setError(
              res.status === 413
                ? t("tooLarge", { name: file.name })
                : res.status === 429
                  ? t("uploadRateLimited")
                  : t("uploadFailed", { name: file.name }),
            );
            continue;
          }
          const ref = (await res.json()) as DraftAttachment;
          latest.current = [...latest.current, ref];
          onChange(latest.current);
        } catch {
          setError(t("uploadFailed", { name: file.name }));
        }
      }
    } finally {
      setUploading(false);
    }
  }

  function join(items: MediaItem[]) {
    const next = [...latest.current];
    for (const m of items) {
      if (next.some((a) => a.mediaId === m.id)) continue;
      next.push({ source: "media", mediaId: m.id, storageKey: `media:${m.id}`, fileName: m.filename, mimeType: m.mimeType, size: m.sizeBytes });
    }
    if (total(next) > MAX_ATTACHMENTS_BYTES) {
      setError(t("totalTooLarge"));
      return false;
    }
    setError(null);
    onChange(next);
    return true;
  }

  return (
    <div className="relative flex flex-col gap-2 border-t border-border px-4 py-2.5">
      <div className="flex flex-wrap items-center gap-2">
        <input
          ref={fileRef}
          type="file"
          multiple
          hidden
          aria-label={t("fileInput")}
          onChange={(e) => {
            const files = Array.from(e.target.files ?? []);
            e.target.value = "";
            if (files.length) void upload(files);
          }}
        />
        <Tip label={uploading ? t("uploading") : t("uploadTip")}>
          <button
            type="button"
            aria-label={t("uploadTip")}
            aria-disabled={uploading || undefined}
            onClick={() => !uploading && fileRef.current?.click()}
            className={outline}
          >
            <Paperclip className="size-3.5" aria-hidden="true" />
            {t("upload")}
          </button>
        </Tip>
        <Tip label={t("mediaTip")}>
          <button type="button" aria-label={t("mediaTip")} aria-expanded={mediaOpen} onClick={() => setMediaOpen((v) => !v)} className={outline}>
            <ImageIcon className="size-3.5" aria-hidden="true" />
            {t("media")}
          </button>
        </Tip>
        {attachments.length === 0 && !uploading && <span className="text-xs text-muted-foreground">{t("none")}</span>}
        {uploading && <span role="status" className="text-xs text-muted-foreground">{t("uploading")}</span>}
      </div>
      {attachments.length > 0 && (
        <ul className="flex flex-wrap gap-1.5">
          {attachments.map((a, i) => (
            <li key={`${a.storageKey}:${i}`} className="inline-flex h-6 max-w-full items-center gap-1 rounded-full bg-muted pl-2 pr-1 text-xs">
              <Paperclip className="size-3 shrink-0" aria-hidden="true" />
              <span className="max-w-48 truncate">{a.fileName}</span>
              <Tip label={t("removeTip", { name: a.fileName })}>
                <button
                  type="button"
                  aria-label={t("remove", { name: a.fileName })}
                  onClick={() => onChange(attachments.filter((_, j) => j !== i))}
                  className="inline-flex size-6 cursor-pointer items-center justify-center rounded-full outline-none hover:bg-black/10 focus-visible:ring-2 focus-visible:ring-ring"
                >
                  <X className="size-3" aria-hidden="true" />
                </button>
              </Tip>
            </li>
          ))}
        </ul>
      )}
      {error && <p role="alert" className="text-xs font-medium text-destructive">{error}</p>}
      {mediaOpen && <MediaPanel onClose={() => setMediaOpen(false)} onJoin={(items) => join(items) && setMediaOpen(false)} />}
    </div>
  );
}

function MediaPanel({ onClose, onJoin }: { onClose: () => void; onJoin: (items: MediaItem[]) => void }) {
  const t = useTranslations("mailing.compose.attach");
  const [state, setState] = useState<{ status: "loading" | "ready" | "error"; items: MediaItem[] }>({ status: "loading", items: [] });
  const [nonce, setNonce] = useState(0);
  const [picked, setPicked] = useState<string[]>([]);

  useEffect(() => {
    const ctrl = new AbortController();
    (async () => {
      try {
        const res = await fetch("/api/media?limit=24", { signal: ctrl.signal });
        if (!res.ok) throw new Error("http");
        const body = (await res.json()) as { items: MediaItem[] };
        if (!ctrl.signal.aborted) setState({ status: "ready", items: body.items });
      } catch {
        if (!ctrl.signal.aborted) setState({ status: "error", items: [] });
      }
    })();
    return () => ctrl.abort();
  }, [nonce]);

  const chosen = state.items.filter((m) => picked.includes(m.id));
  const joinDisabled = chosen.length === 0;

  return (
    <div
      role="region"
      aria-label={t("mediaTitle")}
      onKeyDown={(e) => {
        if (e.key === "Escape") {
          e.stopPropagation();
          onClose();
        }
      }}
      className="absolute bottom-full left-4 z-10 mb-1 w-[min(34rem,calc(100%-2rem))] rounded-lg border border-border bg-popover p-3 text-popover-foreground shadow-lg"
    >
      <div className="mb-2 flex items-center">
        <h4 className="flex-1 text-[0.6875rem] font-bold uppercase tracking-wide text-muted-foreground">{t("mediaTitle")}</h4>
        <Tip label={t("mediaClose")}>
          <button type="button" aria-label={t("mediaClose")} onClick={onClose} className="inline-flex size-7 cursor-pointer items-center justify-center rounded-md outline-none hover:bg-muted focus-visible:ring-2 focus-visible:ring-ring">
            <X className="size-4" aria-hidden="true" />
          </button>
        </Tip>
      </div>
      {state.status === "loading" && <p role="status" className="py-6 text-center text-sm text-muted-foreground">{t("mediaLoading")}</p>}
      {state.status === "error" && (
        <div role="alert" className="flex flex-col items-center gap-2 py-4 text-sm">
          <p>{t("mediaError")}</p>
          <button type="button" aria-label={t("mediaRetry")} onClick={() => { setState({ status: "loading", items: [] }); setNonce((n) => n + 1); }} className={outline}>
            {t("mediaRetry")}
          </button>
        </div>
      )}
      {state.status === "ready" && state.items.length === 0 && <p className="py-6 text-center text-sm text-muted-foreground">{t("mediaEmpty")}</p>}
      {state.status === "ready" && state.items.length > 0 && (
        <ul className="grid max-h-60 grid-cols-3 gap-2 overflow-y-auto">
          {state.items.map((m) => {
            const on = picked.includes(m.id);
            const Icon = m.kind === "image" ? ImageIcon : FileText;
            return (
              <li key={m.id}>
                <Tip label={t("mediaPick", { name: m.filename })}>
                  <button
                    type="button"
                    aria-label={t("mediaPick", { name: m.filename })}
                    aria-pressed={on}
                    onClick={() => setPicked((p) => (on ? p.filter((x) => x !== m.id) : [...p, m.id]))}
                    className={cn(
                      "flex h-24 w-full cursor-pointer flex-col gap-1 overflow-hidden rounded-md border p-1.5 text-left outline-none hover:bg-muted focus-visible:ring-2 focus-visible:ring-ring",
                      on ? "border-primary bg-primary/10" : "border-border",
                    )}
                  >
                    <span className="flex h-14 items-center justify-center overflow-hidden rounded bg-muted text-muted-foreground">
                      {m.thumbnailUrl ? (
                        // eslint-disable-next-line @next/next/no-img-element
                        <img src={m.thumbnailUrl} alt="" className="size-full object-cover" />
                      ) : (
                        <Icon className="size-5" aria-hidden="true" />
                      )}
                    </span>
                    <span className="truncate text-xs">{m.filename}</span>
                  </button>
                </Tip>
              </li>
            );
          })}
        </ul>
      )}
      <div className="mt-2 flex justify-end gap-2">
        <Tip label={t("mediaCancel")}>
          <button type="button" aria-label={t("mediaCancel")} onClick={onClose} className={outline}>
            <X className="size-3.5" aria-hidden="true" />
            {t("mediaCancel")}
          </button>
        </Tip>
        <Tip label={joinDisabled ? t("mediaJoinDisabled") : t("mediaJoinTip")}>
          <button
            type="button"
            aria-label={t("mediaJoin", { count: chosen.length })}
            aria-disabled={joinDisabled || undefined}
            onClick={() => !joinDisabled && onJoin(chosen)}
            className={cn(outline, "bg-primary text-primary-foreground hover:bg-primary/90")}
          >
            <Paperclip className="size-3.5" aria-hidden="true" />
            {t("mediaJoin", { count: chosen.length })}
          </button>
        </Tip>
      </div>
    </div>
  );
}
