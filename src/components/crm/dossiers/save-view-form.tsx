"use client";

import { useId, useState } from "react";
import { useTranslations } from "next-intl";
import type { ViewScope } from "@/components/bases/view-scope";
import { CrmActionButton, fieldClass } from "../crm-states";

export const VIEW_NAME_MAX = 255;

interface SaveViewFormProps {
  busy: boolean;
  /** Recherche libre active : seule sa part titre est enregistrée. */
  searchActive?: boolean;
  onSave: (name: string, scope: ViewScope) => void;
  onCancel: () => void;
}

/** Nom et portée d'une nouvelle vue ; personnelle par défaut. */
export function SaveViewForm({ busy, searchActive, onSave, onCancel }: SaveViewFormProps) {
  const t = useTranslations("crm.dossiers.form");
  const nameId = useId();
  const scopeId = useId();
  const [name, setName] = useState("");
  const [scope, setScope] = useState<ViewScope>("personal");
  const [touched, setTouched] = useState(false);
  const trimmed = name.trim();
  const error = !trimmed ? t("nameRequired") : trimmed.length > VIEW_NAME_MAX ? t("nameTooLong") : null;

  const submit = () => {
    setTouched(true);
    if (!error && !busy) onSave(trimmed, scope);
  };

  return (
    <form
      aria-label={t("aria")}
      className="mx-6 mt-3 flex flex-wrap items-end gap-3 rounded-lg border border-border bg-muted/30 p-3"
      onSubmit={(e) => {
        e.preventDefault();
        submit();
      }}
      onKeyDown={(e) => {
        // Les touches de la fiche et des raccourcis ne doivent pas fermer le formulaire à l'insu de l'utilisateur.
        if (e.key === "Escape" && !e.nativeEvent.isComposing) {
          e.stopPropagation();
          onCancel();
        }
      }}
    >
      <div className="flex flex-col gap-1">
        <label htmlFor={nameId} className="text-xs text-muted-foreground">
          {t("nameLabel")}
        </label>
        <input
          id={nameId}
          type="text"
          autoFocus
          value={name}
          maxLength={VIEW_NAME_MAX + 1}
          placeholder={t("namePlaceholder")}
          aria-invalid={touched && !!error ? true : undefined}
          aria-describedby={touched && error ? `${nameId}-err` : undefined}
          className={`${fieldClass} w-64`}
          onChange={(e) => setName(e.target.value)}
        />
        {touched && error && (
          <span id={`${nameId}-err`} role="alert" className="text-xs text-destructive">
            {error}
          </span>
        )}
      </div>
      <div className="flex flex-col gap-1">
        <label htmlFor={scopeId} className="text-xs text-muted-foreground">
          {t("scopeLabel")}
        </label>
        <select id={scopeId} value={scope} className={fieldClass} onChange={(e) => setScope(e.target.value as ViewScope)}>
          <option value="personal">{t("scopePersonal")}</option>
          <option value="shared">{t("scopeShared")}</option>
        </select>
      </div>
      {searchActive && (
        <p role="note" className="w-full text-xs text-muted-foreground">
          {t("searchNote")}
        </p>
      )}
      <CrmActionButton
        actionId="dossiersSaveConfirm"
        label={t("confirm")}
        tip={busy ? t("saving") : t("confirmTip")}
        ariaLabel={t("confirm")}
        onClick={submit}
        disabledReason={busy ? t("saving") : undefined}
      />
      <CrmActionButton
        actionId="dossiersSaveCancel"
        label={t("cancel")}
        tip={t("cancelTip")}
        ariaLabel={t("cancel")}
        onClick={onCancel}
      />
    </form>
  );
}
