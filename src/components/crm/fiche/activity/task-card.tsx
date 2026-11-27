"use client";

import { useState } from "react";
import { ListChecks } from "lucide-react";
import { useLocale, useTranslations } from "next-intl";
import { toast } from "sonner";
import type { TaskActivity } from "@/lib/crm/activity-model";
import { toggleTaskDone } from "@/lib/crm/activity-actions";
import { cn } from "@/lib/utils";
import { CrmActionButton } from "../../crm-states";
import { formatRelanceDay } from "../../relances/relative-label";

interface Props {
  item: TaskActivity;
  activityKey: string;
  done?: boolean;
}

/** Carte d'une tâche du fil d'activité, avec terminaison et réouverture. */
export function TaskCard({ item, activityKey, done = false }: Props) {
  const t = useTranslations("crm.fiche.activity");
  const locale = useLocale();
  const [busy, setBusy] = useState(false);
  const { task } = item;
  const meta = task.dueAt ? t("task.due", { date: formatRelanceDay(task.dueAt, locale) }) : "";
  const toggle = async () => {
    if (busy) return;
    setBusy(true);
    const res = await toggleTaskDone(task.id, !done, activityKey);
    setBusy(false);
    if (res.ok) toast.success(t(done ? "task.reopened" : "task.completed"));
    else toast.error(t("task.error"));
  };
  return (
    <li data-testid="fiche-task" className="flex items-center gap-2 rounded-lg border border-border p-2">
      <span className="flex size-7 shrink-0 items-center justify-center rounded-md bg-muted" aria-hidden="true">
        <ListChecks className="size-3.5" />
      </span>
      <div className="min-w-0 flex-1">
        <div className={cn("truncate text-sm font-medium", done && "line-through opacity-60")}>{task.title}</div>
        <div className="truncate text-xs text-muted-foreground">{meta}</div>
      </div>
      <CrmActionButton
        actionId="ficheActivityTaskDone"
        label={done ? t("task.reopen") : t("task.done")}
        tip={done ? t("task.reopenTip") : t("task.doneTip")}
        ariaLabel={done ? t("task.reopen") : t("task.done")}
        onClick={() => void toggle()}
        busy={busy}
        disabledReason={task.canToggle === false ? t("task.notAllowed") : undefined}
        className="shrink-0"
      />
    </li>
  );
}
