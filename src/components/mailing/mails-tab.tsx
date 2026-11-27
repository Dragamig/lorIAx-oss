"use client";

import { type KeyboardEvent } from "react";
import { useLocale, useTranslations } from "next-intl";
import { AlertTriangle, Mail, PenLine, RefreshCw, Settings } from "lucide-react";
import { Tip } from "@/components/editor/extensions/database-block/row-tip";
import { cn } from "@/lib/utils";
import { ConversationList } from "./conversation-list";
import { useFicheMails, type ComposeOptions, type FicheMails } from "./use-fiche-mails";

const iconBtn =
  "inline-flex size-8 cursor-pointer items-center justify-center rounded-md border border-border bg-background text-foreground outline-none hover:bg-muted focus-visible:ring-2 focus-visible:ring-ring aria-disabled:cursor-not-allowed aria-disabled:opacity-50";

export interface MailsTabProps {
  databaseId: string;
  rowId: string;
  /** Compose drawer entry point (task 14). */
  onCompose?: (opts?: ComposeOptions) => void;
}

/** Standalone tab: owns its data load. */
export function MailsTab({ databaseId, rowId, onCompose }: MailsTabProps) {
  const mails = useFicheMails(databaseId, rowId, onCompose);
  return <MailsPanel mails={mails} />;
}

/** Presentational tab fed by a (possibly shared) useFicheMails result. */
export function MailsPanel({ mails, hasDraft = false }: { mails: FicheMails; hasDraft?: boolean }) {
  const locale = useLocale();
  const t = useTranslations("mailing.tab");
  const tState = useTranslations("mailing.state");
  const { context, conversations, status, reload, openCompose } = mails;

  const unconfigured = status === "unconfigured";
  const quotaExceeded = Boolean(context?.quota.exceeded);
  const disabledReason = unconfigured ? t("composeDisabled") : quotaExceeded ? t("quotaReached") : null;
  const canCompose = status !== "loading" && status !== "error" && !disabledReason;

  function onKeyDown(e: KeyboardEvent<HTMLDivElement>) {
    if (e.key.toLowerCase() !== "n" || e.ctrlKey || e.metaKey || e.altKey) return;
    const el = e.target as HTMLElement;
    if (el.closest("input, textarea, select, [contenteditable='true']")) return;
    if (!canCompose) return;
    e.preventDefault();
    openCompose();
  }

  const composeBtn = (
    <Tip label={disabledReason ?? t("composeTip")} kbd={disabledReason ? undefined : "N"}>
      <button
        type="button"
        aria-label={t("composeTip")}
        aria-disabled={!canCompose || undefined}
        onClick={canCompose ? () => openCompose() : undefined}
        className="inline-flex h-8 cursor-pointer items-center gap-1.5 rounded-md bg-primary px-3 text-sm font-medium text-primary-foreground outline-none hover:bg-primary/90 focus-visible:ring-2 focus-visible:ring-ring aria-disabled:cursor-not-allowed aria-disabled:opacity-50"
      >
        <PenLine className="size-4" aria-hidden="true" />
        {t("compose")}
        {hasDraft && (
          <span className="rounded-full bg-primary-foreground/20 px-1.5 text-[0.6875rem] font-bold">{t("draftBadge")}</span>
        )}
      </button>
    </Tip>
  );

  return (
    <div className="flex flex-col gap-3 p-3" onKeyDown={onKeyDown}>
      <div className="flex items-center gap-2">
        <h3 className="flex-1 text-[0.6875rem] font-bold uppercase tracking-wide text-muted-foreground">{t("heading")}</h3>
        {composeBtn}
      </div>

      {context?.alert.crmDisconnected && (
        <div role="alert" className="flex items-start gap-2 rounded-lg border border-amber-300 bg-amber-50 p-3 text-sm text-amber-900 dark:border-amber-700 dark:bg-amber-950/40 dark:text-amber-200">
          <AlertTriangle className="mt-0.5 size-4 shrink-0" aria-hidden="true" />
          <span>{t("alertCrmDisconnected")}</span>
        </div>
      )}
      {context && context.alert.pending > 0 && !context.alert.crmDisconnected && (
        <p role="status" className="text-xs text-muted-foreground">{t("alertPending", { count: context.alert.pending })}</p>
      )}
      {unconfigured && (
        <div className="flex flex-wrap items-center gap-2 rounded-lg border border-amber-300 bg-amber-50 p-3 text-sm text-amber-900 dark:border-amber-700 dark:bg-amber-950/40 dark:text-amber-200">
          <AlertTriangle className="size-4 shrink-0" aria-hidden="true" />
          <span className="min-w-0 flex-1">{t("unconfigured")}</span>
          <Tip label={t("settingsLinkTip")}>
            {/* Lien localisé sans le module de navigation next-intl (localePrefix "always") */}
            <a
              href={`/${locale}/settings?tab=mailbox`}
              aria-label={t("settingsLinkTip")}
              className="inline-flex h-7 items-center gap-1.5 rounded-md border border-current px-2 text-xs font-medium outline-none focus-visible:ring-2 focus-visible:ring-ring"
            >
              <Settings className="size-3.5" aria-hidden="true" />
              {t("settingsLink")}
            </a>
          </Tip>
        </div>
      )}
      {!unconfigured && quotaExceeded && (
        <p role="status" className="text-sm text-amber-800 dark:text-amber-300">{t("quotaReached")}</p>
      )}

      {status === "loading" && (
        <div role="status" aria-label={tState("loading")} className="flex flex-col gap-2">
          {[0, 1, 2].map((i) => (
            <div key={i} aria-hidden="true" className="h-[5.5rem] animate-pulse rounded-lg border border-border bg-muted/50" />
          ))}
        </div>
      )}

      {status === "error" && (
        <div role="alert" className="flex flex-col items-start gap-2 rounded-lg border border-destructive/40 p-4">
          <p className="text-sm font-medium">{tState("errorTitle")}</p>
          <Tip label={tState("retryTip")}>
            <button type="button" aria-label={tState("retry")} onClick={reload} className={cn(iconBtn, "w-auto gap-1.5 px-3 text-sm")}>
              <RefreshCw className="size-4" aria-hidden="true" />
              {tState("retry")}
            </button>
          </Tip>
        </div>
      )}

      {status === "empty" && (
        <div className="flex flex-col items-center gap-3 rounded-lg border border-dashed border-border p-8 text-center">
          <Mail className="size-6 text-muted-foreground" aria-hidden="true" />
          <p className="text-sm font-medium">{tState("emptyTitle")}</p>
          <Tip label={disabledReason ?? t("composeTip")}>
            <button
              type="button"
              aria-label={tState("emptyCta")}
              aria-disabled={!canCompose || undefined}
              onClick={canCompose ? () => openCompose() : undefined}
              className="inline-flex h-8 cursor-pointer items-center gap-1.5 rounded-md bg-primary px-3 text-sm font-medium text-primary-foreground outline-none hover:bg-primary/90 focus-visible:ring-2 focus-visible:ring-ring aria-disabled:cursor-not-allowed aria-disabled:opacity-50"
            >
              <PenLine className="size-4" aria-hidden="true" />
              {tState("emptyCta")}
            </button>
          </Tip>
        </div>
      )}

      {(status === "ready" || (unconfigured && conversations.length > 0)) && context && (
        <ConversationList
          conversations={conversations}
          contactName={context.contact.name}
          contactEmail={context.contact.email}
          mailbox={context.mailbox.address}
          showContact={context.role === "dossiers"}
          onCompose={openCompose}
        />
      )}
    </div>
  );
}
