"use client";

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { useTranslations } from "next-intl";
import { Dialog } from "@base-ui/react/dialog";
import { toast } from "sonner";
import { AlertTriangle, Plus, Send, X } from "lucide-react";
import { Tip } from "@/components/editor/extensions/database-block/row-tip";
import { DialogOverlay, DialogPortal } from "@/components/ui/dialog";
import { cn } from "@/lib/utils";
import { AttachmentPicker } from "./attachment-picker";
import { BodyEditor } from "./body-editor";
import { isValidAddress, RecipientField } from "./recipient-field";
import { FailedToast, SentToast } from "./sent-toast";
import { clearDraft, isMeaningful, readDraft, useComposeDraft, writeDraft, type ComposeDraft } from "./use-compose-draft";
import type { ComposeOptions, FicheMailContext } from "./use-fiche-mails";

export interface ComposeDrawerProps {
  open: boolean;
  onClose: () => void;
  /** Reopens the drawer (same options) once a send has been cancelled. */
  onReopen?: (opts?: ComposeOptions) => void;
  /** Called after a mail was scheduled, to refresh the thread. */
  onSent?: () => void;
  databaseId: string;
  rowId: string;
  context: FicheMailContext;
  replyTo?: ComposeOptions["replyTo"];
  resume?: ComposeOptions["resume"];
}

const stripTags = (html: string) => html.replace(/<[^>]*>/g, "").replace(/&nbsp;/g, " ").trim();

export function composeDraftKey(
  viewer: FicheMailContext["viewer"],
  databaseId: string,
  rowId: string,
  opts?: ComposeOptions,
): string {
  // Scoped by organization and user: a shared browser never shows someone else's draft.
  const base = `${viewer.orgId}:${viewer.userId}:${databaseId}:${rowId}`;
  if (opts?.replyTo) return `${base}:reply:${opts.replyTo.id}`;
  if (opts?.resume) return `${base}:resume:${opts.resume.id}`;
  return base;
}

const withRe = (subject: string) => (/^\s*(re|tr)\s*:/i.test(subject) ? subject : `Re: ${subject}`.trim());

function initialDraft(context: FicheMailContext, opts: ComposeOptions): ComposeDraft {
  const clientKey = crypto.randomUUID();
  const dossierRowId = context.fixedDossierRowId ? null : context.dossiers.length > 1 ? context.defaultDossierRowId : null;
  if (opts.replyTo) {
    const m = opts.replyTo;
    return {
      to: m.direction === "in" ? [m.from] : [...m.to],
      cc: [],
      bcc: [],
      subject: withRe(m.subject),
      bodyHtml: "",
      attachments: [],
      dossierRowId,
      clientKey,
      inReplyToMessageId: m.messageId ?? undefined,
    };
  }
  if (opts.resume) {
    const m = opts.resume;
    return { to: [...m.to], cc: [...m.cc], bcc: [...m.bcc], subject: m.subject, bodyHtml: m.bodyHtml, attachments: [], dossierRowId, clientKey };
  }
  return {
    to: context.contact.email ? [context.contact.email.toLowerCase()] : [],
    cc: [],
    bcc: [],
    subject: "",
    bodyHtml: "",
    attachments: [],
    dossierRowId,
    clientKey,
  };
}

function signatureText(sig: string): string {
  if (!/<[a-z][\s\S]*>/i.test(sig)) return sig.trim();
  try {
    return new DOMParser().parseFromString(sig.replace(/<br\s*\/?>|<\/(p|div)>/gi, "\n"), "text/html").body.textContent?.trim() ?? "";
  } catch {
    return stripTags(sig);
  }
}

export function ComposeDrawer(props: ComposeDrawerProps) {
  const { open, onClose } = props;
  const focusRef = useRef<HTMLElement | null>(null);
  return (
    <Dialog.Root
      open={open}
      onOpenChange={(o) => {
        if (!o) onClose();
      }}
    >
      <DialogPortal>
        <DialogOverlay className="z-[60]" />
        <ComposePopup {...props} focusRef={focusRef} />
      </DialogPortal>
    </Dialog.Root>
  );
}

function ComposePopup(props: ComposeDrawerProps & { focusRef: React.RefObject<HTMLElement | null> }) {
  const t = useTranslations("mailing.compose");
  const opts: ComposeOptions = useMemo(() => ({ replyTo: props.replyTo, resume: props.resume }), [props.replyTo, props.resume]);
  return (
    <Dialog.Popup
      aria-modal="true"
      aria-label={props.replyTo ? t("titleReply") : t("title")}
      initialFocus={props.focusRef}
      className="fixed inset-y-0 right-0 z-[60] flex w-[min(620px,100%)] flex-col border-l border-border bg-background text-foreground shadow-xl outline-none duration-150 data-open:animate-in data-open:slide-in-from-right data-closed:animate-out data-closed:slide-out-to-right"
    >
      <ComposeForm {...props} opts={opts} />
    </Dialog.Popup>
  );
}

