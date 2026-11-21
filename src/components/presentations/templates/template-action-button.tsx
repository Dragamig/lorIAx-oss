"use client";

import { useTranslations } from "next-intl";
import { Button } from "@/components/ui/button";
import { Hint } from "@/components/ui/hint";
import { cn } from "@/lib/utils";
import {
  getActionKeys,
  getTemplateAction,
  type TemplateActionId,
} from "./template-actions";

/** Actions dont le libellé ou l'info-bulle attend `{name}`. */
type NameAction = "preview";

interface BaseProps {
  onClick?: () => void;
  /** Libellé alternatif de la même action (ex. `remove`). */
  variant?: string;
  /** Si renseignée, le bouton est désactivé et l'info-bulle donne cette raison. */
  disabledReason?: string;
  /** Bouton à libellé visible (sinon icône seule). */
  showLabel?: boolean;
  className?: string;
}

type Props = BaseProps &
  (
    | { action: NameAction; values: { name: string } & Record<string, string> }
    | { action: Exclude<TemplateActionId, NameAction>; values?: Record<string, string> }
  );

/**
 * Bouton dérivé du registre : icône, `aria-label`, info-bulle au survol et au
 * focus clavier, raison affichée quand il est désactivé.
 */
export function TemplateActionButton({
  action,
  onClick,
  variant,
  values,
  disabledReason,
  showLabel = false,
  className,
}: Props) {
  const t = useTranslations("presentations.templates");
  const def = getTemplateAction(action);
  const { labelKey, tipKey } = getActionKeys(action, variant);
  const Icon = def.icon;
  const label = t(labelKey, values);
  const disabled = Boolean(disabledReason);
  const tip = disabledReason ?? t(tipKey, values);
  const text = def.shortcut ? `${tip} (${def.shortcut})` : tip;
  return (
    <Hint label={text} disabled={disabled}>
      <Button
        type="button"
        variant="ghost"
        size={showLabel ? "sm" : "icon-sm"}
        aria-label={label}
        aria-keyshortcuts={def.shortcut}
        disabled={disabled}
        onClick={onClick}
        className={cn("min-h-6 min-w-6", className)}
      >
        <Icon aria-hidden="true" />
        {showLabel ? <span>{label}</span> : null}
      </Button>
    </Hint>
  );
}
