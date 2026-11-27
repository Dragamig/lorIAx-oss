"use client";

import { useState } from "react";
import { AlertTriangle, Check, ChevronDown, Clock, Loader2, Mail, type LucideIcon } from "lucide-react";
import { useLocale, useTranslations } from "next-intl";
import { toast } from "sonner";
import type { MailActivity, MailStatus } from "@/lib/crm/activity-model";
import { cancelMail, retryMail } from "@/lib/crm/activity-actions";
import { Tip } from "@/components/editor/extensions/database-block/row-tip";
import { cn } from "@/lib/utils";
import { CrmActionButton } from "../../crm-states";

const BADGE: Record<MailStatus, { icon: LucideIcon; tone: string }> = {
  sent: { icon: Check, tone: "text-green-700 dark:text-green-400" },
  scheduled: { icon: Clock, tone: "text-amber-700 dark:text-amber-400" },
  sending: { icon: Loader2, tone: "text-amber-700 dark:text-amber-400" },
  failed: { icon: AlertTriangle, tone: "text-red-700 dark:text-red-400" },
};

const RETRY_ERRORS: Record<string, string> = {
  quota_plan: "mail.retryQuota",
  no_account: "mail.retryNoAccount",
};

const KNOWN_ERRORS = ["delivery_unknown", "account_missing", "quota_exceeded", "send_failed", "trace_pending"];

interface Props {
  item: MailActivity;
  activityKey: string;
}

/** Carte d'un mail du fil d'activité : badge de statut, aperçu dépliable, annulation et réessai. */
export function MailCard({ item, activityKey }: Props) {
  const t = useTranslations("crm.fiche.activity");
  const locale = useLocale();
  const [open, setOpen] = useState(false);
  const [busy, setBusy] = useState<"cancel" | "retry" | null>(null);
  const { mail, status } = item;
  const { icon: BadgeIcon, tone } = BADGE[status];
  const when = (iso: string | null) =>
    iso ? new Intl.DateTimeFormat(locale, { day: "numeric", month: "short", hour: "2-digit", minute: "2-digit" }).format(new Date(iso)) : "";
  const meta =
    status === "scheduled"
      ? t("mail.scheduledFor", { date: when(mail.scheduledAt ?? item.date) })
      : status === "failed"
        ? t("mail.failedAt", { date: when(item.date) })
        : status === "sending"
          ? t("mail.sendingSince", { date: when(item.date) })
          : t("mail.sentAt", { date: when(item.date) });
  const subject = mail.subject || t("mail.subject");
  const toggle = () => setOpen((v) => !v);
  const errorKey = mail.error && KNOWN_ERRORS.includes(mail.error) ? mail.error : "unknown";
  const toggleLabel = open ? t("mail.collapse") : t("mail.expand");

  const run = async (kind: "cancel" | "retry", action: () => Promise<{ ok: boolean; code?: string }>, okKey: string, errKey: (c?: string) => string) => {
    if (busy) return;
    setBusy(kind);
    const res = await action();
    setBusy(null);
    if (res.ok) toast.success(t(okKey));
    else toast.error(t(errKey(res.code)));
  };
  const onCancel = () => run("cancel", () => cancelMail(mail.id, activityKey), "mail.cancelled", () => "mail.cancelError");
  const onRetry = () => run("retry", () => retryMail(mail.id, activityKey), "mail.retried", (c) => RETRY_ERRORS[c ?? ""] ?? "mail.retryError");

  return (
    <li
      data-testid="fiche-mail"
      data-status={status}
      className={cn("rounded-lg border border-border p-2", status === "failed" && "border-red-700/45 dark:border-red-400/45")}
    >
      <div className="flex gap-2">
        <span className="flex size-7 shrink-0 items-center justify-center rounded-md bg-muted" aria-hidden="true">
          <Mail className="size-3.5" />
        </span>
        <div className="min-w-0 flex-1">
          <div className="flex items-center gap-2">
            <Tip label={toggleLabel}>
              <button
                type="button"
                data-action="ficheActivityMailToggle"
                aria-expanded={open}
                aria-label={`${toggleLabel} : ${subject}`}
                onClick={toggle}
                className="flex min-h-6 min-w-0 flex-1 items-center gap-1 rounded-sm text-left text-sm font-medium outline-none focus-visible:ring-2 focus-visible:ring-ring"
              >
                <span className="min-w-0 truncate">{subject}</span>
                <ChevronDown className={cn("size-3.5 shrink-0 transition-transform", open && "rotate-180")} aria-hidden="true" />
              </button>
            </Tip>
            {status === "sending" ? (
              <Tip label={t("mail.sendingTip")}>
                <span tabIndex={0} className={cn("inline-flex shrink-0 items-center gap-1 rounded-sm text-xs font-medium outline-none focus-visible:ring-2 focus-visible:ring-ring", tone)}>
                  <BadgeIcon className="size-3.5" aria-hidden="true" />
                  {t(`mail.badge.${status}`)}
                </span>
              </Tip>
            ) : (
              <span className={cn("inline-flex shrink-0 items-center gap-1 text-xs font-medium", tone)}>
                <BadgeIcon className="size-3.5" aria-hidden="true" />
                {t(`mail.badge.${status}`)}
              </span>
            )}
          </div>
          <div className="truncate text-xs text-muted-foreground">{meta}</div>
          {status === "failed" && mail.error && (
            <div className="mt-1 flex items-start gap-1 text-xs text-red-700 dark:text-red-400">
              <AlertTriangle className="mt-0.5 size-3.5 shrink-0" aria-hidden="true" />
              <span className="line-clamp-2">{t(`mail.errors.${errorKey}`)}</span>
            </div>
          )}
        </div>
        <div className="flex shrink-0 items-start gap-1">
          {status === "scheduled" && (
            <CrmActionButton
              actionId="ficheActivityMailCancel"
              label={t("mail.cancel")}
              tip={t("mail.cancelTip")}
              ariaLabel={t("mail.cancel")}
              onClick={() => void onCancel()}
              busy={busy === "cancel"}
              disabledReason={busy ? t("mail.busyTip") : undefined}
            />
          )}
          {status === "failed" && item.retryable && (
            <CrmActionButton
              actionId="ficheActivityMailRetry"
              label={t("mail.retry")}
              tip={t("mail.retryTip")}
              ariaLabel={t("mail.retry")}
              onClick={() => void onRetry()}
              busy={busy === "retry"}
              disabledReason={busy ? t("mail.busyTip") : undefined}
            />
          )}
        </div>
      </div>
      {open && (
        <dl className="mt-2 space-y-1 rounded-md bg-muted p-2 text-xs">
          <div className="flex gap-2">
            <dt className="w-12 shrink-0 text-muted-foreground">{t("mail.subject")}</dt>
            <dd className="min-w-0 truncate font-medium">{mail.subject}</dd>
          </div>
          <div className="flex gap-2">
            <dt className="w-12 shrink-0 text-muted-foreground">{t("mail.to")}</dt>
            <dd className="min-w-0 truncate">{mail.to.join(", ")}</dd>
          </div>
          {mail.cc.length > 0 && (
            <div className="flex gap-2">
              <dt className="w-12 shrink-0 text-muted-foreground">{t("mail.cc")}</dt>
              <dd className="min-w-0 truncate">{mail.cc.join(", ")}</dd>
            </div>
          )}
          <div className="line-clamp-2 pt-1">{mail.bodyText}</div>
        </dl>
      )}
    </li>
  );
}
