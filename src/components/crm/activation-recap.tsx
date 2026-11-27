"use client";

import { AlertTriangle, ArrowLeftRight, Briefcase, FolderPlus, LayoutList, MessageCircle, Users, type LucideIcon } from "lucide-react";
import { useTranslations } from "next-intl";
import { CRM_ROLES, type CrmRole } from "@/lib/crm/fields";
import type { ActivationPreview } from "@/lib/crm/preview";
import { addedColumns, candidateOf, RELATION_PAIRS, relationSides, Tag } from "./activation-role-tile";
import { missingBases, type ActivationState } from "./activation-state";

const ROLE_ICONS: Record<CrmRole, LucideIcon> = { contacts: Users, dossiers: Briefcase, interactions: MessageCircle };
const VIEW_KEYS = ["pipeline", "followUps", "all", "mine", "wonThisQuarter"] as const;
const MODE_TONE = { connect: "ok", complete: "warn", create: "new" } as const;

/** Carte de récapitulatif : hauteur fixe, contenu tronqué ou défilant. */
const CARD_CLASS = "flex h-[262px] min-w-0 flex-col overflow-hidden rounded-xl border border-border";

export interface ActivationRecapProps {
  state: ActivationState;
  preview: ActivationPreview;
  orgName: string;
  spaceName: string;
}

