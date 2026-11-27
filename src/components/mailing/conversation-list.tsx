"use client";

import { useState } from "react";
import { useLocale, useTranslations } from "next-intl";
import { toast } from "sonner";
import { ArrowDown, ArrowUp, ChevronDown, ChevronUp, Copy, Paperclip, Reply, RotateCcw } from "lucide-react";
import { Tip } from "@/components/editor/extensions/database-block/row-tip";
import { cn } from "@/lib/utils";
import type { ComposeOptions, ConversationView, MailDto } from "./use-fiche-mails";

const chip = "inline-flex h-6 max-w-full items-center gap-1 rounded-full bg-muted px-2 text-xs text-muted-foreground";
// Mail envoyé : même paire vert clair / vert sombre que le chip d'échec en ambre (contraste AA en clair et en sombre).
const sentChip = "bg-emerald-100 text-emerald-900 dark:bg-emerald-900/40 dark:text-emerald-200";
const smallBtn =
  "inline-flex h-7 min-w-6 cursor-pointer items-center gap-1.5 rounded-md border border-border bg-background px-2 text-xs text-foreground outline-none hover:bg-muted focus-visible:ring-2 focus-visible:ring-ring";

type Translate = ReturnType<typeof useTranslations>;

function useDate() {
  const locale = useLocale();
  const fmt = new Intl.DateTimeFormat(locale, { day: "numeric", month: "short", hour: "2-digit", minute: "2-digit" });
  return (iso: string) => fmt.format(new Date(iso));
}

function errorLabel(t: Translate, code: NonNullable<MailDto["error"]>) {
  switch (code) {
    case "delivery_unknown":
      return t("errorDeliveryUnknown");
    case "account_missing":
      return t("errorAccountMissing");
    case "quota_exceeded":
      return t("errorQuota");
    case "trace_pending":
      return t("errorTracePending");
    default:
      return t("errorSendFailed");
  }
}

function DirectionIcon({ direction }: { direction: MailDto["direction"] }) {
  const t = useTranslations("mailing.thread");
  const Icon = direction === "out" ? ArrowUp : ArrowDown;
  return (
    <span
      role="img"
      aria-label={direction === "out" ? t("outgoing") : t("incoming")}
      className={cn(
        "inline-flex size-6 shrink-0 items-center justify-center rounded-full",
        direction === "out" ? "bg-sky-100 text-sky-800 dark:bg-sky-900/40 dark:text-sky-200" : "bg-emerald-100 text-emerald-800 dark:bg-emerald-900/40 dark:text-emerald-200",
      )}
    >
      <Icon className="size-3.5" aria-hidden="true" />
    </span>
  );
}

function excerpt(text: string) {
  return text.replace(/\s+/g, " ").trim().slice(0, 160);
}

function MessageBody({ message }: { message: MailDto }) {
  // bodyHtml is already sanitized server side by the DTO (sanitizeMailHtml).
  return message.bodyHtml ? (
    <div className="text-sm leading-relaxed [&_a]:text-primary [&_a]:underline" dangerouslySetInnerHTML={{ __html: message.bodyHtml }} />
  ) : (
    <p className="whitespace-pre-wrap text-sm leading-relaxed">{message.bodyText}</p>
  );
}

