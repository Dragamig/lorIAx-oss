"use client";

import { useId, useState } from "react";
import { useTranslations } from "next-intl";
import { Loader2, Save, X } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Hint } from "@/components/ui/hint";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import { TemplateDialogShell } from "./template-dialog-shell";

export function SaveAsTemplateDialog({
  initialName,
  onSave,
  onClose,
}: {
  initialName: string;
  onSave: (input: { name: string; description?: string }) => Promise<boolean>;
  onClose: () => void;
}) {
  const t = useTranslations("presentations.templates");
  const id = useId();
  const [name, setName] = useState(initialName);
  const [description, setDescription] = useState("");
  const [busy, setBusy] = useState(false);
  const trimmed = name.trim();
  const canSave = trimmed.length > 0 && !busy;

  const submit = async () => {
    if (!canSave) return;
    setBusy(true);
    const desc = description.trim();
    const ok = await onSave({ name: trimmed, ...(desc ? { description: desc } : {}) });
    if (ok) onClose();
    else setBusy(false);
  };

  return (
    <TemplateDialogShell
      open
      onClose={onClose}
      title={t("saveTitle")}
      footer={
        <>
          <Hint label={t("saveCancelTip")}>
            <Button type="button" variant="outline" aria-label={t("cancel")} onClick={onClose}>
              <X aria-hidden="true" />
              {t("cancel")}
            </Button>
          </Hint>
          <Hint label={trimmed ? t("saveConfirmTip") : t("saveNameRequiredTip")} disabled={!canSave}>
            <Button type="button" aria-label={t("saveConfirm")} disabled={!canSave} onClick={submit}>
              {busy ? <Loader2 className="animate-spin" aria-hidden="true" /> : <Save aria-hidden="true" />}
              {t("saveConfirm")}
            </Button>
          </Hint>
        </>
      }
    >
      <form
        className="grid gap-3"
        onSubmit={(e) => {
          e.preventDefault();
          void submit();
        }}
      >
        <div className="grid gap-1.5">
          <Label htmlFor={`${id}-name`}>{t("nameLabel")}</Label>
          <Input id={`${id}-name`} value={name} onChange={(e) => setName(e.target.value)} autoFocus />
        </div>
        <div className="grid gap-1.5">
          <Label htmlFor={`${id}-desc`}>{t("descriptionLabel")}</Label>
          <Textarea
            id={`${id}-desc`}
            rows={3}
            value={description}
            placeholder={t("descriptionPlaceholder")}
            onChange={(e) => setDescription(e.target.value)}
          />
        </div>
        <p className="text-muted-foreground text-xs">{t("saveHint")}</p>
      </form>
    </TemplateDialogShell>
  );
}
