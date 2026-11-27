"use client";

import { useTranslations } from "next-intl";
import { CrmActionButton } from "../crm-states";

/** Bouton de la liste Automatisations : choisir (formulaire manquant) ou modifier le formulaire Tally. */
export function TallyFormButton({
  formMissing,
  onClick,
  disabledReason,
}: {
  formMissing: boolean;
  onClick: () => void;
  /** Raison affichée quand l'utilisateur n'a pas le droit de configurer le formulaire. */
  disabledReason?: string;
}) {
  const t = useTranslations("crm.tally.list");
  const tip = formMissing ? t("chooseFormTip") : t("editFormTip");
  return formMissing ? (
    <CrmActionButton actionId="tallyChooseForm" label={t("chooseForm")} tip={tip} ariaLabel={tip} className="min-h-7" disabledReason={disabledReason} onClick={onClick} />
  ) : (
    <CrmActionButton actionId="tallyEditForm" label={t("editForm")} tip={tip} ariaLabel={tip} className="min-h-7" disabledReason={disabledReason} onClick={onClick} />
  );
}
