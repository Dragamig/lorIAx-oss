"use client";

import { useTranslations } from "next-intl";
import { Trash2 } from "lucide-react";
import { ConfirmTemplateDialog } from "./confirm-template-dialog";

export function RetireTemplateDialog({
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
      title={t("removeTitle")}
      body={t("removeBody", { name })}
      confirmLabel={t("removeConfirm")}
      confirmTip={t("removeTemplateTip")}
      confirmIcon={Trash2}
      destructive
      keepTip={t("keepTip")}
      onConfirm={onConfirm}
      onClose={onClose}
    />
  );
}
