"use client";

import { useState } from "react";
import { useTranslations } from "next-intl";
import { Loader2, X, type LucideIcon } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Hint } from "@/components/ui/hint";
import { TemplateDialogShell } from "./template-dialog-shell";

/**
 * Modale de confirmation applicative (jamais de `confirm` natif) : Annuler
 * reçoit le focus initial, la confirmation est une action explicite.
 */
export function ConfirmTemplateDialog({
  title,
  body,
  confirmLabel,
  confirmTip,
  confirmIcon: ConfirmIcon,
  destructive,
  onConfirm,
  onClose,
  keepTip,
}: {
  title: string;
  body: string;
  confirmLabel: string;
  confirmTip: string;
  confirmIcon: LucideIcon;
  destructive?: boolean;
  onConfirm: () => Promise<boolean>;
  onClose: () => void;
  keepTip: string;
}) {
  const t = useTranslations("presentations.templates");
  const [busy, setBusy] = useState(false);
  return (
    <TemplateDialogShell
      open
      onClose={onClose}
      title={title}
      footer={
        <>
          <Hint label={keepTip}>
            <Button type="button" variant="outline" aria-label={t("cancel")} onClick={onClose} autoFocus>
              <X aria-hidden="true" />
              {t("cancel")}
            </Button>
          </Hint>
          <Hint label={confirmTip}>
            <Button
              type="button"
              variant={destructive ? "destructive" : "default"}
              aria-label={confirmLabel}
              disabled={busy}
              onClick={async () => {
                setBusy(true);
                await onConfirm();
                onClose();
              }}
            >
              {busy ? <Loader2 className="animate-spin" aria-hidden="true" /> : <ConfirmIcon aria-hidden="true" />}
              {confirmLabel}
            </Button>
          </Hint>
        </>
      }
    >
      <p className="text-sm">{body}</p>
    </TemplateDialogShell>
  );
}
