"use client";

import { useState, type ComponentType, type ReactNode } from "react";
import { toast } from "sonner";
import { useTranslations } from "next-intl";
import { AlertTriangle, Check, Eye, EyeOff, Loader2, Mail, Plug, RefreshCw, Save, Trash2, Undo2 } from "lucide-react";
import { Tip } from "@/components/editor/extensions/database-block/row-tip";
import { Input } from "@/components/ui/input";
import { Skeleton } from "@/components/ui/skeleton";
import { Textarea } from "@/components/ui/textarea";
import { cn } from "@/lib/utils";
import type { MailSecurity } from "@/lib/db/schema-mailing";
import { PROVIDERS, detectProvider, getProvider, type ProviderId } from "./providers";
import {
  MailApiError,
  useMailAccount,
  type ClientMailAccount,
  type ConnectionTestResult,
  type MailAccountInput,
} from "./use-mail-account";

const CANCEL_DELAYS = [0, 5, 10, 20, 30] as const;

interface FormState {
  provider: ProviderId;
  address: string;
  password: string;
  displayName: string;
  smtpHost: string;
  smtpPort: string;
  smtpSecurity: MailSecurity;
  imapHost: string;
  imapPort: string;
  imapSecurity: MailSecurity;
  signature: string;
  cancelDelaySeconds: string;
  pollIntervalMinutes: string;
}

function initialForm(a: ClientMailAccount | null): FormState {
  if (!a) {
    return {
      provider: "other",
      address: "",
      password: "",
      displayName: "",
      smtpHost: "",
      smtpPort: "465",
      smtpSecurity: "ssl",
      imapHost: "",
      imapPort: "993",
      imapSecurity: "ssl",
      signature: "",
      cancelDelaySeconds: "10",
      pollIntervalMinutes: "5",
    };
  }
  return {
    provider: detectProvider(a),
    address: a.address,
    password: a.password,
    displayName: a.displayName,
    smtpHost: a.smtpHost,
    smtpPort: String(a.smtpPort),
    smtpSecurity: a.smtpSecurity,
    imapHost: a.imapHost,
    imapPort: String(a.imapPort),
    imapSecurity: a.imapSecurity,
    signature: a.signature,
    cancelDelaySeconds: String(a.cancelDelaySeconds),
    pollIntervalMinutes: String(a.pollIntervalMinutes),
  };
}

const validPort = (v: string) => /^\d+$/.test(v) && Number(v) >= 1 && Number(v) <= 65535;

const btnBase =
  "inline-flex min-h-8 min-w-8 items-center justify-center gap-1.5 rounded-md border border-border bg-background px-3 py-1.5 text-sm font-medium text-foreground outline-none transition-colors hover:bg-muted focus-visible:ring-2 focus-visible:ring-ring aria-disabled:cursor-not-allowed aria-disabled:opacity-50";

interface ActionProps {
  label?: string;
  tip: string;
  ariaLabel: string;
  icon: ComponentType<{ className?: string; "aria-hidden"?: boolean | "true" }>;
  onClick?: () => void;
  /** Raison affichée dans l'info-bulle quand le bouton est désactivé. */
  disabledReason?: string;
  pressed?: boolean;
  primary?: boolean;
  destructive?: boolean;
  className?: string;
}

function Action({ label, tip, ariaLabel, icon: Icon, onClick, disabledReason, pressed, primary, destructive, className }: ActionProps) {
  const disabled = !!disabledReason;
  return (
    <Tip label={disabled ? disabledReason : tip}>
      <button
        type="button"
        aria-label={ariaLabel}
        aria-pressed={pressed}
        aria-disabled={disabled || undefined}
        className={cn(
          btnBase,
          primary && "border-transparent bg-primary text-primary-foreground hover:bg-primary/90",
          destructive && "text-destructive",
          className,
        )}
        onClick={disabled ? undefined : onClick}
      >
        <Icon className="size-4" aria-hidden="true" />
        {label}
      </button>
    </Tip>
  );
}

function Field({ id, label, hint, children, className }: { id: string; label: string; hint?: string; children: ReactNode; className?: string }) {
  return (
    <div className={cn("flex min-w-0 flex-col gap-1.5", className)}>
      <label htmlFor={id} className="text-xs font-medium text-muted-foreground">
        {label}
      </label>
      {children}
      {hint && <span className="text-xs text-muted-foreground">{hint}</span>}
    </div>
  );
}

