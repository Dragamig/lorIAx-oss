"use client";

import { useState } from "react";
import { useTranslations } from "next-intl";
import { Check, Loader2, X } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Hint } from "@/components/ui/hint";

/**
 * Champ de renommage en place : Entrée enregistre, Échap annule. `onSave`
 * rend `true` si l'enregistrement a réussi (le champ se referme), `false`
 * sinon (le toast d'erreur est déjà affiché, la saisie est conservée).
 */
export function DashboardRenameField({
  initialName,
  onSave,
  onCancel,
}: {
  initialName: string;
  onSave: (name: string) => Promise<boolean>;
  onCancel: () => void;
}) {
  const t = useTranslations("dashboards");
  const [value, setValue] = useState(initialName);
  const [busy, setBusy] = useState(false);
  const trimmed = value.trim();

  async function submit() {
    if (busy || trimmed === "") return;
    if (trimmed === initialName) {
      onCancel();
      return;
    }
    setBusy(true);
    const ok = await onSave(trimmed);
    setBusy(false);
    if (ok) onCancel();
  }

  return (
    <div className="flex items-center gap-1">
      <Input
        autoFocus
        value={value}
        aria-label={t("renameLabel")}
        placeholder={t("newPlaceholder")}
        onChange={(e) => setValue(e.target.value)}
        onKeyDown={(e) => {
          if (e.key === "Enter") {
            e.preventDefault();
            void submit();
          } else if (e.key === "Escape") {
            e.preventDefault();
            onCancel();
          }
        }}
        className="h-8"
      />
      <Hint label={t("renameSave")}>
        <Button
          type="button"
          size="icon-sm"
          aria-label={t("renameSave")}
          disabled={busy || trimmed === ""}
          onClick={() => void submit()}
        >
          {busy ? <Loader2 className="animate-spin" aria-hidden="true" /> : <Check aria-hidden="true" />}
        </Button>
      </Hint>
      <Hint label={t("renameCancel")}>
        <Button type="button" size="icon-sm" variant="ghost" aria-label={t("renameCancel")} onClick={onCancel}>
          <X aria-hidden="true" />
        </Button>
      </Hint>
    </div>
  );
}
