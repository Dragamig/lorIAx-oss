"use client";

import { useState } from "react";
import { useRouter } from "@/i18n/routing";
import { useTranslations } from "next-intl";
import { ActivationDialog } from "./activation-dialog";
import { CrmActionButton } from "./crm-states";

export function CrmDisabled({ organisationName, isAdmin }: { organisationName: string; isAdmin: boolean }) {
  const t = useTranslations("crm");
  const router = useRouter();
  const [open, setOpen] = useState(false);
  return (
    <>
      <div className="m-6 flex flex-col items-center gap-3 rounded-lg border border-border p-8 text-center">
        <p className="text-sm font-medium">{t("disabled.title", { organisation: organisationName })}</p>
        <p className="text-xs text-muted-foreground">{isAdmin ? t("disabled.adminBody") : t("disabled.body")}</p>
        <CrmActionButton
          actionId="activate"
          label={t("disabled.enable")}
          tip={t("disabled.enableTip")}
          ariaLabel={t("disabled.enable")}
          onClick={() => setOpen(true)}
          disabledReason={isAdmin ? undefined : t("disabled.nonAdmin")}
        />
      </div>
      {isAdmin && <ActivationDialog open={open} onOpenChange={setOpen} onDone={() => router.refresh()} />}
    </>
  );
}
