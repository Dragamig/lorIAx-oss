"use client";

import { useEffect, useMemo, useRef, useState } from "react";
import { AlertTriangle, Database, Link2 } from "lucide-react";
import { useTranslations } from "next-intl";
import { CRM_ROLES, type CrmRole } from "@/lib/crm/fields";
import { ActivationAutomationsRecap } from "./activation-automations-recap";
import { takeActivationHandoff, type ActivationHandoff } from "./activation-handoff";
import { CrmActionButton, CrmDisabledState, CrmEmptyBlock, CrmErrorState, CrmLoadingState } from "./crm-states";
import { FieldMapTable } from "./field-map-table";
import { RoleTile } from "./role-tile";
import { useCrmConnection } from "./use-crm-connection";

export function ConnectionScreen({ organisation = "" }: { organisation?: string }) {
  const t = useTranslations("crm");
  const c = useCrmConnection();
  const [picked, setPicked] = useState<CrmRole | null>(null);
  const [handoff, setHandoff] = useState<ActivationHandoff | null>(null);
  const taken = useRef<ActivationHandoff | null | undefined>(undefined);
  useEffect(() => {
    // Une seule lecture, même si l'effet est rejoué (mode strict).
    if (taken.current === undefined) taken.current = takeActivationHandoff();
    setHandoff(taken.current);
  }, []);

  const data = c.data;
  const selected: CrmRole = useMemo(() => {
    if (picked) return picked;
    return CRM_ROLES.find((r) => data?.roles[r].connected) ?? "contacts";
  }, [picked, data]);

  if (c.isLoading && !data) return <CrmLoadingState />;
  if (c.error || !data) return <CrmErrorState onRetry={() => void c.reload()} />;
  if (!c.enabled) {
    return <CrmDisabledState organisation={organisation} canAdmin={data.canAdmin} onActivate={() => void c.activate()} />;
  }

  const nobody = CRM_ROLES.every((r) => !data.roles[r].connected);
  const view = data.roles[selected];
  const roleLabel = t(`roles.${selected}.label`);
  const candidate = c.candidates[selected].find((x) => x.databaseId === view.databaseId);

  return (
    <div className="flex flex-col">
      <div className="flex items-center gap-3 border-b border-border px-6 py-4">
        <div className="min-w-0">
          <h1 className="text-lg font-semibold">{t("title")}</h1>
          <p className="flex items-center gap-1.5 text-xs text-muted-foreground">
            <Link2 className="size-3.5" aria-hidden="true" />
            <span className="truncate">{t("subtitle", { organisation })}</span>
          </p>
        </div>
        <span className="flex-1" />
        <CrmActionButton
          actionId="deactivate"
          label={t("enabled.label")}
          tip={t("enabled.tip")}
          ariaLabel={t("enabled.label")}
          pressed
          onClick={() => void c.deactivate()}
          disabledReason={data.canAdmin ? undefined : t("disabled.nonAdmin")}
        />
      </div>

      <div className="space-y-4 p-6">
        {handoff && (
          <ActivationAutomationsRecap
            created={handoff.created}
            skipped={handoff.skipped}
            statusOptionsAdded={handoff.statusOptionsAdded}
            automationsHref={`/automations${data.roles.dossiers.spaceId ? `?spaceId=${encodeURIComponent(data.roles.dossiers.spaceId)}` : ""}`}
          />
        )}
        {nobody && <CrmEmptyBlock title={t("empty.noneConnectedTitle")} body={t("empty.noneConnectedBody")} />}

        <h2 className="flex items-center gap-1.5 text-sm font-semibold">
          <Database className="size-4" aria-hidden="true" />
          {t("section.roles")}
        </h2>
        <div className="grid grid-cols-3 gap-4">
          {CRM_ROLES.map((role) => {
            const used = new Set<string>();
            for (const other of CRM_ROLES) {
              const id = data.roles[other].databaseId;
              if (other !== role && data.roles[other].connected && id) used.add(id);
            }
            return (
              <RoleTile
                key={role}
                view={data.roles[role]}
                candidates={c.candidates[role]}
                usedElsewhere={used}
                selected={selected === role}
                canAdmin={data.canAdmin}
                onSelectRole={() => setPicked(role)}
                onChooseBase={(id) => {
                  setPicked(role);
                  void c.setRole(role, id);
                }}
                onDissociate={() => void c.setRole(role, null)}
              />
            );
          })}
        </div>

        <h2 className="flex items-center gap-1.5 text-sm font-semibold">
          <Link2 className="size-4" aria-hidden="true" />
          {t("map.title", { role: roleLabel })}
          {view.connected && view.databaseName && (
            <span className="rounded bg-muted px-1.5 py-0.5 text-[11px] font-medium text-muted-foreground">
              {view.databaseName}
            </span>
          )}
        </h2>
        {!view.connected ? (
          <CrmEmptyBlock title={t("map.emptyTitle", { role: roleLabel })} body={t("map.emptyBody")} />
        ) : (
          <>
            {view.bad > 0 && (
              <div
                role="alert"
                className="flex items-start gap-2 rounded-lg border border-destructive/40 bg-destructive/10 p-3 text-sm text-destructive"
              >
                <AlertTriangle className="mt-0.5 size-4 shrink-0" aria-hidden="true" />
                <span>{t("alert.badTypes", { count: view.bad })}</span>
              </div>
            )}
            <FieldMapTable
              view={view}
              candidate={candidate}
              canAdmin={data.canAdmin}
              onChange={(key, columnId) => void c.setField(selected, key, columnId)}
            />
            <p className="text-xs text-muted-foreground">
              {t("map.summary", { ok: String(data.okTotal), total: String(CRM_ROLES.reduce((n, r) => n + (data.roles[r].connected ? data.roles[r].total : 0), 0)) })}
            </p>
          </>
        )}
      </div>
    </div>
  );
}

