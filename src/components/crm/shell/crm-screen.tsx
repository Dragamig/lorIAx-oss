"use client";

import { Link } from "@/i18n/routing";
import { AlertTriangle, Unlink } from "lucide-react";
import { useTranslations } from "next-intl";
import { Skeleton } from "@/components/ui/skeleton";
import { Tip } from "@/components/editor/extensions/database-block/row-tip";
import { getCrmAction } from "@/lib/crm/actions";
import type { CrmRole } from "@/lib/crm/fields";
import { useCrmStatus } from "@/lib/crm/use-crm-status";
import { CrmActionButton } from "../crm-states";
import { FieldsNotice } from "./fields-notice";
import { SourceBar } from "./source-bar";
import { useRoleSource } from "./use-role-source";

export type CrmScreenState = "ready" | "loading" | "error" | "notConnected";

interface CrmScreenProps {
  title: string;
  role?: CrmRole;
  state: CrmScreenState;
  onRetry?: () => void;
  tools?: React.ReactNode;
  /** Champs exigés non utilisables : affiche l'avis de connexion incomplète. */
  missing?: readonly string[];
  children?: React.ReactNode;
}

const linkClass =
  "inline-flex min-h-6 whitespace-nowrap min-w-6 items-center justify-center gap-1.5 rounded-md border border-border bg-background px-2 py-1 text-xs font-medium text-foreground outline-none transition-colors hover:bg-muted focus-visible:ring-2 focus-visible:ring-ring";

/** Lien vers la base du rôle ; absent tant que la base n'est pas connue. */
function BasesLink({ role }: { role?: CrmRole }) {
  const t = useTranslations("crm");
  const Icon = getCrmAction("openInBases").icon;
  const source = useRoleSource(role ?? "dossiers");
  if (!role || source.status !== "connected") return null;
  return (
    <Tip label={t("tile.openInBasesTip")}>
      <Link href={`/bases/${source.databaseId}`} aria-label={t("tile.openInBases")} data-action="openInBases" className={linkClass}>
        <Icon className="size-3.5" aria-hidden="true" />
        {t("tile.openInBases")}
      </Link>
    </Tip>
  );
}

function LoadingBody() {
  const t = useTranslations("crm");
  return (
    <div role="status" aria-label={t("shell.loading")} className="space-y-2 p-6">
      {[0, 1, 2, 3, 4, 5].map((i) => (
        <Skeleton key={i} className="h-11" />
      ))}
    </div>
  );
}

function ErrorBody({ onRetry, role }: { onRetry?: () => void; role?: CrmRole }) {
  const t = useTranslations("crm");
  return (
    <div className="m-6 flex flex-col items-center gap-3 rounded-lg border border-border p-8 text-center">
      <AlertTriangle className="size-6 text-destructive" aria-hidden="true" />
      <p role="alert" className="text-sm font-medium">
        {t("shell.errorTitle")}
      </p>
      <p className="text-xs text-muted-foreground">{t("shell.errorBody")}</p>
      <div className="flex items-center gap-2">
        {onRetry && (
          <CrmActionButton
            actionId="retry"
            label={t(getCrmAction("retry").labelKey)}
            tip={t("shell.errorRetryTip")}
            ariaLabel={t(getCrmAction("retry").labelKey)}
            onClick={onRetry}
          />
        )}
        <BasesLink role={role} />
      </div>
    </div>
  );
}

function NotConnectedBody() {
  const t = useTranslations("crm");
  const canAdmin = useCrmStatus(true)?.canAdmin === true;
  const Icon = getCrmAction("goToRaccordement").icon;
  return (
    <div className="m-6 flex flex-col items-center gap-3 rounded-lg border border-dashed border-border p-8 text-center">
      <Unlink className="size-6 text-muted-foreground" aria-hidden="true" />
      <p className="text-sm font-medium">{t("shell.notConnectedTitle")}</p>
      <p className="text-xs text-muted-foreground">
        {canAdmin ? t("shell.notConnectedBody") : t("shell.notConnectedBodyMember")}
      </p>
      {canAdmin && <Tip label={t("shell.goToRaccordementTip")}>
        <Link
          href="/crm/raccordement"
          aria-label={t(getCrmAction("goToRaccordement").labelKey)}
          data-action="goToRaccordement"
          className={linkClass}
        >
          <Icon className="size-3.5" aria-hidden="true" />
          {t(getCrmAction("goToRaccordement").labelKey)}
        </Link>
      </Tip>}
    </div>
  );
}

/** Cadre commun des écrans CRM : en-tête, barre de source, outils et états. */
export function CrmScreen({ title, role, state, onRetry, tools, missing, children }: CrmScreenProps) {
  return (
    <div className="flex min-h-0 flex-1 flex-col">
      <div className="flex items-start gap-3 border-b border-border px-6 py-4">
        <div className="min-w-0">
          <h1 className="text-lg font-semibold">{title}</h1>
          {role && state !== "notConnected" && <SourceBar role={role} />}
        </div>
        <span className="flex-1" />
        {state === "ready" && tools && <div className="flex flex-wrap items-center gap-2">{tools}</div>}
      </div>
      {state === "loading" && <LoadingBody />}
      {state === "error" && <ErrorBody onRetry={onRetry} role={role} />}
      {state === "notConnected" && <NotConnectedBody />}
      {state === "ready" && role && <FieldsNotice role={role} missing={missing} />}
      {state === "ready" && children}
    </div>
  );
}
