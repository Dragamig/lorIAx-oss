"use client";

import { useRef, useState } from "react";
import { useTranslations } from "next-intl";
import { useSWRConfig } from "swr";
import type { DealSheetDto } from "@/lib/crm/deals";
import { crmActivityKey } from "@/lib/crm/activity-actions";
import { CrmActionButton } from "../crm-states";
import { ActivityFeed } from "./activity/activity-feed";
import { InteractionForm } from "./interaction-form";

/** Fil d'activité du dossier (interactions, mails, tâches) et ajout d'une interaction. */
export function DealActivity({ dto, onCreated }: { dto: DealSheetDto; onCreated: () => void }) {
  const t = useTranslations("crm.fiche.interactions");
  const { mutate } = useSWRConfig();
  const [adding, setAdding] = useState(false);
  const root = useRef<HTMLDivElement>(null);
  const closeForm = () => {
    setAdding(false);
    root.current?.querySelector<HTMLElement>('[data-action="ficheInteractionAdd"]')?.focus();
  };
  const addReason = !dto.canLog ? (!dto.canEditInteractions ? t("addReadOnly") : t("addUnavailable")) : undefined;
  const created = () => {
    void mutate(crmActivityKey(dto.databaseId, dto.deal.id));
    onCreated();
  };
  return (
    <div ref={root}>
      <ActivityFeed
        databaseId={dto.databaseId}
        rowId={dto.deal.id}
        header={
          <CrmActionButton
            actionId="ficheInteractionAdd"
            label={t("add")}
            tip={t("addTip")}
            ariaLabel={t("addAria", { title: dto.deal.title })}
            pressed={adding}
            onClick={() => setAdding((v) => !v)}
            disabledReason={addReason}
          />
        }
      >
        {adding && !addReason && <InteractionForm dto={dto} onCreated={created} onClose={closeForm} />}
      </ActivityFeed>
    </div>
  );
}
