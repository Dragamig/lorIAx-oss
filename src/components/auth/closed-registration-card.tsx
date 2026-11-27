"use client";

import { ArrowLeft, Lock } from "lucide-react";
import { useTranslations } from "next-intl";
import { Link } from "@/i18n/routing";
import { buttonVariants } from "@/components/ui/button";
import { Hint } from "@/components/ui/hint";
import { AuthStatusCard } from "./auth-status-card";

export function ClosedRegistrationCard() {
  const t = useTranslations("auth.closed");
  return (
    <AuthStatusCard icon={Lock} title={t("title")}>
      <p className="text-sm text-muted-foreground">{t("body")}</p>
      <Hint label={t("back")} className="w-full">
        <Link
          href="/login"
          aria-label={t("back")}
          className={`${buttonVariants({ size: "lg" })} w-full min-h-8`}
        >
          <ArrowLeft aria-hidden="true" />
          {t("back")}
        </Link>
      </Hint>
    </AuthStatusCard>
  );
}
