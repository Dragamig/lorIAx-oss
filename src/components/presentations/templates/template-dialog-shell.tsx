"use client";

import type { ReactNode } from "react";
import { useTranslations } from "next-intl";
import { X } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Dialog, DialogContent, DialogFooter, DialogTitle } from "@/components/ui/dialog";
import { Hint } from "@/components/ui/hint";
import { cn } from "@/lib/utils";

/**
 * Coque commune des boîtes de modèles : titre, bouton Fermer (icône, info-bulle,
 * `aria-label`), focus retenu et Échap gérés par le Dialog applicatif.
 */
export function TemplateDialogShell({
  open,
  onClose,
  title,
  children,
  footer,
  className,
}: {
  open: boolean;
  onClose: () => void;
  title: string;
  children: ReactNode;
  footer?: ReactNode;
  className?: string;
}) {
  const common = useTranslations("common");
  const t = useTranslations("presentations.templates");
  return (
    <Dialog open={open} onOpenChange={(next) => !next && onClose()}>
      <DialogContent showCloseButton={false} className={cn("max-h-[90vh] overflow-y-auto", className)}>
        <div className="flex items-start justify-between gap-2">
          <DialogTitle className="text-base">{title}</DialogTitle>
          <Hint label={t("closeTip")} align="end">
            <Button
              type="button"
              variant="ghost"
              size="icon-sm"
              aria-label={common("close")}
              onClick={onClose}
              className="min-h-6 min-w-6"
            >
              <X aria-hidden="true" />
            </Button>
          </Hint>
        </div>
        {children}
        {footer ? <DialogFooter>{footer}</DialogFooter> : null}
      </DialogContent>
    </Dialog>
  );
}
