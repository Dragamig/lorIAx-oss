"use client";

import { AlertTriangle } from "lucide-react";
import { useTranslations } from "next-intl";
import { Link } from "@/i18n/routing";
import { Tip } from "@/components/editor/extensions/database-block/row-tip";
import { getCrmAction } from "@/lib/crm/actions";
import type { CrmRole } from "@/lib/crm/fields";
import { useCrmStatus } from "@/lib/crm/use-crm-status";
import { crmButtonClass } from "../crm-states";

interface FieldsNoticeProps {
  role: CrmRole;
  /** Clés des champs exigés par l'écran et inutilisables (non raccordés ou invalides). */
  missing: readonly string[] | undefined;
  className?: string;
}

/**
 * Avis de connexion incomplète, partagé par tous les écrans CRM. Le lien vers le Raccordement
 * n'est proposé qu'aux administrateurs de l'organisation.
 */
export function FieldsNotice({ role, missing, className }: FieldsNoticeProps) {
  const t = useTranslations("crm");
  const tFields = useTranslations(`crm.fields.${role}`);
  const status = useCrmStatus(true);
  if (!missing || missing.length === 0) return null;
  const Icon = getCrmAction("goToRaccordement").icon;
  const names = missing.map((k) => tFields(k)).join(", ");
  return (
    <div
      role="status"
      data-testid="crm-fields-notice"
      className={`flex flex-wrap items-center gap-3 border-b border-border bg-muted/40 px-6 py-2 text-xs ${className ?? ""}`}
    >
      <AlertTriangle className="size-4 shrink-0 text-destructive" aria-hidden="true" />
      <p className="min-w-0 flex-1">
        <span className="font-medium">{t("shell.fieldsMissingTitle", { fields: names })}</span>{" "}
        <span className="text-muted-foreground">
          {status?.canAdmin ? t("shell.fieldsMissingBodyAdmin") : t("shell.fieldsMissingBodyMember")}
        </span>
      </p>
      {status?.canAdmin && (
        <Tip label={t("shell.goToRaccordementTip")}>
          <Link
            href="/crm/raccordement"
            aria-label={t(getCrmAction("goToRaccordement").labelKey)}
            data-action="goToRaccordement"
            className={crmButtonClass}
          >
            <Icon className="size-3.5" aria-hidden="true" />
            {t(getCrmAction("goToRaccordement").labelKey)}
          </Link>
        </Tip>
      )}
    </div>
  );
}
