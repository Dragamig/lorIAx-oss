"use client";

import { useState, type ReactNode } from "react";
import { CheckSquare, Inbox, List, Mail, MessageSquare, RefreshCw, TriangleAlert, type LucideIcon } from "lucide-react";
import { useTranslations } from "next-intl";
import { filterActivity, type ActivityFilter, type ActivityItem } from "@/lib/crm/activity-model";
import { useCrmActivity } from "@/lib/crm/use-crm-data";
import { Skeleton } from "@/components/ui/skeleton";
import { CrmActionButton } from "../../crm-states";
import { InteractionCard } from "./interaction-card";
import { MailCard } from "./mail-card";
import { TaskCard } from "./task-card";

const FILTERS: readonly ActivityFilter[] = ["all", "interaction", "mail", "task"];
const FILTER_ICONS: Record<ActivityFilter, LucideIcon> = {
  all: List,
  interaction: MessageSquare,
  mail: Mail,
  task: CheckSquare,
};

interface Props {
  databaseId: string;
  rowId: string;
  /** Action placée à droite de la barre de filtres (ajout d'une interaction). */
  header?: ReactNode;
  /** Contenu sous la barre de titre (formulaire d'ajout). */
  children?: ReactNode;
}

function Card({ item, activityKey }: { item: ActivityItem; activityKey: string }) {
  if (item.kind === "interaction") return <InteractionCard interaction={item.interaction} />;
  if (item.kind === "mail") return <MailCard item={item} activityKey={activityKey} />;
  return <TaskCard item={item} activityKey={activityKey} done={item.task.status === "done"} />;
}

/** Fil d'activité d'une fiche : interactions, mails et tâches triés, avec filtres par type. */
export function ActivityFeed({ databaseId, rowId, header, children }: Props) {
  const t = useTranslations("crm.fiche.activity");
  const { data, error, isLoading, mutate, key } = useCrmActivity(databaseId, rowId);
  const [filter, setFilter] = useState<ActivityFilter>("all");
  const items = data ? filterActivity(data.items, filter) : [];

  let body: ReactNode;
  if (!data && error) {
    body = (
      <div className="flex flex-col items-center gap-2 rounded-lg border border-dashed border-border p-6 text-center">
        <p role="alert" className="text-sm font-medium">
          {t("loadError")}
        </p>
        <CrmActionButton actionId="retry" label={t("retryLoad")} tip={t("retryLoad")} ariaLabel={t("retryLoad")} onClick={() => void mutate()} />
      </div>
    );
  } else if (!data || isLoading) {
    body = (
      <div role="status" aria-label={t("title")} className="space-y-2">
        <span className="sr-only">{t("loading")}</span>
        {[0, 1, 2].map((i) => (
          <Skeleton key={i} className="h-12" />
        ))}
      </div>
    );
  } else if (items.length === 0) {
    const filtered = filter !== "all" && data.items.length > 0;
    body = (
      <div className="flex flex-col items-center gap-1 rounded-lg border border-dashed border-border p-6 text-center">
        <Inbox className="size-5 text-muted-foreground" aria-hidden="true" />
        <p className="text-sm font-medium">{filtered ? t("emptyFiltered") : t("empty")}</p>
        {!filtered && <p className="text-xs text-muted-foreground">{t("emptyBody")}</p>}
      </div>
    );
  } else {
    body = (
      <ul aria-label={t("listAria")} className="space-y-2">
        {items.map((item) => (
          <Card key={`${item.kind}:${item.id}`} item={item} activityKey={key ?? ""} />
        ))}
      </ul>
    );
  }

  return (
    <section aria-label={t("title")} data-testid="fiche-activity" className="mb-5">
      <div className="mb-2 flex flex-wrap items-center gap-2 border-b border-border pb-1">
        <h3 className="flex-1 text-xs font-semibold tracking-wide text-muted-foreground uppercase">{t("title")}</h3>
        <div role="group" aria-label={t("filterAria")} className="flex gap-1">
          {FILTERS.map((f) => (
            <CrmActionButton
              key={f}
              actionId="ficheActivityFilter"
              icon={FILTER_ICONS[f]}
              label={t(`filters.${f}`)}
              tip={t(`filters.${f}Tip`)}
              ariaLabel={t(`filters.${f}`)}
              pressed={filter === f}
              onClick={() => setFilter(f)}
            />
          ))}
        </div>
        {header}
      </div>
      {children}
      {data && data.partial.length > 0 && (
        <div
          role="status"
          data-testid="fiche-activity-partial"
          className="mb-2 flex items-center gap-2 rounded-md border border-border bg-muted px-2 py-1 text-xs text-muted-foreground"
        >
          <TriangleAlert className="size-3.5 shrink-0" aria-hidden="true" />
          <span className="flex-1">{t("partial")}</span>
          <CrmActionButton
            actionId="retry"
            icon={RefreshCw}
            label={t("retryLoad")}
            tip={t("retryLoad")}
            ariaLabel={t("retryLoad")}
            onClick={() => void mutate()}
          />
        </div>
      )}
      {body}
    </section>
  );
}
