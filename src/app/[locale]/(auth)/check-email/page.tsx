"use client";

import { Suspense, useEffect, useState } from "react";
import { useSearchParams } from "next/navigation";
import { Mail, Pencil, Send } from "lucide-react";
import { useTranslations } from "next-intl";
import { toast } from "sonner";
import { Link, useRouter } from "@/i18n/routing";
import { Button, buttonVariants } from "@/components/ui/button";
import { Hint } from "@/components/ui/hint";
import { AuthStatusCard, AuthStatusFrame } from "@/components/auth/auth-status-card";

const COOLDOWN_SECONDS = 60;

function CheckEmail() {
  const t = useTranslations("auth.checkEmail");
  const tv = useTranslations("auth.verifyEmail");
  const router = useRouter();
  const email = useSearchParams().get("email");
  const [cooldown, setCooldown] = useState(COOLDOWN_SECONDS);
  const [sending, setSending] = useState(false);

  useEffect(() => {
    if (!email) router.replace("/login");
  }, [email, router]);

  useEffect(() => {
    if (cooldown <= 0) return;
    const id = setTimeout(() => setCooldown((c) => c - 1), 1000);
    return () => clearTimeout(id);
  }, [cooldown]);

  if (!email) return null;

  const blocked = cooldown > 0 || sending;
  const resendLabel = cooldown > 0 ? t("resendCooldown", { seconds: cooldown }) : t("resend");

  async function resend() {
    if (blocked) return;
    setSending(true);
    try {
      const res = await fetch("/api/auth/resend-verification", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ email }),
      });
      if (res.ok) {
        toast.success(t("resendDone"));
        setCooldown(COOLDOWN_SECONDS);
      } else if (res.status === 429) {
        toast.error(tv("tooManyRequests"));
      } else {
        toast.error(tv("networkError"));
      }
    } catch {
      toast.error(tv("networkError"));
    } finally {
      setSending(false);
    }
  }

  return (
    <AuthStatusCard icon={Mail} title={t("title")}>
      <p className="text-sm text-muted-foreground">{t("sentTo")}</p>
      <p className="break-all font-semibold text-foreground">{email}</p>
      <p className="text-xs text-muted-foreground">{t("validity")}</p>
      <div className="flex w-full flex-col gap-2 pt-2">
        <Hint label={resendLabel} disabled={blocked} className="w-full">
          <Button
            size="lg"
            className="w-full min-h-8"
            aria-label={t("resend")}
            aria-disabled={blocked}
            onClick={resend}
          >
            <Send aria-hidden="true" />
            {resendLabel}
          </Button>
        </Hint>
        <Hint label={t("editAddress")} className="w-full">
          <Link
            href="/register"
            aria-label={t("editAddress")}
            className={`${buttonVariants({ variant: "outline", size: "lg" })} w-full min-h-8`}
          >
            <Pencil aria-hidden="true" />
            {t("editAddress")}
          </Link>
        </Hint>
      </div>
    </AuthStatusCard>
  );
}

export default function CheckEmailPage() {
  return (
    <AuthStatusFrame>
      <Suspense fallback={null}>
        <CheckEmail />
      </Suspense>
    </AuthStatusFrame>
  );
}
