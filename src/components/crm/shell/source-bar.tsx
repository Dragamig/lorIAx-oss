"use client";

import { Database } from "lucide-react";
import { Link } from "@/i18n/routing";
import { useTranslations } from "next-intl";
import { Tip } from "@/components/editor/extensions/database-block/row-tip";
import { getCrmAction } from "@/lib/crm/actions";
import type { CrmRole } from "@/lib/crm/fields";
import { useRoleSource } from "./use-role-source";

/** Barre de source : nom de la base du rôle et lien « Ouvrir dans Bases ». */
export function SourceBar({ role }: { role: CrmRole }) {
  const t = useTranslations("crm");
  const source = useRoleSource(role);
  const Icon = getCrmAction("openInBases").icon;
  const connected = source.status === "connected";
  const name = connected ? source.databaseName : "";
  const text =
    source.status === "connected"
      ? t("shell.source", { base: source.databaseName, space: source.spaceName })
      : source.status === "loading"
        ? t("shell.sourceLoading")
        : source.status === "error"
          ? t("shell.sourceError")
          : t("shell.noSource");
  return (
    <p
      className="flex items-center gap-1.5 text-xs text-muted-foreground"
      data-testid="crm-source-bar"
      data-source-status={source.status}
    >
      <Database className="size-3.5 shrink-0" aria-hidden="true" />
      <span className="truncate">{text}</span>
      {source.status === "connected" && (
        <Tip label={t("tile.openInBasesTip")}>
          <Link
            href={`/bases/${source.databaseId}`}
            aria-label={t("shell.openInBasesAria", { base: name })}
            data-action="openInBases"
            className="inline-flex min-h-6 min-w-6 shrink-0 items-center justify-center gap-1.5 whitespace-nowrap rounded-md px-2 py-1 text-xs font-medium text-foreground underline-offset-2 outline-none hover:bg-muted hover:underline focus-visible:ring-2 focus-visible:ring-ring"
          >
            <Icon className="size-3.5" aria-hidden="true" />
            {t("tile.openInBases")}
          </Link>
        </Tip>
      )}
    </p>
  );
}