function ComposeForm({
  onClose,
  onReopen,
  onSent,
  databaseId,
  rowId,
  context,
  opts,
  focusRef,
}: ComposeDrawerProps & { opts: ComposeOptions; focusRef: React.RefObject<HTMLElement | null> }) {
  const t = useTranslations("mailing.compose");
  const tt = useTranslations("mailing.compose.toast");
  const draftKey = composeDraftKey(context.viewer, databaseId, rowId, opts);
  const { draft: stored, setDraft, clear } = useComposeDraft(draftKey);
  const [form, setForm] = useState<ComposeDraft>(() => readDraft(draftKey) ?? initialDraft(context, opts));
  const [showCc, setShowCc] = useState(() => form.cc.length > 0);
  const [showBcc, setShowBcc] = useState(() => form.bcc.length > 0);
  const [sending, setSending] = useState(false);
  // A draft is only saved after a real edit, never merely because a reply or resume was opened.
  const [touched, setTouched] = useState(false);
  const [pending, setPending] = useState({ to: false, cc: false, bcc: false });
  const [uploading, setUploading] = useState(false);
  const sendingRef = useRef(false);
  const sentRef = useRef(false);
  const toRef = useRef<HTMLInputElement>(null);
  const subjectRef = useRef<HTMLInputElement>(null);

  useEffect(() => {
    focusRef.current = form.to.length === 0 ? toRef.current : subjectRef.current;
    // Only the initial focus target matters.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  // Continuous draft: kept on close, Escape and overlay click alike.
  useEffect(() => {
    if (sentRef.current || !touched) return;
    if (isMeaningful(form)) setDraft(form);
    else clear();
  }, [form, touched, setDraft, clear]);

  const patch = useCallback((p: Partial<ComposeDraft>) => {
    setTouched(true);
    setForm((f) => ({ ...f, ...p }));
  }, []);

  const showDossierSelect = !context.fixedDossierRowId && context.dossiers.length > 1;
  const fixedDossier = context.fixedDossierRowId ? context.dossiers.find((d) => d.rowId === context.fixedDossierRowId) : null;
  const all = [...form.to, ...form.cc, ...form.bcc];

  let disabledReason: string | null = null;
  if (sending) disabledReason = t("sending");
  else if (pending.to || pending.cc || pending.bcc) disabledReason = t("needCommit");
  else if (form.to.length === 0) disabledReason = t("needTo");
  else if (all.some((a) => !isValidAddress(a))) disabledReason = t("needValid");
  else if (!form.subject.trim()) disabledReason = t("needSubject");
  else if (!stripTags(form.bodyHtml)) disabledReason = t("needBody");
  else if (uploading) disabledReason = t("needUpload");
  else if (context.quota.exceeded) disabledReason = t("quotaReached");

  const submit = useCallback(
    async (payload: ComposeDraft) => {
      if (sendingRef.current) return;
      sendingRef.current = true;
      setSending(true);
      const failure = (message: string, retry: boolean) => {
        sendingRef.current = false;
        setSending(false);
        toast.custom(
          (id) => <FailedToast message={message} onRetry={retry ? () => { toast.dismiss(id); void submit(payload); } : null} onDismiss={() => toast.dismiss(id)} />,
          { duration: Infinity },
        );
      };
      let res: Response;
      try {
        res = await fetch("/api/mail/messages", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({
            clientKey: payload.clientKey,
            databaseId,
            rowId,
            ...(showDossierSelect && payload.dossierRowId ? { dossierRowId: payload.dossierRowId } : {}),
            to: payload.to,
            ...(payload.cc.length ? { cc: payload.cc } : {}),
            ...(payload.bcc.length ? { bcc: payload.bcc } : {}),
            subject: payload.subject.trim(),
            bodyHtml: payload.bodyHtml,
            attachments: payload.attachments,
            ...(payload.inReplyToMessageId ? { inReplyToMessageId: payload.inReplyToMessageId } : {}),
          }),
        });
      } catch {
        failure(tt("failed"), true);
        return;
      }
      if (!res.ok) {
        const body = (await res.json().catch(() => ({}))) as { code?: string; limit?: number | null; detail?: string };
        if (res.status === 429) {
          failure(
            body.code === "quota_abuse" ? tt("quotaAbuse") : typeof body.limit === "number" ? tt("quotaPlan", { limit: body.limit }) : tt("quotaPlanNoLimit"),
            false,
          );
        } else if (body.code === "no_account") failure(tt("noAccount"), false);
        else if (body.code === "account_error") failure(tt("accountError", { detail: body.detail || "?" }), false);
        else if (body.code === "account_unverified") failure(tt("accountUnverified"), false);
        else if (body.code === "invalid_body" || body.code === "dossier_mismatch") failure(tt("invalidBody"), false);
        else if (body.code === "attachment_too_large") failure(tt("attachmentTooLarge"), false);
        else if (body.code === "attachment_missing") failure(tt("attachmentMissing"), false);
        else failure(tt("failed"), true);
        return;
      }
      const sent = (await res.json()) as { id: string; cancelDelaySeconds: number };
      sentRef.current = true;
      clearDraft(draftKey);
      onClose();
      onSent?.();
      const delay = sent.cancelDelaySeconds;
      const undo = async (toastId: string | number) => {
        toast.dismiss(toastId);
        try {
          const r = await fetch(`/api/mail/messages/${sent.id}/cancel`, { method: "POST" });
          if (r.ok) {
            // A new key: the cancelled row still owns the old one.
            writeDraft(draftKey, { ...payload, clientKey: crypto.randomUUID() });
            toast.info(tt("undone"));
            onSent?.();
            onReopen?.(opts);
          } else if (r.status === 409) toast.error(tt("undoLate"));
          else toast.error(tt("undoFailed"));
        } catch {
          toast.error(tt("undoFailed"));
        }
      };
      toast.custom((id) => <SentToast delaySeconds={delay} onUndo={() => void undo(id)} />, { duration: delay * 1000 + 3000 });
    },
    [databaseId, rowId, draftKey, showDossierSelect, onClose, onSent, onReopen, opts, tt],
  );

  function onSend() {
    if (disabledReason) return;
    void submit(form);
  }

  // Attachments of a failed mail cannot be reinjected (no storage key on the client): ask to attach them again.
  const attached = new Set(form.attachments.map((a) => a.fileName));
  const missingAttachments = (opts.resume?.attachments ?? []).map((a) => a.fileName).filter((n) => !attached.has(n));

  const signature = signatureText(context.mailbox.signature);
  const addBtn = (visible: string, label: string, tip: string, on: () => void) => (
    <Tip label={tip}>
      <button
        type="button"
        aria-label={label}
        onClick={on}
        className="inline-flex h-6 cursor-pointer items-center gap-1 rounded-md border border-border bg-background px-1.5 text-xs outline-none hover:bg-muted focus-visible:ring-2 focus-visible:ring-ring"
      >
        <Plus className="size-3" aria-hidden="true" />
        {visible}
      </button>
    </Tip>
  );

  return (
    <>
      <header className="flex h-12 shrink-0 items-center gap-2 border-b border-border bg-muted/40 px-4">
        <Dialog.Title className="flex-1 text-sm font-semibold">{opts.replyTo ? t("titleReply") : t("title")}</Dialog.Title>
        <Tip label={t("closeTip")}>
          <Dialog.Close
            aria-label={t("closeHeader")}
            className="inline-flex size-8 cursor-pointer items-center justify-center rounded-md outline-none hover:bg-muted focus-visible:ring-2 focus-visible:ring-ring"
          >
            <X className="size-4" aria-hidden="true" />
          </Dialog.Close>
        </Tip>
      </header>

      <div className="flex min-h-0 flex-1 flex-col overflow-y-auto">
        <div className="flex min-h-10 items-center gap-3 border-b border-border px-4 py-1.5">
          <span className="w-10 shrink-0 text-xs font-bold text-muted-foreground">{t("from")}</span>
          <span className="truncate text-sm">{context.mailbox.address}</span>
        </div>
        <RecipientField
          label={t("to")}
          inputLabel={t("toInput")}
          value={form.to}
          onChange={(to) => patch({ to })}
          inputRef={toRef}
          onPendingChange={(v) => setPending((p) => ({ ...p, to: v }))}
          trailing={
            <div className="flex shrink-0 items-center gap-1 pt-0.5">
              {!showCc && addBtn(t("cc"), t("addCc"), t("addCcTip"), () => setShowCc(true))}
              {!showBcc && addBtn(t("bcc"), t("addBcc"), t("addBccTip"), () => setShowBcc(true))}
            </div>
          }
        />
        {missingAttachments.length > 0 && (
          <div role="alert" className="flex items-start gap-2 border-b border-amber-300 bg-amber-50 px-4 py-2 text-sm text-amber-900 dark:border-amber-700 dark:bg-amber-950/40 dark:text-amber-200">
            <AlertTriangle className="mt-0.5 size-4 shrink-0" aria-hidden="true" />
            <div className="min-w-0">
              <p>{t("resumeAttachments")}</p>
              <ul className="list-disc pl-5">
                {missingAttachments.map((n) => (
                  <li key={n} className="truncate">{n}</li>
                ))}
              </ul>
            </div>
          </div>
        )}
        {showCc && <RecipientField label={t("cc")} inputLabel={t("ccInput")} value={form.cc} onChange={(cc) => patch({ cc })} onPendingChange={(v) => setPending((p) => ({ ...p, cc: v }))} />}
        {showBcc && <RecipientField label={t("bcc")} inputLabel={t("bccInput")} value={form.bcc} onChange={(bcc) => patch({ bcc })} onPendingChange={(v) => setPending((p) => ({ ...p, bcc: v }))} />}
        <div className="flex min-h-10 items-center gap-3 border-b border-border px-4 py-1.5">
          <label htmlFor="compose-subject" className="w-10 shrink-0 text-xs font-bold text-muted-foreground">{t("subject")}</label>
          <input
            id="compose-subject"
            ref={subjectRef}
            type="text"
            value={form.subject}
            aria-label={t("subject")}
            placeholder={t("subjectPlaceholder")}
            maxLength={255}
            onChange={(e) => patch({ subject: e.target.value })}
            className="h-7 min-w-0 flex-1 rounded-md bg-transparent px-1 text-sm outline-none placeholder:text-muted-foreground focus-visible:ring-2 focus-visible:ring-ring"
          />
        </div>
        <BodyEditor value={form.bodyHtml} onChange={(bodyHtml) => patch({ bodyHtml })} label={t("body")} placeholder={t("bodyPlaceholder")} />
        {signature && (
          <div aria-label={t("signature")} role="group" className="mx-4 mb-3 whitespace-pre-wrap border-t border-border pt-3 text-sm text-muted-foreground">
            {signature}
          </div>
        )}
      </div>

      <AttachmentPicker attachments={form.attachments} onChange={(attachments) => patch({ attachments })} onBusyChange={setUploading} />

      {(showDossierSelect || fixedDossier) && (
        <div className="flex items-center gap-3 border-t border-border px-4 py-2.5 text-sm">
          {showDossierSelect ? (
            <>
              <label htmlFor="compose-dossier" className="text-xs font-bold text-muted-foreground">{t("dossier")}</label>
              <select
                id="compose-dossier"
                aria-label={t("dossier")}
                value={form.dossierRowId ?? ""}
                onChange={(e) => patch({ dossierRowId: e.target.value || null })}
                className="h-8 min-w-0 flex-1 rounded-md border border-border bg-background px-2 text-sm outline-none focus-visible:ring-2 focus-visible:ring-ring"
              >
                {context.dossiers.map((d) => (
                  <option key={d.rowId} value={d.rowId}>{d.title}</option>
                ))}
              </select>
            </>
          ) : (
            <p>{t("dossierFixed", { title: fixedDossier?.title ?? "" })}</p>
          )}
        </div>
      )}

      <footer className="flex shrink-0 items-center gap-2 border-t border-border px-4 py-3">
        <span aria-live="polite" className="flex-1 text-xs text-muted-foreground">
          {stored && isMeaningful(stored) ? t("draftSaved") : ""}
        </span>
        <Tip label={t("closeTip")}>
          <Dialog.Close
            aria-label={t("close")}
            className="inline-flex h-8 cursor-pointer items-center gap-1.5 rounded-md border border-border bg-background px-3 text-sm outline-none hover:bg-muted focus-visible:ring-2 focus-visible:ring-ring"
          >
            <X className="size-4" aria-hidden="true" />
            {t("close")}
          </Dialog.Close>
        </Tip>
        <Tip label={disabledReason ?? t("sendTip")}>
          <button
            type="button"
            aria-label={t("send")}
            aria-disabled={disabledReason ? true : undefined}
            onClick={onSend}
            className={cn(
              "inline-flex h-8 cursor-pointer items-center gap-1.5 rounded-md bg-primary px-3 text-sm font-medium text-primary-foreground outline-none hover:bg-primary/90 focus-visible:ring-2 focus-visible:ring-ring",
              disabledReason && "cursor-not-allowed opacity-50",
            )}
          >
            <Send className="size-4" aria-hidden="true" />
            {t("send")}
          </button>
        </Tip>
      </footer>
    </>
  );
}
