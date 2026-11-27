"use client";

import { AlertTriangle, List, Webhook, Zap } from "lucide-react";
import { useTranslations } from "next-intl";
import { Tip } from "@/components/editor/extensions/database-block/row-tip";
import { Link } from "@/i18n/routing";
import { getCrmAction } from "@/lib/crm/actions";
import { Tag } from "./activation-role-tile";

export interface ActivationAutomationsRecapProps {
  /** Clés des automatismes d'exemple créés. */
  created: string[];
  /** Clés des exemples non créés faute de prérequis. */
  skipped: string[];
  /** Libellés (déjà localisés) ajoutés à la colonne Statut. */
  statusOptionsAdded: string[];
  automationsHref: string;
}

const ROW = "flex min-h-11 flex-wrap items-center gap-x-3 gap-y-1 border-b border-border px-3 py-2 text-[13px] last:border-b-0";

/** Récapitulatif des automatismes d'exemple créés par l'activation (désactivés). */
export function ActivationAutomationsRecap({ created, skipped, statusOptionsAdded, automationsHref }: ActivationAutomationsRecapProps) {
  const t = useTranslations("crm");
  if (created.length === 0 && skipped.length === 0 && statusOptionsAdded.length === 0) return null;
  const name = (key: string) => t(`template.automations.${key}.name`);
  const open = getCrmAction("openAutomations");
  const OpenIcon = open.icon;
  const plural = (n: number, base: string) => t(`activation.recap.automations.${base}${n === 1 ? "One" : "Many"}`, { count: String(n) });
  return (
    <section aria-label={t("activation.recap.automations.title")} className="overflow-hidden rounded-xl border border-border">
      <div className="flex h-10 items-center gap-2 border-b border-border px-3">
        <Zap className="size-4 shrink-0" aria-hidden="true" />
        <b className="min-w-0 flex-1 truncate text-sm">{t("activation.recap.automations.title")}</b>
      </div>
      {created.length > 0 && (
        <div className={ROW}>
          <Zap className="size-4 shrink-0 text-muted-foreground" aria-hidden="true" />
          <div className="min-w-0 flex-1 basis-48">
            <b>{plural(created.length, "created")}</b>
            <div className="text-xs text-muted-foreground">{created.map(name).join(", ")}</div>
          </div>
          <Tip label={t(open.tipKey ?? open.labelKey)}>
            <Link
              href={automationsHref}
              data-action={open.id}
              aria-label={t(open.labelKey)}
              className="inline-flex min-h-6 items-center gap-1.5 rounded-md px-1 text-xs font-semibold text-blue-700 underline outline-none focus-visible:ring-2 focus-visible:ring-ring dark:text-blue-300"
            >
              {t(open.labelKey)}
              <OpenIcon className="size-3.5" aria-hidden="true" />
            </Link>
          </Tip>
        </div>
      )}
      {statusOptionsAdded.length > 0 && (
        <div className={ROW}>
          <List className="size-4 shrink-0 text-muted-foreground" aria-hidden="true" />
          <b className="min-w-0 flex-1 basis-48">
            {plural(statusOptionsAdded.length, "options")}
            {t("activation.recap.automations.optionsList", { names: statusOptionsAdded.join(", ") })}
          </b>
        </div>
      )}
      {created.includes("receptionTally") && (
        <div className={ROW}>
          <Webhook className="size-4 shrink-0 text-muted-foreground" aria-hidden="true" />
          <div className="min-w-0 flex-1 basis-48">
            <b>{name("receptionTally")}</b>
            {t("activation.recap.automations.tallyNote")} <Tag tone="warn">{t("activation.recap.automations.toConfigure")}</Tag>
          </div>
        </div>
      )}
      {skipped.length > 0 && (
        <div className="px-3 py-2">
          <div role="alert" className="flex items-start gap-1.5 rounded-md bg-amber-100 px-2 py-1.5 text-xs text-amber-900 dark:bg-amber-950 dark:text-amber-300">
            <AlertTriangle className="mt-0.5 size-3.5 shrink-0" aria-hidden="true" />
            <span>
              <b>{plural(skipped.length, "skipped")}</b>
              {t("activation.recap.automations.skippedNote", { names: skipped.map(name).join(", ") })}
            </span>
          </div>
        </div>
      )}
    </section>
  );
}
