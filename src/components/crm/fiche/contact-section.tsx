"use client";

import { useState } from "react";
import { Mail, Phone } from "lucide-react";
import { useTranslations } from "next-intl";
import { toast } from "sonner";
import { CellEditor } from "@/components/editor/extensions/database-block/database-cell-editor";
import type { RelationData } from "@/components/editor/extensions/database-block/use-relation-data";
import type { CellValue, DbColumn } from "@/components/editor/extensions/database-block/types";
import type { DealSheetDto } from "@/lib/crm/deals";
import { CrmActionButton, CrmEmptyBlock } from "../crm-states";

interface Props {
  dto: DealSheetDto;
  relationData: RelationData;
  onOpenContact: () => void;
  onChangeContact: (value: CellValue) => Promise<boolean> | void;
}

function initials(name: string): string {
  return name
    .split(/\s+/)
    .filter(Boolean)
    .slice(0, 2)
    .map((w) => w[0]?.toUpperCase() ?? "")
    .join("");
}

/** Contact lié : ouvrir sa fiche, copier l'e-mail, changer par la cellule relation. */
export function ContactSection({ dto, relationData, onOpenContact, onChangeContact }: Props) {
  const t = useTranslations("crm.fiche.contact");
  const tTitle = useTranslations("crm.fiche");
  const [changing, setChanging] = useState(false);
  const contact = dto.contact;
  const column = dto.contactColumnId ? (dto.columns.find((c) => c.id === dto.contactColumnId) ?? null) : null;
  const writeReason = !dto.canEdit ? tTitle("relance.readOnly") : column === null ? t("changeUnavailable") : undefined;
  const name = contact?.name || tTitle("unnamed");

  async function copy() {
    try {
      await navigator.clipboard.writeText(contact?.email ?? "");
      toast.success(t("copied"));
    } catch {
      toast.error(t("copyError"));
    }
  }

  const changeButton = (
    <CrmActionButton
      actionId="ficheContactChange"
      label={t("change")}
      tip={t("changeTip")}
      ariaLabel={t("changeAria")}
      pressed={changing}
      onClick={() => setChanging((v) => !v)}
      disabledReason={writeReason}
    />
  );

  return (
    <section aria-label={t("title")} data-testid="fiche-contact" className="mb-5">
      <h3 className="mb-2 border-b border-border pb-1 text-xs font-semibold tracking-wide text-muted-foreground uppercase">{t("title")}</h3>
      {contact ? (
        <div className="flex gap-3 rounded-lg border border-border p-3">
          <div
            aria-hidden="true"
            className="flex size-9 shrink-0 items-center justify-center rounded-full bg-muted text-xs font-semibold"
          >
            {initials(name)}
          </div>
          <div className="min-w-0 flex-1 space-y-1">
            <div className="flex items-center gap-2">
              <span className="truncate text-sm font-semibold">{name}</span>
              <span className="shrink-0 rounded border border-border bg-muted px-1.5 text-[10px] font-medium">{t("badge")}</span>
            </div>
            {contact.org && <div className="truncate text-xs text-muted-foreground">{contact.org}</div>}
            {contact.email && (
              <div className="flex items-center gap-1.5 truncate text-xs">
                <Mail className="size-3 shrink-0 text-muted-foreground" aria-hidden="true" />
                {contact.email}
              </div>
            )}
            {contact.phone && (
              <div className="flex items-center gap-1.5 truncate text-xs">
                <Phone className="size-3 shrink-0 text-muted-foreground" aria-hidden="true" />
                {contact.phone}
              </div>
            )}
            <div className="flex flex-wrap gap-1.5 pt-1">
              <CrmActionButton
                actionId="ficheContactOpen"
                label={t("open")}
                tip={t("openTip")}
                ariaLabel={t("openAria", { name })}
                onClick={onOpenContact}
              />
              <CrmActionButton
                actionId="ficheContactCopy"
                label={t("copy")}
                tip={t("copyTip")}
                ariaLabel={t("copyAria", { name })}
                onClick={() => void copy()}
                disabledReason={contact.email ? undefined : t("noEmail")}
              />
              {changeButton}
            </div>
          </div>
        </div>
      ) : (
        <div className="space-y-2">
          <CrmEmptyBlock title={t("none")} body="" />
          <div className="flex justify-center">{changeButton}</div>
        </div>
      )}
      {changing && column && !writeReason && (
        <div className="mt-2 rounded-md border border-input bg-muted">
          <div className="px-2 pt-1 text-xs font-medium text-muted-foreground">{t("changeLabel")}</div>
          <CellEditor
            column={column as unknown as DbColumn}
            value={(dto.row.cells[column.id] ?? null) as CellValue}
            spaceId={dto.spaceId}
            relationData={relationData}
            onChange={async (v) => {
              const ok = await onChangeContact(v);
              if (ok !== false) setChanging(false);
            }}
          />
        </div>
      )}
    </section>
  );
}
