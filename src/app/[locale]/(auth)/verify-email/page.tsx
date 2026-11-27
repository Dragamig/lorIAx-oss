"use client";

import { Suspense, useState } from "react";
import { useSearchParams } from "next/navigation";
import { BadgeCheck, ClockAlert, Link2Off, Loader2, LogIn, RefreshCw, Send, WifiOff } from "lucide-react";
import { useTranslations } from "next-intl";
import { toast } from "sonner";
import { Link } from "@/i18n/routing";
import { Button, buttonVariants } from "@/components/ui/button";
import { Hint } from "@/components/ui/hint";
import { AuthStatusCard, AuthStatusFrame } from "@/components/auth/auth-status-card";
import { useVerifyEmail } from "@/hooks/use-verify-email";

function SignInLink({ label }: { label: string }) {
  return (
    <Hint label={label} className="w-full">
      <Link href="/login" aria-label={label} className={`${buttonVariants({ size: "lg" })} w-full min-h-8`}>
        <LogIn aria-hidden="true" />
        {label}
      </Link>
    </Hint>
  );
}

function VerifyEmail() {
  const t = useTranslations("auth.verifyEmail");
  const tc = useTranslations("auth.checkEmail");
  const token = useSearchParams().get("token");
  const { state, retry } = useVerifyEmail(token);
  const [sending, setSending] = useState(false);
  const [requested, setRequested] = useState(false);

  async function requestNewLink() {
    if (sending || !token) return;
    setSending(true);
    try {
      const res = await fetch("/api/auth/resend-verification", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ token }),
      });
      if (res.ok) {
        setRequested(true);
        toast.success(tc("resendDone"));
      } else {
        toast.error(t("networkError"));
      }
    } catch {
      toast.error(t("networkError"));
    } finally {
      setSending(false);
    }
  }

  if (state === "loading") {
    return (
      <AuthStatusCard icon={Loader2} spin title={t("loading")}>
        <div role="status" aria-live="polite" className="sr-only">{t("loading")}</div>
      </AuthStatusCard>
    );
  }

  if (state === "done") {
    return (
      <AuthStatusCard icon={BadgeCheck} tone="ok" title={t("doneTitle")}>
        <p className="text-sm text-muted-foreground">{t("doneBody")}</p>
        <SignInLink label={t("signIn")} />
      </AuthStatusCard>
    );
  }

  if (state === "used") {
    return (
      <AuthStatusCard icon={Link2Off} title={t("usedTitle")}>
        <p className="text-sm text-muted-foreground">{t("usedBody")}</p>
        <SignInLink label={t("signIn")} />
      </AuthStatusCard>
    );
  }

  if (state === "network") {
    return (
      <AuthStatusCard icon={WifiOff} tone="warn" title={t("networkError")}>
        <Hint label={t("networkError")} className="w-full">
          <Button size="lg" className="w-full min-h-8" aria-label={t("networkError")} onClick={retry}>
            <RefreshCw aria-hidden="true" />
            {t("networkError")}
          </Button>
        </Hint>
      </AuthStatusCard>
    );
  }

  return (
    <AuthStatusCard icon={ClockAlert} tone="warn" title={t("expiredTitle")}>
      <p className="text-sm text-muted-foreground">{t("expiredBody")}</p>
      {requested ? (
        <p role="status" className="text-sm font-medium text-foreground">{tc("resendDone")}</p>
      ) : (
        <Hint label={token ? t("newLink") : t("expiredBody")} disabled={sending || !token} className="w-full">
          <Button
            size="lg"
            className="w-full min-h-8"
            aria-label={t("newLink")}
            aria-disabled={sending || !token}
            onClick={requestNewLink}
          >
            {sending ? <Loader2 className="animate-spin" aria-hidden="true" /> : <Send aria-hidden="true" />}
            {t("newLink")}
          </Button>
        </Hint>
      )}
    </AuthStatusCard>
  );
}

export default function VerifyEmailPage() {
  return (
    <AuthStatusFrame>
      <Suspense fallback={null}>
        <VerifyEmail />
      </Suspense>
    </AuthStatusFrame>
  );
}