const selectClass =
  "h-8 w-full rounded-lg border border-input bg-background px-2 text-sm outline-none transition-colors focus-visible:border-ring focus-visible:ring-3 focus-visible:ring-ring/50";

function Section({ title, children }: { title: string; children: ReactNode }) {
  return (
    <section className="space-y-3">
      <h3 className="text-xs font-semibold uppercase tracking-wide text-muted-foreground">{title}</h3>
      {children}
    </section>
  );
}

function StatusBanner({ account, t }: { account: ClientMailAccount; t: ReturnType<typeof useTranslations> }) {
  const base = "flex items-start gap-2 rounded-lg border p-3 text-sm";
  if (account.status === "ok") {
    return (
      <div role="status" className={cn(base, "border-emerald-600/40 bg-emerald-600/10 text-emerald-800 dark:text-emerald-300")}>
        <Check className="mt-0.5 size-4 shrink-0" aria-hidden="true" />
        <span>{t("status.ok")}</span>
      </div>
    );
  }
  if (account.status === "error") {
    return (
      <div role="alert" className={cn(base, "border-destructive/40 bg-destructive/10 text-destructive")}>
        <AlertTriangle className="mt-0.5 size-4 shrink-0" aria-hidden="true" />
        <span className="min-w-0 break-words">{t("status.error", { detail: account.statusMessage || "?" })}</span>
      </div>
    );
  }
  return (
    <div role="status" className={cn(base, "border-amber-600/40 bg-amber-500/10 text-amber-900 dark:text-amber-300")}>
      <AlertTriangle className="mt-0.5 size-4 shrink-0" aria-hidden="true" />
      <span>{t("status.unverified")}</span>
    </div>
  );
}

type TestState =
  | { kind: "idle" }
  | { kind: "running" }
  | { kind: "done"; result: ConnectionTestResult }
  | { kind: "error"; message: string };