function MessageItem({
  message,
  onCompose,
}: {
  message: MailDto;
  onCompose: (opts?: ComposeOptions) => void;
}) {
  const t = useTranslations("mailing.thread");
  const date = useDate();
  const senderAddress = message.direction === "out" ? (message.to[0] ?? message.from) : message.from;
  async function copy() {
    try {
      await navigator.clipboard.writeText(senderAddress);
      toast.success(t("copied"));
    } catch {
      toast.error(t("copyFailed"));
    }
  }
  return (
    <li className="rounded-lg border border-border bg-background p-3">
      <div className="flex items-center gap-2">
        <DirectionIcon direction={message.direction} />
        <span className="min-w-0 flex-1 truncate text-sm font-semibold">{message.subject || t("noSubject")}</span>
        <time className="shrink-0 text-xs text-muted-foreground" dateTime={message.date}>
          {date(message.date)}
        </time>
      </div>
      <dl className="mt-2 grid grid-cols-[auto_1fr] gap-x-3 gap-y-0.5 text-xs text-muted-foreground">
        <dt>{t("from")}</dt>
        <dd className="truncate text-foreground">{message.from}</dd>
        <dt>{t("to")}</dt>
        <dd className="truncate text-foreground">{message.to.join(", ")}</dd>
        {message.cc.length > 0 && (
          <>
            <dt>{t("cc")}</dt>
            <dd className="truncate text-foreground">{message.cc.join(", ")}</dd>
          </>
        )}
      </dl>
      <div className="mt-3">
        <MessageBody message={message} />
      </div>
      {message.status === "scheduled" && <p className="mt-2 text-xs text-muted-foreground">{t("scheduled")}</p>}
      {message.error && (
        <p role={message.error === "trace_pending" ? undefined : "alert"} className="mt-2 text-xs font-medium text-amber-800 dark:text-amber-300">
          {errorLabel(t, message.error)}
        </p>
      )}
      {message.error === "send_failed" && (message.errorReason || message.errorDetail) && (
        <p className="mt-1 break-words text-xs text-amber-800 dark:text-amber-300">
          {message.errorReason === "auth_refused" ? t("errorAuthRefused") : t("errorDetail", { detail: message.errorDetail ?? "" })}
        </p>
      )}
      {message.attachments.length > 0 && (
        <div className="mt-3">
          <p className="mb-1 text-[0.6875rem] font-bold uppercase tracking-wide text-muted-foreground">{t("attachments")}</p>
          <ul className="flex flex-wrap gap-1.5">
            {message.attachments.map((a) => (
              <li key={a.index}>
                <Tip label={t("download", { name: a.fileName })}>
                  <a
                    href={`/api/mail/messages/${message.id}/attachments/${a.index}`}
                    download={a.fileName}
                    aria-label={t("download", { name: a.fileName })}
                    className={cn(chip, "min-h-6 text-foreground outline-none hover:bg-muted/70 focus-visible:ring-2 focus-visible:ring-ring")}
                  >
                    <Paperclip className="size-3.5" aria-hidden="true" />
                    <span className="truncate">{a.fileName}</span>
                  </a>
                </Tip>
              </li>
            ))}
          </ul>
        </div>
      )}
      <div className="mt-3 flex flex-wrap gap-2">
        <Tip label={t("replyTip")}>
          <button type="button" aria-label={t("replyTip")} className={smallBtn} onClick={() => onCompose({ replyTo: message })}>
            <Reply className="size-3.5" aria-hidden="true" />
            {t("reply")}
          </button>
        </Tip>
        {message.status === "failed" && message.error !== "delivery_unknown" && (
          <Tip label={t("resumeTip")}>
            <button type="button" aria-label={t("resumeTip")} className={smallBtn} onClick={() => onCompose({ resume: message })}>
              <RotateCcw className="size-3.5" aria-hidden="true" />
              {t("resume")}
            </button>
          </Tip>
        )}
        <Tip label={t("copyAddressTip")}>
          <button type="button" aria-label={t("copyAddressTip")} className={smallBtn} onClick={() => void copy()}>
            <Copy className="size-3.5" aria-hidden="true" />
            {t("copyAddress")}
          </button>
        </Tip>
      </div>
    </li>
  );
}

