"use client";

import { useState } from "react";
import { useTranslations } from "next-intl";
import { CrmActionButton, fieldClass } from "../crm-states";

interface QuickInteractionProps {
  types: string[];
  onSubmit: (input: { type: string; title: string }) => void;
  onCancel: () => void;
}

/** Saisie en place d'une interaction : type et intitulé obligatoires. */
export function QuickInteraction({ types, onSubmit, onCancel }: QuickInteractionProps) {
  const t = useTranslations("crm.relances");
  const [type, setType] = useState("");
  const [title, setTitle] = useState("");
  const [error, setError] = useState(false);
  const submit = () => {
    if (type === "" || title.trim() === "") return setError(true);
    setError(false);
    onSubmit({ type, title: title.trim() });
  };
  return (
    <div className="flex flex-wrap items-start gap-2 border-t border-dashed border-border bg-muted/40 px-3 py-2">
      <select
        autoFocus
        value={type}
        aria-label={t("log.type")}
        aria-invalid={error && type === ""}
        aria-describedby={error ? "relance-log-error" : undefined}
        onChange={(e) => {
          setType(e.target.value);
          setError(false);
        }}
        className={fieldClass}
      >
        <option value="">{t("log.typePlaceholder")}</option>
        {types.map((o) => (
          <option key={o} value={o}>
            {o}
          </option>
        ))}
      </select>
      <div className="flex min-w-48 flex-1 flex-col gap-1">
        <input
          type="text"
          value={title}
          maxLength={200}
          aria-label={t("log.title")}
          placeholder={t("log.titlePlaceholder")}
          aria-invalid={error && title.trim() === ""}
          aria-describedby={error ? "relance-log-error" : undefined}
          onChange={(e) => {
            setTitle(e.target.value);
            setError(false);
          }}
          onKeyDown={(e) => {
            if (e.key === "Enter" && !e.nativeEvent.isComposing) submit();
            if (e.key === "Escape") onCancel();
          }}
          className={fieldClass}
        />
        {error && (
          <p id="relance-log-error" role="alert" className="text-xs text-destructive">
            {t("log.empty")}
          </p>
        )}
      </div>
      <CrmActionButton
        actionId="relanceLogSave"
        label={t("log.save")}
        tip={t("log.saveTip")}
        ariaLabel={t("log.save")}
        onClick={submit}
      />
      <CrmActionButton
        actionId="relanceLogCancel"
        label={t("log.cancel")}
        tip={t("log.cancelTip")}
        ariaLabel={t("log.cancel")}
        onClick={onCancel}
      />
    </div>
  );
}
