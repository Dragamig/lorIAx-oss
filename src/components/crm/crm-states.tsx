"use client";

import { AlertTriangle, Unlink } from "lucide-react";
import { useTranslations } from "next-intl";
import { Skeleton } from "@/components/ui/skeleton";
import { Tip } from "@/components/editor/extensions/database-block/row-tip";
import { getCrmAction } from "@/lib/crm/actions";
import { cn } from "@/lib/utils";

interface ActionButtonProps {
  actionId: string;
  /** Texte visible ; absent pour un bouton icône seule. */
  label?: string;
  tip: string;
  ariaLabel: string;
  onClick?: () => void;
  pressed?: boolean;
  /** Raison affichée dans l'info-bulle quand le bouton est désactivé. */
  disabledReason?: string;
  className?: string;
  /** Bouton d'un toast : l'info-bulle doit passer au-dessus de la zone des toasts. */
  tipAboveToasts?: boolean;
}

const base =
  "inline-flex min-h-6 min-w-6 items-center justify-center gap-1.5 rounded-md border border-border bg-background px-2 py-1 text-xs font-medium text-foreground outline-none transition-colors hover:bg-muted focus-visible:ring-2 focus-visible:ring-ring aria-pressed:bg-muted aria-disabled:cursor-not-allowed aria-disabled:opacity-50";

/** Bouton d'action CRM : icône du registre, info-bulle au survol et au focus, nom accessible. */
export function CrmActionButton({
  actionId,
  label,
  tip,
  ariaLabel,
  onClick,
  pressed,
  disabledReason,
  className,
  tipAboveToasts,
}: ActionButtonProps) {
  const Icon = getCrmAction(actionId).icon;
  const disabled = !!disabledReason;
  return (
    <Tip label={disabled ? disabledReason : tip} aboveToasts={tipAboveToasts}>
      <button
        type="button"
        aria-label={ariaLabel}
        aria-pressed={pressed}
        aria-disabled={disabled || undefined}
        data-action={actionId}
        className={cn(base, className)}
        onClick={disabled ? undefined : onClick}
      >
        <Icon className="size-3.5" aria-hidden="true" />
        {label}
      </button>
    </Tip>
  );
}

export function CrmLoadingState() {
  const t = useTranslations("crm");
  return (
    <div role="status" aria-label={t("loading")} className="space-y-4 p-6">
      <div className="grid grid-cols-3 gap-4">
        {[0, 1, 2].map((i) => (
          <Skeleton key={i} className="h-44" />
        ))}
      </div>
      <Skeleton className="h-48" />
    </div>
  );
}

export function CrmErrorState({ onRetry }: { onRetry: () => void }) {
  const t = useTranslations("crm");
  return (
    <div className="m-6 flex flex-col items-center gap-3 rounded-lg border border-border p-8 text-center">
      <AlertTriangle className="size-6 text-destructive" aria-hidden="true" />
      <p role="alert" className="text-sm font-medium">
        {t("error.title")}
      </p>
      <CrmActionButton
        actionId="retry"
        label={t(getCrmAction("retry").labelKey)}
        tip={t("error.retryTip")}
        ariaLabel={t(getCrmAction("retry").labelKey)}
        onClick={onRetry}
      />
    </div>
  );
}

export function CrmEmptyBlock({ title, body, className }: { title: string; body: string; className?: string }) {
  return (
    <div className={cn("flex flex-col items-center gap-1 rounded-lg border border-dashed border-border p-6 text-center", className)}>
      <Unlink className="size-5 text-muted-foreground" aria-hidden="true" />
      <p className="text-sm font-medium">{title}</p>
      <p className="text-xs text-muted-foreground">{body}</p>
    </div>
  );
}

interface DisabledStateProps {
  organisation: string;
  canAdmin: boolean;
  onActivate: () => void;
}

export function CrmDisabledState({ organisation, canAdmin, onActivate }: DisabledStateProps) {
  const t = useTranslations("crm");
  return (
    <div className="m-6 flex flex-col items-center gap-3 rounded-lg border border-border p-8 text-center">
      <p className="text-sm font-medium">{t("disabled.title", { organisation })}</p>
      <p className="text-xs text-muted-foreground">{canAdmin ? t("disabled.adminBody") : t("disabled.body")}</p>
      <CrmActionButton
        actionId="activate"
        label={t("disabled.enable")}
        tip={t("disabled.enableTip")}
        ariaLabel={t("disabled.enable")}
        onClick={onActivate}
        disabledReason={canAdmin ? undefined : t("disabled.nonAdmin")}
      />
    </div>
  );
}
