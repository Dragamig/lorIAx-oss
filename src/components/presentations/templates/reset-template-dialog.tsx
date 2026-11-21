"use client";

import { useTranslations } from "next-intl";
import { RotateCcw } from "lucide-react";
import { ConfirmTemplateDialog } from "./confirm-template-dialog";

export function ResetTemplateDialog({
  name,
  onConfirm,
  onClose,
}: {
  name: string;
  onConfirm: () => Promise<boolean>;
  onClose: () => void;
}) {
  const t = useTranslations("presentations.templates");
  return (
    <ConfirmTemplateDialog
      title={t("resetTitle", { name })}
      body={t("resetBody", { name })}
      confirmLabel={t("resetConfirm")}
      confirmTip={t("resetTemplateTip")}
      confirmIcon={RotateCcw}
      keepTip={t("keepTip")}
      onConfirm={onConfirm}
      onClose={onClose}
    />
  );
}