function ConversationCard({
  conversation,
  contactName,
  contactEmail,
  mailbox,
  showContact,
  onCompose,
}: {
  conversation: ConversationView;
  contactName: string | null;
  contactEmail: string | null;
  mailbox: string | null;
  showContact: boolean;
  onCompose: (opts?: ComposeOptions) => void;
}) {
  const t = useTranslations("mailing.thread");
  const date = useDate();
  const [open, setOpen] = useState(false);
  const last = conversation.messages[conversation.messages.length - 1];
  const people = [
    ...new Set(
      conversation.messages
        .flatMap((m) => [m.from, ...m.to])
        .filter((a) => a.toLowerCase() !== (mailbox ?? "").toLowerCase())
        .map((a) => (contactEmail && a.toLowerCase() === contactEmail.toLowerCase() && contactName ? contactName : a)),
    ),
  ];
  const names = people.join(", ");
  const contactLabel = people[0] ?? "";
  // The direction chip must not contradict the delivery state: a failed last mail has no "sent" chip.
  const label =
    last.status === "failed"
      ? null
      : last.status === "scheduled"
        ? t("scheduled")
        : last.status === "cancelled"
          ? t("cancelled")
          : last.direction === "out"
          ? t("sent")
          : conversation.unread
            ? t("unread")
            : t("received");
  const sent = last.status !== "failed" && last.status !== "scheduled" && last.status !== "cancelled" && last.direction === "out";
  const failure = [...conversation.messages].reverse().find((m) => m.error)?.error ?? null;
  const attachmentCount = conversation.messages.reduce((n, m) => n + m.attachments.length, 0);
  const toggleLabel = open ? t("collapse") : t("expand");
  const Chevron = open ? ChevronUp : ChevronDown;
  return (
    <li className="rounded-lg border border-border bg-card">
      <Tip label={toggleLabel}>
        <button
          type="button"
          aria-expanded={open}
          aria-label={`${toggleLabel} : ${conversation.subject || t("noSubject")}`}
          onClick={() => setOpen((v) => !v)}
          className="flex h-[5.5rem] w-full cursor-pointer items-start gap-3 rounded-lg p-3 text-left outline-none hover:bg-muted/40 focus-visible:ring-2 focus-visible:ring-ring"
        >
          <DirectionIcon direction={last.direction} />
          <span className="flex min-w-0 flex-1 flex-col gap-0.5">
            <span className="flex items-baseline gap-2">
              <span className="min-w-0 flex-1 truncate text-sm font-semibold">{conversation.subject || t("noSubject")}</span>
              <time className="shrink-0 text-xs text-muted-foreground" dateTime={conversation.lastAt}>
                {date(conversation.lastAt)}
              </time>
            </span>
            <span className="truncate text-sm text-muted-foreground">{excerpt(last.bodyText)}</span>
            <span className="flex min-w-0 items-center gap-2 text-xs text-muted-foreground">
              <span className="min-w-0 truncate">{names}</span>
              {showContact && contactLabel && (
                <span data-testid="contact-pill" className="inline-flex h-[1.375rem] max-w-40 shrink-0 items-center gap-1.5 rounded-full border border-border bg-muted py-0 pl-[3px] pr-2 text-xs text-foreground">
                  <span aria-hidden="true" className="inline-flex size-[1.125rem] items-center justify-center rounded-full bg-primary/15 text-[0.5625rem] font-bold uppercase text-primary">
                    {contactLabel.slice(0, 2)}
                  </span>
                  <span className="truncate">{contactLabel}</span>
                </span>
              )}
              <span className="shrink-0">{t("messages", { count: conversation.messages.length })}</span>
              {label && <span className={cn(chip, "shrink-0", sent && sentChip)}>{label}</span>}
              {attachmentCount > 0 && (
                <span role="img" aria-label={`${t("attachments")} : ${attachmentCount}`} className={cn(chip, "shrink-0")}>
                  <Paperclip className="size-3" aria-hidden="true" />
                  {attachmentCount}
                </span>
              )}
              {failure && (
                <span className={cn(chip, "min-w-0 bg-amber-100 text-amber-900 dark:bg-amber-900/40 dark:text-amber-200")}>
                  <span className="truncate">{errorLabel(t, failure)}</span>
                </span>
              )}
            </span>
          </span>
          <Chevron className="mt-0.5 size-4 shrink-0 text-muted-foreground" aria-hidden="true" />
        </button>
      </Tip>
      {open && (
        <ul className="flex flex-col gap-2 border-t border-border p-3">
          {conversation.messages.map((m) => (
            <MessageItem key={m.id} message={m} onCompose={onCompose} />
          ))}
        </ul>
      )}
    </li>
  );
}

export function ConversationList({
  conversations,
  contactName,
  contactEmail,
  mailbox,
  showContact,
  onCompose,
}: {
  conversations: ConversationView[];
  contactName: string | null;
  contactEmail: string | null;
  mailbox: string | null;
  showContact: boolean;
  onCompose: (opts?: ComposeOptions) => void;
}) {
  return (
    <ul className="flex flex-col gap-2">
      {conversations.map((c) => (
        <ConversationCard
          key={c.threadKey}
          conversation={c}
          contactName={contactName}
          contactEmail={contactEmail}
          mailbox={mailbox}
          showContact={showContact}
          onCompose={onCompose}
        />
      ))}
    </ul>
  );
}
