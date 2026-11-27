"use client";

import { useEffect, useState } from "react";
import { useTranslations } from "next-intl";
import { CircleCheck, RotateCcw, Undo2, X } from "lucide-react";
import { Tip } from "@/components/editor/extensions/database-block/row-tip";

/** Toast shown after a send: live countdown of the cancel delay, then a plain "sent". */
export function SentToast({ delaySeconds, onUndo }: { delaySeconds: number; onUndo: () => void }) {
  const t = useTranslations("mailing.compose.toast");
  const [left, setLeft] = useState(delaySeconds);

  useEffect(() => {
    if (left <= 0) return;
    const id = window.setTimeout(() => setLeft((n) => n - 1), 1000);
    return () => window.clearTimeout(id);
  }, [left]);

  const cancellable = delaySeconds > 0 && left > 0;
  return (
    <div role="status" className="flex w-[22rem] max-w-full items-center gap-3 rounded-lg border border-border bg-popover p-3 text-sm text-popover-foreground shadow-lg">
      <CircleCheck className="size-4 shrink-0 text-emerald-600" aria-hidden="true" />
      <span className="min-w-0 flex-1">{cancellable ? t("scheduled", { seconds: left }) : t("sent")}</span>
      {cancellable && (
        <Tip label={t("undoTip")}>
          <button
            type="button"
            aria-label={t("undoLabel")}
            onClick={onUndo}
            className="inline-flex h-7 cursor-pointer items-center gap-1.5 rounded-md border border-border bg-background px-2 text-xs font-medium outline-none hover:bg-muted focus-visible:ring-2 focus-visible:ring-ring"
          >
            <Undo2 className="size-3.5" aria-hidden="true" />
            {t("undo")}
          </button>
        </Tip>
      )}
    </div>
  );
}

export function FailedToast({ message, onRetry, onDismiss }: { message: string; onRetry: (() => void) | null; onDismiss: () => void }) {
  const t = useTranslations("mailing.compose.toast");
  return (
    <div role="alert" className="flex w-[22rem] max-w-full items-center gap-3 rounded-lg border border-destructive/50 bg-popover p-3 text-sm text-popover-foreground shadow-lg">
      <span className="min-w-0 flex-1">{message}</span>
      {onRetry && (
        <Tip label={t("retryTip")}>
          <button
            type="button"
            aria-label={t("retry")}
            onClick={onRetry}
            className="inline-flex h-7 cursor-pointer items-center gap-1.5 rounded-md border border-border bg-background px-2 text-xs font-medium outline-none hover:bg-muted focus-visible:ring-2 focus-visible:ring-ring"
          >
            <RotateCcw className="size-3.5" aria-hidden="true" />
            {t("retry")}
          </button>
        </Tip>
      )}
      <Tip label={t("dismissTip")}>
        <button
          type="button"
          aria-label={t("dismiss")}
          onClick={onDismiss}
          className="inline-flex size-7 cursor-pointer items-center justify-center rounded-md text-xs outline-none hover:bg-muted focus-visible:ring-2 focus-visible:ring-ring"
        >
          <X className="size-4" aria-hidden="true" />
        </button>
      </Tip>
    </div>
  );
}
