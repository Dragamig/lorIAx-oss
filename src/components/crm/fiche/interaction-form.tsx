"use client";

import { useId, useRef, useState } from "react";
import { useTranslations } from "next-intl";
import { toast } from "sonner";
import { todayIn } from "@/lib/crm/dates";
import type { DealSheetDto } from "@/lib/crm/deals";
import { crmTimezone } from "@/lib/crm/use-crm-data";
import { CrmActionButton, fieldClass } from "../crm-states";
import { postCrm } from "../crm-post";

interface Props {
  dto: DealSheetDto;
  onCreated: () => void;
  onClose: () => void;
}

/** Nouvelle interaction du dossier : type obligatoire, intitulé, date et commentaire (si raccordé). */
export function InteractionForm({ dto, onCreated, onClose }: Props) {
  const t = useTranslations("crm.fiche.interactions");
  const uid = useId();
  const [type, setType] = useState("");
  const [title, setTitle] = useState("");
  const [date, setDate] = useState(() => todayIn(new Date(), crmTimezone()));
  const [note, setNote] = useState("");
  const [error, setError] = useState(false);
  const [busy, setBusy] = useState(false);
  const busyRef = useRef(false);

  async function send(body: Record<string, string>): Promise<void> {
    if (busyRef.current) return;
    busyRef.current = true;
    setBusy(true);
    const res = await postCrm(`/api/crm/deals/${dto.deal.id}/interactions`, body);
    busyRef.current = false;
    setBusy(false);
    if (res.ok) {
      toast.success(t("logged", { title: dto.deal.title }));
      onCreated();
      onClose();
      return;
    }
    toast.error(t("logError"), { action: { label: t("retry"), onClick: () => void send(body) } });
  }

  function submit() {
    if (type === "") return setError(true);
    setError(false);
    const body: Record<string, string> = { type };
    if (title.trim() !== "") body.title = title.trim();
    if (/^\d{4}-\d{2}-\d{2}$/.test(date)) body.date = date;
    if (dto.canNote && note.trim() !== "") body.note = note.trim();
    void send(body);
  }

  return (
    <div
      role="group"
      aria-label={t("form.title")}
      data-testid="fiche-interaction-form"
      aria-busy={busy}
      onKeyDown={(e) => {
        if (e.key === "Escape") {
          e.stopPropagation();
          onClose();
        }
      }}
      className="mb-3 space-y-2 rounded-lg border border-border bg-muted/40 p-3"
    >
      <div className="flex flex-wrap items-start gap-2">
        <div className="flex flex-col gap-1">
          <select
            autoFocus
            value={type}
            aria-label={t("form.type")}
            aria-invalid={error}
            aria-describedby={error ? `${uid}-error` : undefined}
            onChange={(e) => {
              setType(e.target.value);
              setError(false);
            }}
            className={fieldClass}
          >
            <option value="">{t("form.typePlaceholder")}</option>
            {dto.interactionTypes.map((o) => (
              <option key={o} value={o}>
                {o}
              </option>
            ))}
          </select>
          {error && (
            <p id={`${uid}-error`} role="alert" className="text-xs text-destructive">
              {t("form.typeRequired")}
            </p>
          )}
        </div>
        <input
          type="text"
          value={title}
          maxLength={200}
          aria-label={t("form.titleLabel")}
          placeholder={t("form.titlePlaceholder")}
          onChange={(e) => setTitle(e.target.value)}
          onKeyDown={(e) => {
            if (e.key === "Enter" && !e.nativeEvent.isComposing) submit();
          }}
          className={`${fieldClass} min-w-40 flex-1`}
        />
        <input
          type="date"
          value={date}
          aria-label={t("form.dateAria")}
          onChange={(e) => setDate(e.target.value)}
          className={fieldClass}
        />
      </div>
      {dto.canNote && (
        <textarea
          rows={2}
          value={note}
          maxLength={5000}
          aria-label={t("form.note")}
          placeholder={t("form.notePlaceholder")}
          onChange={(e) => setNote(e.target.value)}
          className="max-h-24 min-h-[3.25rem] w-full resize-y rounded-md border border-border bg-background px-2 py-1 text-xs [field-sizing:content] outline-none focus-visible:ring-2 focus-visible:ring-ring"
        />
      )}
      <div className="flex justify-end gap-1.5">
        <CrmActionButton
          actionId="ficheInteractionCancel"
          label={t("form.cancel")}
          tip={t("form.cancelTip")}
          ariaLabel={t("form.cancel")}
          onClick={onClose}
        />
        <CrmActionButton
          actionId="ficheInteractionSave"
          label={t("form.save")}
          tip={t("form.saveTip")}
          ariaLabel={t("form.save")}
          onClick={submit}
          disabledReason={busy ? t("form.saving") : undefined}
        />
      </div>
    </div>
  );
}