function MailboxForm({
  account,
  save,
  remove,
  test,
  refreshStatus,
}: {
  account: ClientMailAccount | null;
  save: (i: MailAccountInput) => Promise<void>;
  remove: () => Promise<void>;
  test: ReturnType<typeof useMailAccount>["test"];
  refreshStatus: () => Promise<void>;
}) {
  const t = useTranslations("mailing.settings");
  const [form, setForm] = useState<FormState>(() => initialForm(account));
  const [showPw, setShowPw] = useState(false);
  const [saving, setSaving] = useState(false);
  const [confirmRemove, setConfirmRemove] = useState(false);
  const [pwNotice, setPwNotice] = useState<string | null>(null);
  const [testState, setTestState] = useState<TestState>({ kind: "idle" });

  const set = <K extends keyof FormState>(key: K, value: FormState[K]) => setForm((f) => ({ ...f, [key]: value }));

  const pickProvider = (id: ProviderId) => {
    const p = getProvider(id);
    setForm((f) => ({
      ...f,
      provider: id,
      ...(p.smtp && p.imap
        ? {
            smtpHost: p.smtp.host,
            smtpPort: String(p.smtp.port),
            smtpSecurity: p.smtp.security,
            imapHost: p.imap.host,
            imapPort: String(p.imap.port),
            imapSecurity: p.imap.security,
          }
        : {}),
    }));
  };

  const serversOk =
    form.address.trim() !== "" &&
    form.smtpHost.trim() !== "" &&
    form.imapHost.trim() !== "" &&
    validPort(form.smtpPort) &&
    validPort(form.imapPort);
  const masked = !!account?.hasPassword && form.password === account.password;
  const hasPassword = masked || form.password.trim() !== "";
  // Mot de passe à transmettre : jamais la valeur masquée, jamais rien d'inventé.
  const passwordToSend = masked || form.password.trim() === "" ? undefined : form.password;

  const connectionInput = () => ({
    address: form.address.trim(),
    smtpHost: form.smtpHost.trim(),
    smtpPort: Number(form.smtpPort),
    smtpSecurity: form.smtpSecurity,
    imapHost: form.imapHost.trim(),
    imapPort: Number(form.imapPort),
    imapSecurity: form.imapSecurity,
    password: passwordToSend,
  });

  const busy = saving || testState.kind === "running";
  const saveDisabled = busy
    ? t("save.disabledBusy")
    : !serversOk
      ? t("save.disabledMissing")
      : !hasPassword && !account
        ? t("save.disabledPassword")
        : undefined;
  const testDisabled =
    testState.kind === "running"
      ? t("test.disabledRunning")
      : saving
        ? t("save.disabledBusy")
        : !serversOk || !hasPassword
          ? t("test.disabledMissing")
          : undefined;

  const askPasswordAgain = () => {
    const message = t("credentials.passwordRetype");
    setPwNotice(message);
    toast.error(message);
    document.getElementById("mail-password")?.focus();
  };

  const doSave = async () => {
    setPwNotice(null);
    setSaving(true);
    try {
      await save({
        ...connectionInput(),
        displayName: form.displayName.trim(),
        signature: form.signature,
        cancelDelaySeconds: Number(form.cancelDelaySeconds),
        pollIntervalMinutes: Number(form.pollIntervalMinutes),
      });
      toast.success(t("save.saved"));
    } catch (e) {
      if (e instanceof MailApiError && e.code === "password_required") askPasswordAgain();
      else if (e instanceof MailApiError && e.code === "rate_limited") toast.error(t("save.rateLimited"));
      else toast.error(t("save.saveFailed"));
    } finally {
      setSaving(false);
    }
  };

  const doTest = async () => {
    setPwNotice(null);
    setTestState({ kind: "running" });
    try {
      const result = await test(connectionInput());
      setTestState({ kind: "done", result });
      void refreshStatus();
      if (result.smtp.ok && result.imap.ok) toast.success(t("test.okTitle"));
      else toast.error(t("test.failTitle"));
    } catch (e) {
      const code = e instanceof MailApiError ? e.code : undefined;
      if (code === "password_required") {
        setTestState({ kind: "idle" });
        askPasswordAgain();
        return;
      }
      const message =
        code === "rate_limited" ? t("test.rateLimited") : t("test.unknownError");
      setTestState({ kind: "error", message });
      toast.error(message);
    }
  };

  const doRemove = async () => {
    try {
      await remove();
      toast.success(t("remove.removed"));
    } catch {
      toast.error(t("remove.removeFailed"));
      setConfirmRemove(false);
    }
  };

  return (
    <div className="grid grid-cols-1 gap-6 lg:grid-cols-[minmax(0,1fr)_16rem]">
      <div className="space-y-6">
        {account && <StatusBanner account={account} t={t} />}
        {!account && (
          <div role="status" className="flex items-start gap-2 rounded-lg border border-border bg-muted/40 p-3 text-sm">
            <AlertTriangle className="mt-0.5 size-4 shrink-0 text-muted-foreground" aria-hidden="true" />
            <span>{t("notConfigured")}</span>
          </div>
        )}

        <Section title={t("provider.title")}>
          <div role="radiogroup" aria-label={t("provider.title")} className="grid grid-cols-2 gap-2 sm:grid-cols-3">
            {PROVIDERS.map((p) => {
              const name = t(`provider.${p.id}`);
              return (
                <Tip key={p.id} label={t("provider.tip", { name })}>
                  <button
                    type="button"
                    role="radio"
                    aria-checked={form.provider === p.id}
                    aria-label={t("provider.aria", { name })}
                    onClick={() => pickProvider(p.id)}
                    className={cn(
                      "flex h-12 min-w-0 items-center gap-2 rounded-lg border px-2.5 text-left text-sm font-medium outline-none transition-colors focus-visible:ring-2 focus-visible:ring-ring",
                      form.provider === p.id ? "border-primary bg-primary/10" : "border-border bg-background hover:bg-muted",
                    )}
                  >
                    <span className="flex h-7 min-w-7 shrink-0 items-center justify-center rounded bg-muted px-1 text-[10px] font-bold">
                      {p.logo}
                    </span>
                    <span className="truncate">{name}</span>
                  </button>
                </Tip>
              );
            })}
          </div>
        </Section>

        <Section title={t("credentials.title")}>
          <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
            <Field id="mail-address" label={t("credentials.address")}>
              <Input
                id="mail-address"
                type="email"
                autoComplete="off"
                value={form.address}
                onChange={(e) => set("address", e.target.value)}
              />
            </Field>
            <Field id="mail-password" label={t("credentials.password")} hint={t("credentials.passwordHint")}>
              <div className="flex items-center gap-2">
                <Input
                  id="mail-password"
                  type={showPw && !masked ? "text" : "password"}
                  autoComplete="new-password"
                  value={form.password}
                  onChange={(e) => {
                    set("password", e.target.value);
                    setPwNotice(null);
                  }}
                  aria-invalid={pwNotice ? true : undefined}
                />
                <Action
                  icon={showPw && !masked ? EyeOff : Eye}
                  ariaLabel={showPw && !masked ? t("credentials.hidePassword") : t("credentials.showPassword")}
                  tip={showPw && !masked ? t("credentials.hidePassword") : t("credentials.showPassword")}
                  pressed={showPw && !masked}
                  disabledReason={masked ? t("credentials.passwordStoredHidden") : undefined}
                  onClick={() => setShowPw((v) => !v)}
                  className="shrink-0 px-2"
                />
              </div>
              {pwNotice && (
                <span role="alert" className="text-xs font-medium text-destructive">
                  {pwNotice}
                </span>
              )}
            </Field>
          </div>
          <Field id="mail-display-name" label={t("credentials.displayName")}>
            <Input
              id="mail-display-name"
              value={form.displayName}
              onChange={(e) => set("displayName", e.target.value)}
            />
          </Field>
        </Section>

        <Section title={t("servers.title")}>
          {(["smtp", "imap"] as const).map((kind) => (
            <div key={kind} className="grid grid-cols-1 gap-3 sm:grid-cols-[minmax(0,1fr)_6rem_9rem]">
              <Field id={`mail-${kind}-host`} label={t(`servers.${kind}Host`)}>
                <Input
                  id={`mail-${kind}-host`}
                  value={form[`${kind}Host`]}
                  onChange={(e) => set(`${kind}Host`, e.target.value)}
                />
              </Field>
              <Field id={`mail-${kind}-port`} label={t("servers.port")}>
                <Input
                  id={`mail-${kind}-port`}
                  inputMode="numeric"
                  value={form[`${kind}Port`]}
                  aria-invalid={!validPort(form[`${kind}Port`]) || undefined}
                  onChange={(e) => set(`${kind}Port`, e.target.value)}
                />
              </Field>
              <Field id={`mail-${kind}-security`} label={t("servers.security")}>
                <select
                  id={`mail-${kind}-security`}
                  className={selectClass}
                  value={form[`${kind}Security`]}
                  onChange={(e) => set(`${kind}Security`, e.target.value as MailSecurity)}
                >
                  <option value="ssl">{t("servers.ssl")}</option>
                  <option value="starttls">{t("servers.starttls")}</option>
                </select>
              </Field>
            </div>
          ))}
        </Section>

        <Section title={t("signature.title")}>
          <Field id="mail-signature" label={t("signature.label")}>
            <Textarea
              id="mail-signature"
              rows={4}
              value={form.signature}
              onChange={(e) => set("signature", e.target.value)}
            />
          </Field>
          <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
            <Field id="mail-cancel-delay" label={t("signature.cancelDelay")} hint={t("signature.cancelDelayHint")}>
              <select
                id="mail-cancel-delay"
                className={selectClass}
                value={form.cancelDelaySeconds}
                onChange={(e) => set("cancelDelaySeconds", e.target.value)}
              >
                {CANCEL_DELAYS.map((s) => (
                  <option key={s} value={String(s)}>
                    {s === 0 ? t("signature.cancelDelayNone") : t("signature.cancelDelaySeconds", { seconds: String(s) })}
                  </option>
                ))}
              </select>
            </Field>
          </div>
        </Section>

        {testState.kind === "running" && (
          <div role="status" className="flex items-center gap-2 rounded-lg border border-border p-3 text-sm">
            <Loader2 className="size-4 animate-spin" aria-hidden="true" />
            <span>{t("test.running", { smtp: form.smtpHost, imap: form.imapHost })}</span>
          </div>
        )}
        {testState.kind === "error" && (
          <div role="alert" className="flex items-start gap-2 rounded-lg border border-destructive/40 bg-destructive/10 p-3 text-sm text-destructive">
            <AlertTriangle className="mt-0.5 size-4 shrink-0" aria-hidden="true" />
            <span>{testState.message}</span>
          </div>
        )}
        {testState.kind === "done" && (
          <TestResult result={testState.result} form={form} t={t} />
        )}

        <div className="flex flex-wrap items-center gap-2">
          <Action
            icon={Plug}
            label={t("test.button")}
            ariaLabel={t("test.button")}
            tip={t("test.tip")}
            disabledReason={testDisabled}
            onClick={() => void doTest()}
          />
          <Action
            icon={saving ? Loader2 : Save}
            label={saving ? t("save.saving") : t("save.button")}
            ariaLabel={t("save.button")}
            tip={t("save.tip")}
            disabledReason={saveDisabled}
            primary
            onClick={() => void doSave()}
          />
          {account && !confirmRemove && (
            <Action
              icon={Trash2}
              label={t("remove.button")}
              ariaLabel={t("remove.button")}
              tip={t("remove.tip")}
              destructive
              className="ml-auto"
              onClick={() => setConfirmRemove(true)}
            />
          )}
          {account && confirmRemove && (
            <span className="ml-auto flex items-center gap-2">
              <Action
                icon={Trash2}
                label={t("remove.confirm")}
                ariaLabel={t("remove.confirm")}
                tip={t("remove.confirmTip")}
                destructive
                onClick={() => void doRemove()}
              />
              <Action
                icon={Undo2}
                label={t("remove.cancel")}
                ariaLabel={t("remove.cancel")}
                tip={t("remove.cancelTip")}
                onClick={() => setConfirmRemove(false)}
              />
            </span>
          )}
        </div>
      </div>

      <aside className="space-y-4">
        <div className="space-y-2 rounded-lg border border-border bg-muted/30 p-3 text-sm">
          <h3 className="text-xs font-semibold uppercase tracking-wide text-muted-foreground">{t("preview.title")}</h3>
          {form.signature.trim() ? (
            <p className="whitespace-pre-wrap">{form.signature}</p>
          ) : (
            <p className="text-muted-foreground">{t("preview.empty")}</p>
          )}
        </div>
      </aside>
    </div>
  );
}

