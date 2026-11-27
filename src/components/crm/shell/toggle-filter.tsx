"use client";

import { useTranslations } from "next-intl";
import { getCrmAction } from "@/lib/crm/actions";
import { CrmActionButton } from "../crm-states";

interface ToggleFilterProps {
  actionId: string;
  pressed: boolean;
  onToggle: () => void;
  /** Info-bulle explicative ; le libellé par défaut. */
  tip?: string;
  /** Raison affichée dans l'info-bulle quand le filtre est indisponible. */
  disabledReason?: string;
}

/** Filtre à bascule : bouton du registre avec aria-pressed. */
export function ToggleFilter({ actionId, pressed, onToggle, tip, disabledReason }: ToggleFilterProps) {
  const t = useTranslations("crm");
  const label = t(getCrmAction(actionId).labelKey);
  return (
    <CrmActionButton
      actionId={actionId}
      label={label}
      tip={tip ?? label}
      ariaLabel={label}
      pressed={pressed}
      onClick={onToggle}
      disabledReason={disabledReason}
    />
  );
}
