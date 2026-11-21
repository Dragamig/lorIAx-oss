"use client";

import { AlertTriangle, Check } from "lucide-react";
import { useTranslations } from "next-intl";
import { CRM_FIELDS, type CrmRole } from "@/lib/crm/fields";
import { isColumnTypeCompatible } from "@/lib/databases/column-types";
import { cn } from "@/lib/utils";
import type { CrmCandidate, CrmRoleView } from "./use-crm-connection";

interface FieldMapTableProps {
  view: CrmRoleView;
  /** Colonnes de la base raccordée (vide pour un lecteur : seules les colonnes choisies sont connues). */
  candidate: CrmCandidate | undefined;
  canAdmin: boolean;
  onChange: (key: string, columnId: string | null) => void;
}

export function FieldMapTable({ view, candidate, canAdmin, onChange }: FieldMapTableProps) {
  const t = useTranslations("crm");
  const role: CrmRole = view.role;
  const typeLabel = (type: string) => (t.has(`types.${type}`) ? t(`types.${type}`) : type);
  const columns = candidate?.columns ?? [];

  const message = (key: string): string => {
    const st = view.fields[key];
    if (!st || st.state !== "bad") return "";
    const def = CRM_FIELDS[role].find((d) => d.key === key);
    if (st.code === "column_missing") return t("errors.columnMissing");
    if (st.code === "relation_target") {
      return t("errors.relationTarget", { role: def?.relationTargetRole ? t(`roles.${def.relationTargetRole}.label`) : "" });
    }
    const col = columns.find((c) => c.id === view.columnIds[key]);
    return t("errors.typeIncompatible", {
      column: col?.name ?? "",
      actual: col ? typeLabel(col.type) : "",
      expected: (def?.types ?? []).map(typeLabel).join(", "),
    });
  };

  return (
    <div className="overflow-hidden rounded-lg border border-border">
      <table aria-label={t("map.tableAria")} className="w-full table-fixed border-collapse text-sm">
        <colgroup>
          <col style={{ width: "26%" }} />
          <col style={{ width: "16%" }} />
          <col style={{ width: "42%" }} />
          <col style={{ width: "16%" }} />
        </colgroup>
        <thead className="bg-muted/50 text-left text-xs text-muted-foreground">
          <tr>
            <th className="px-3 py-2 font-medium">{t("map.field")}</th>
            <th className="px-3 py-2 font-medium">{t("map.expected")}</th>
            <th className="px-3 py-2 font-medium">{t("map.column")}</th>
            <th className="px-3 py-2 font-medium">{t("map.state")}</th>
          </tr>
        </thead>
        <tbody>
          {CRM_FIELDS[role].map((def) => {
            const st = view.fields[def.key] ?? { state: "none" as const };
            const field = t(`fields.${role}.${def.key}`);
            const bad = st.state === "bad";
            const current = view.columnIds[def.key] ?? "";
            const known = columns.some((c) => c.id === current);
            return (
              <tr key={def.key} className="border-t border-border align-top">
                <td className="px-3 py-2 font-medium">{field}</td>
                <td className="px-3 py-2 text-muted-foreground">{def.types.map(typeLabel).join(", ")}</td>
                <td className="px-3 py-2">
                  <select
                    aria-label={t("map.columnAria", { field })}
                    aria-invalid={bad || undefined}
                    title={canAdmin ? undefined : t("disabled.nonAdmin")}
                    disabled={!canAdmin}
                    value={current}
                    onChange={(e) => onChange(def.key, e.target.value || null)}
                    className={cn(
                      "h-7 w-full min-w-0 rounded-md border bg-background px-2 text-xs outline-none focus-visible:ring-2 focus-visible:ring-ring disabled:opacity-60",
                      bad ? "border-destructive" : "border-border",
                    )}
                  >
                    <option value="">{t("map.notConnectedOption")}</option>
                    {current && !known && <option value={current}>{current}</option>}
                    {columns.map((c) => (
                      <option key={c.id} value={c.id}>
                        {c.name} ({typeLabel(c.type)}
                        {isColumnTypeCompatible(def.types, c.type) ? "" : `, ${t("map.incompatibleSuffix")}`})
                      </option>
                    ))}
                  </select>
                  {bad && (
                    <span role="alert" className="mt-1 block text-xs text-destructive">
                      {message(def.key)}
                    </span>
                  )}
                </td>
                <td className="px-3 py-2">
                  <span
                    className={cn(
                      "inline-flex items-center gap-1 rounded px-1.5 py-0.5 text-[11px] font-medium",
                      st.state === "ok" && "bg-primary/10 text-primary",
                      bad && "bg-destructive/10 text-destructive",
                      st.state === "none" && "bg-muted text-muted-foreground",
                    )}
                  >
                    {st.state === "ok" && <Check className="size-3" aria-hidden="true" />}
                    {bad && <AlertTriangle className="size-3" aria-hidden="true" />}
                    {t(`states.${st.state}`)}
                  </span>
                </td>
              </tr>
            );
          })}
        </tbody>
      </table>
    </div>
  );
}