function TestResult({
  result,
  form,
  t,
}: {
  result: ConnectionTestResult;
  form: FormState;
  t: ReturnType<typeof useTranslations>;
}) {
  const ok = result.smtp.ok && result.imap.ok;
  const imapMessage =
    result.imap.ok && typeof result.imap.inboxCount === "number"
      ? `${result.imap.message} (${t("test.inboxCount", { count: String(result.imap.inboxCount) })})`
      : result.imap.message;
  return (
    <div
      role={ok ? "status" : "alert"}
      className={cn(
        "flex items-start gap-2 rounded-lg border p-3 text-sm",
        ok ? "border-emerald-500/40 bg-emerald-500/10" : "border-destructive/40 bg-destructive/10 text-destructive",
      )}
    >
      {ok ? <Check className="mt-0.5 size-4 shrink-0" aria-hidden="true" /> : <AlertTriangle className="mt-0.5 size-4 shrink-0" aria-hidden="true" />}
      <div className="space-y-1">
        <p className="font-semibold">{ok ? t("test.okTitle") : t("test.failTitle")}</p>
        <ul className="list-disc pl-4">
          <li>{t("test.smtpLine", { host: form.smtpHost, port: form.smtpPort, message: result.smtp.message })}</li>
          <li>{t("test.imapLine", { host: form.imapHost, port: form.imapPort, message: imapMessage })}</li>
        </ul>
        {!ok && <p>{t("test.retryHint")}</p>}
      </div>
    </div>
  );
}