export function ActivationRecap({ state, preview, orgName, spaceName }: ActivationRecapProps) {
  const t = useTranslations("crm");
  const missing = new Set(missingBases(state));
  const anyCreate = CRM_ROLES.some((r) => state.roles[r].mode === "create");
  const newSpace = state.spaceId === "create";
  const spaceLabel = t("template.space");

  return (
    <div className="space-y-3">
      <div className="grid gap-3 md:grid-cols-3">
        {CRM_ROLES.map((role) => {
          const RoleIcon = ROLE_ICONS[role];
          const { mode } = state.roles[role];
          const cand = candidateOf(role, state, preview);
          const cols = addedColumns(role, state, preview, t);
          const baseName = mode === "create" ? t(`template.databases.${role}`) : cand?.name ?? t("tile.notConnected");
          const space = mode === "create" ? (newSpace ? t("activation.recap.newSpace", { name: spaceLabel }) : spaceName) : cand?.spaceName ?? "";
          const pairs = RELATION_PAIRS.filter((p) => p.a === role || p.b === role);
          const collided = mode === "create" ? preview.collisions[role][0] : undefined;
          const duplicate = collided && state.spaceId === preview.suggestedSpaceId ? collided : undefined;
          return (
            <section key={role} aria-label={t("activation.recap.roleAria", { role: t(`roles.${role}.label`) })} className={CARD_CLASS}>
              <div className="flex h-12 flex-none items-center gap-2 border-b border-border px-3">
                <RoleIcon className="size-4 shrink-0" aria-hidden="true" />
                <b className="min-w-0 flex-1 truncate text-sm">{t(`roles.${role}.label`)}</b>
                <Tag tone={MODE_TONE[mode]}>{t(`activation.mode.${mode}`)}</Tag>
              </div>
              <div className="min-h-0 flex-1 overflow-auto px-3 py-2 text-[13px]">
                <dl className="grid grid-cols-[84px_1fr] gap-x-2 gap-y-1">
                  <dt className="pt-px text-xs text-muted-foreground">{t("activation.recap.base")}</dt>
                  <dd className="min-w-0 break-words">
                    <b>{baseName}</b> {mode === "create" && <Tag tone="new">{t("activation.recap.newBase")}</Tag>}
                  </dd>
                  <dt className="pt-px text-xs text-muted-foreground">{t("activation.recap.space")}</dt>
                  <dd className="min-w-0 break-words">{space}</dd>
                  <dt className="pt-px text-xs text-muted-foreground">{t("activation.recap.columns")}</dt>
                  <dd className="min-w-0 break-words">
                    {cols.length ? t("activation.recap.columnsAdded", { count: cols.length }) : t("activation.recap.columnsNone")}
                    {mode !== "create" && <div className="text-xs text-muted-foreground">{t("activation.tile.untouched")}</div>}
                    {cols.filter((c) => c.beside).map((c) => (
                      <div key={c.key} className="text-xs text-muted-foreground">
                        {t("activation.recap.besideLine", { column: c.name, name: c.beside!.name, type: t(`types.${c.beside!.type}`) })}
                      </div>
                    ))}
                  </dd>
                  <dt className="pt-px text-xs text-muted-foreground">{t("activation.recap.relations")}</dt>
                  <dd className="min-w-0 break-words">
                    {pairs.map((p) => {
                      const other = p.a === role ? p.b : p.a;
                      const lacking = [p.a, p.b].find((r) => missing.has(r));
                      if (lacking) {
                        return (
                          <div key={p.fieldKey} className="mb-1">
                            <Tag tone="warn">
                              {t("activation.recap.unlinkedRelation", {
                                field: t(`fields.${p.a}.${p.fieldKey}`),
                                role: t(`roles.${lacking}.label`),
                              })}
                            </Tag>
                          </div>
                        );
                      }
                      const s = relationSides(p, state, preview);
                      const left = `${t(`roles.${p.a}.label`)}.${t(`fields.${p.a}.${p.fieldKey}`)}`;
                      const right = `${t(`roles.${p.b}.label`)}.${t(`template.inverseNames.${p.inverseKey}`)}`;
                      const side = (isNew: boolean) => (
                        <Tag tone={isNew ? "new" : "ok"}>{isNew ? t("activation.recap.relationsCreated", { count: 1 }) : t("activation.recap.relationTwinned")}</Tag>
                      );
                      return (
                        <div key={`${p.fieldKey}-${other}`} data-testid="recap-relation-pair" className="mb-1 flex flex-col gap-0.5 rounded-md border border-border px-1.5 py-1 text-xs">
                          <div className="flex min-h-5 items-center gap-1.5">
                            <span className="min-w-0 flex-1 truncate">{left}</span>
                            {side(s.aNew)}
                          </div>
                          <div className="flex items-center pl-0.5 text-muted-foreground" data-testid="recap-relation-swap">
                            <ArrowLeftRight className="size-3.5 shrink-0" aria-hidden="true" />
                          </div>
                          <div className="flex min-h-5 items-center gap-1.5">
                            <span className="min-w-0 flex-1 truncate">{right}</span>
                            {side(s.bNew)}
                          </div>
                        </div>
                      );
                    })}
                  </dd>
                </dl>
                {duplicate && (
                  <div className="mt-2 flex items-start gap-1.5 rounded-md bg-amber-100 px-2 py-1.5 text-xs text-amber-900 dark:bg-amber-950 dark:text-amber-300">
                    <AlertTriangle className="mt-0.5 size-3.5 shrink-0" aria-hidden="true" />
                    <span>{t("activation.recap.duplicateName", { name: duplicate.name, space: spaceName })}</span>
                  </div>
                )}
              </div>
            </section>
          );
        })}
      </div>
      {newSpace && anyCreate && (
        <div className="flex items-start gap-1.5 rounded-md bg-muted px-2 py-1.5 text-xs">
          <FolderPlus className="mt-0.5 size-3.5 shrink-0" aria-hidden="true" />
          <span>{t("activation.recap.spaceCreated", { name: spaceLabel, org: orgName })}</span>
        </div>
      )}
      {state.roles.dossiers.mode === "create" && (
        <div className="rounded-xl border border-border p-3">
          <div className="mb-1.5 flex items-center gap-1.5 text-[11px] font-bold tracking-wide text-muted-foreground uppercase">
            <LayoutList className="size-3.5" aria-hidden="true" />
            {t("activation.recap.views", { base: t("template.databases.dossiers") })}
          </div>
          <ul className="flex flex-wrap gap-1.5">
            {VIEW_KEYS.map((k) => (
              <li key={k} className="inline-flex min-h-6 items-center rounded-full border border-border bg-muted px-2 text-xs">
                {t(`template.views.${k}`)}
              </li>
            ))}
          </ul>
        </div>
      )}
    </div>
  );
}
