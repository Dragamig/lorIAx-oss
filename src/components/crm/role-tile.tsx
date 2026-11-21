"use client";

import { Briefcase, MessagesSquare, Users, type LucideIcon } from "lucide-react";
import { useTranslations } from "next-intl";
import { Tip } from "@/components/editor/extensions/database-block/row-tip";
import { Link } from "@/i18n/routing";
import { getCrmAction } from "@/lib/crm/actions";
import type { CrmRole } from "@/lib/crm/fields";
import { cn } from "@/lib/utils";
import { CrmActionButton } from "./crm-states";
import type { CrmCandidate, CrmRoleView } from "./use-crm-connection";

const ROLE_ICONS: Record<CrmRole, LucideIcon> = {
  contacts: Users,
  dossiers: Briefcase,
  interactions: MessagesSquare,
};

interface RoleTileProps {
  view: CrmRoleView;
  candidates: CrmCandidate[];
  /** Bases déjà prises par un autre rôle : refusées par le serveur. */
  usedElsewhere: ReadonlySet<string>;
  selected: boolean;
  canAdmin: boolean;
  onSelectRole: () => void;
  onChooseBase: (databaseId: string | null) => void;
  onDissociate: () => void;
}

/** Tuile de rôle : 176 px de haut pour les trois, pied tronqué. */
export function RoleTile({
  view,
  candidates,
  usedElsewhere,
  selected,
  canAdmin,
  onSelectRole,
  onChooseBase,
  onDissociate,
}: RoleTileProps) {
  const t = useTranslations("crm");
  const role = view.role;
  const label = t(`roles.${role}.label`);
  const Icon = ROLE_ICONS[role];
  const complete = view.ok === view.total;
  const options = candidates.some((c) => c.databaseId === view.databaseId) || !view.databaseId
    ? candidates
    : [
        ...candidates,
        { databaseId: view.databaseId, name: view.databaseName ?? "", spaceName: view.spaceName ?? "", columns: [], proposal: {} },
      ];
  const noBase = t("tile.dissociateDisabled");

  return (
    <div
      data-testid="role-tile"
      className={cn(
        "flex h-44 min-w-0 flex-col gap-2 overflow-hidden rounded-lg border bg-card p-3",
        selected ? "border-primary ring-1 ring-primary" : "border-border",
      )}
    >
      <div className="flex min-w-0 items-center gap-2">
        <Icon className="size-4 shrink-0 text-muted-foreground" aria-hidden="true" />
        <span className="truncate text-sm font-semibold">{label}</span>
        <span className="flex-1" />
        <span
          className={cn(
            "shrink-0 rounded px-1.5 py-0.5 text-[11px] font-medium",
            !view.connected
              ? "bg-muted text-muted-foreground"
              : complete
                ? "bg-primary/10 text-primary"
                : "bg-destructive/10 text-destructive",
          )}
        >
          {view.connected ? t("tile.fieldsCount", { ok: String(view.ok), total: String(view.total) }) : t("tile.notConnected")}
        </span>
      </div>
      <p className="truncate text-xs text-muted-foreground">{t(`roles.${role}.description`)}</p>
      <select
        aria-label={t("tile.chooseBaseAria", { role: label })}
        title={canAdmin ? undefined : t("disabled.nonAdmin")}
        disabled={!canAdmin}
        value={view.connected ? (view.databaseId ?? "") : ""}
        onChange={(e) => onChooseBase(e.target.value || null)}
        className="h-7 w-full min-w-0 rounded-md border border-border bg-background px-2 text-xs outline-none focus-visible:ring-2 focus-visible:ring-ring disabled:opacity-60"
      >
        <option value="">{t(getCrmAction("chooseBase").labelKey)}</option>
        {options.map((c) => (
          <option key={c.databaseId} value={c.databaseId} disabled={usedElsewhere.has(c.databaseId)}>
            {t("tile.option", { base: c.name, space: c.spaceName })}
          </option>
        ))}
      </select>
      <p className="truncate text-xs text-muted-foreground">
        {view.connected ? t("tile.space", { space: view.spaceName ?? "" }) : t("tile.noneChosen")}
      </p>
      <div className="mt-auto flex items-center gap-1.5">
        <CrmActionButton
          actionId="showFields"
          label={t("tile.fields")}
          tip={t("tile.fieldsTip")}
          ariaLabel={t("tile.fieldsAria", { role: label })}
          pressed={selected}
          onClick={onSelectRole}
        />
        {view.connected && view.databaseId && (
          <Tip label={t("tile.openInBasesTip")}>
            <Link
              href={`/bases/${view.databaseId}`}
              aria-label={t("tile.openInBasesAria", { role: label })}
              data-action="openInBases"
              className="inline-flex min-h-6 min-w-6 items-center justify-center gap-1.5 rounded-md border border-border bg-background px-2 py-1 text-xs font-medium outline-none transition-colors hover:bg-muted focus-visible:ring-2 focus-visible:ring-ring"
            >
              {(() => {
                const OpenIcon = getCrmAction("openInBases").icon;
                return <OpenIcon className="size-3.5" aria-hidden="true" />;
              })()}
              <span className="truncate">{t("tile.openInBases")}</span>
            </Link>
          </Tip>
        )}
        <span className="flex-1" />
        <CrmActionButton
          actionId="dissociateRole"
          tip={t("tile.dissociateTip")}
          ariaLabel={t("tile.dissociateAria", { role: label })}
          onClick={onDissociate}
          disabledReason={!view.connected ? noBase : !canAdmin ? t("disabled.nonAdmin") : undefined}
        />
      </div>
    </div>
  );
}