export function MailboxSettings() {
  const t = useTranslations("mailing.settings");
  const { account, status, save, remove, test, refreshStatus, reload } = useMailAccount();

  return (
    <div className="space-y-6">
      <h2 className="flex items-center gap-2 text-lg font-semibold">
        <Mail className="size-5" aria-hidden="true" />
        {t("title")}
      </h2>
      {status === "loading" && (
        <div role="status" aria-label={t("loading")} className="space-y-3">
          <Skeleton className="h-12" />
          <Skeleton className="h-24" />
          <Skeleton className="h-40" />
        </div>
      )}
      {status === "error" && (
        <div className="flex flex-col items-center gap-3 rounded-lg border border-border p-8 text-center">
          <AlertTriangle className="size-6 text-destructive" aria-hidden="true" />
          <p role="alert" className="text-sm font-medium">
            {t("error.title")}
          </p>
          <Action icon={RefreshCw} label={t("error.retry")} ariaLabel={t("error.retry")} tip={t("error.retryTip")} onClick={() => void reload()} />
        </div>
      )}
      {status === "ready" && (
        <MailboxForm
          key={account ? `${account.id}:${account.updatedAt}` : "none"}
          account={account}
          save={save}
          remove={remove}
          test={test}
          refreshStatus={refreshStatus}
        />
      )}
    </div>
  );
}
