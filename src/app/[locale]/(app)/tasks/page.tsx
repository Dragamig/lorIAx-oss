"use client";

import useSWR from "swr";
import { useTranslations, useFormatter } from "next-intl";
import { Link } from "@/i18n/routing";
import { CheckSquare, ExternalLink, Loader2, Table2, Lock } from "lucide-react";
import { Tip } from "@/components/editor/extensions/database-block/row-tip";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";

interface MyTask {
  id: string;
  kind: "document_item" | "gantt_event" | "database_row";
  title: string;
  status: "open" | "in_progress" | "done" | "cancelled";
  dueAt: string | null;
  documentTitle: string | null;
  eventTitle: string | null;
  documentUrl: string | null;
  ganttUrl: string | null;
  databaseId?: string | null;
  rowId?: string | null;
  databaseName?: string | null;
  rowLink?: string | null;
  restricted?: boolean;
}

const STATUS_VARIANT: Record<
  MyTask["status"],
  "default" | "secondary" | "outline" | "destructive"
> = {
  open: "default",
  in_progress: "secondary",
  done: "outline",
  cancelled: "destructive",
};

const STATUS_ORDER: MyTask["status"][] = [
  "open",
  "in_progress",
  "done",
  "cancelled",
];

/** Map API snake_case status keys to camelCase translation keys */
function statusToTranslationKey(status: MyTask["status"]): "open" | "inProgress" | "done" | "cancelled" {
  if (status === "in_progress") return "inProgress";
  return status as "open" | "done" | "cancelled";
}

const fetcher = (url: string) => fetch(url).then((r) => r.json());

export default function TasksPage() {
  const t = useTranslations("tasks");
  const format = useFormatter();
  const { data, error, mutate } = useSWR<{ tasks: MyTask[] }>(
    "/api/tasks/my",
    fetcher,
    {
      refreshInterval: 30000,
    }
  );

  const tasks = data?.tasks ?? [];

  const grouped = STATUS_ORDER.reduce(
    (acc, s) => {
      acc[s] = tasks.filter((task) => task.status === s);
      return acc;
    },
    {} as Record<MyTask["status"], MyTask[]>
  );

  const updateStatus = async (id: string, status: MyTask["status"]) => {
    await fetch(`/api/tasks/${id}`, {
      method: "PATCH",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ status }),
    });
    mutate();
  };

  if (error)
    return <p className="p-6 text-muted-foreground">{t("error")}</p>;

  const isLoading = !data && !error;

  return (
    <div className="p-6 max-w-3xl mx-auto space-y-8">
      <div className="flex items-center gap-3">
        <CheckSquare className="h-6 w-6 text-primary" />
        <h1 className="text-xl font-semibold">{t("title")}</h1>
        {!isLoading && tasks.filter(
          (task) => task.status === "open" || task.status === "in_progress"
        ).length > 0 && (
          <Badge variant="secondary">
            {
              tasks.filter(
                (task) => task.status === "open" || task.status === "in_progress"
              ).length
            }
          </Badge>
        )}
      </div>

      {isLoading && (
        <div className="flex items-center gap-2 text-muted-foreground text-sm">
          <Loader2 className="h-4 w-4 animate-spin" />
          {t("loading")}
        </div>
      )}

      {!isLoading && tasks.length === 0 && (
        <p className="text-muted-foreground text-sm">
          {t("empty")}
        </p>
      )}

      {!isLoading && STATUS_ORDER.map((status) => {
        const group = grouped[status];
        if (group.length === 0) return null;
        return (
          <section key={status} className="space-y-2">
            <h2 className="text-sm font-medium text-muted-foreground uppercase tracking-wide">
              {t(`statuses.${statusToTranslationKey(status)}`)} ({group.length})
            </h2>
            <ul className="space-y-2">
              {group.map((task) => (
                <li
                  key={task.id}
                  className="flex items-start gap-3 p-3 rounded-lg border border-border bg-card hover:bg-accent/30 transition-colors"
                >
                  <div className="flex-1 min-w-0">
                    <p className="text-sm font-medium truncate">{task.title}</p>
                    <div className="flex items-center gap-2 mt-0.5 flex-wrap">
                      {task.kind === "document_item" && task.documentUrl && (
                        <Link
                          href={task.documentUrl}
                          className="text-xs text-muted-foreground hover:text-foreground flex items-center gap-1 transition-colors"
                        >
                          <ExternalLink className="h-3 w-3 shrink-0" />
                          <span className="truncate">
                            {task.documentTitle ?? t("documentFallback")}
                          </span>
                        </Link>
                      )}
                      {task.kind === "gantt_event" && task.ganttUrl && (
                        <Link
                          href={task.ganttUrl}
                          className="text-xs text-muted-foreground hover:text-foreground flex items-center gap-1 transition-colors"
                        >
                          <ExternalLink className="h-3 w-3 shrink-0" />
                          <span className="truncate">
                            {task.eventTitle ?? t("calendarFallback")}
                          </span>
                        </Link>
                      )}
                      {task.kind === "database_row" && task.restricted && (
                        <span className="text-xs text-muted-foreground flex items-center gap-1">
                          <Lock className="h-3 w-3 shrink-0" aria-hidden="true" />
                          <span className="truncate">{t("restricted")}</span>
                        </span>
                      )}
                      {task.kind === "database_row" && !task.restricted && (
                        <>
                          <span className="text-xs text-muted-foreground flex items-center gap-1 shrink-0">
                            <Table2 className="h-3 w-3 shrink-0" aria-hidden="true" />
                            {t("sourceRow")}
                          </span>
                          {task.rowLink && (
                            <Tip label={task.databaseName ?? t("rowFallback")}>
                              <Link
                                href={task.rowLink}
                                aria-label={task.databaseName ?? t("rowFallback")}
                                className="text-xs text-muted-foreground hover:text-foreground flex items-center gap-1 transition-colors min-h-6"
                              >
                                <ExternalLink className="h-3 w-3 shrink-0" aria-hidden="true" />
                                <span className="truncate">
                                  {task.databaseName ?? t("rowFallback")}
                                </span>
                              </Link>
                            </Tip>
                          )}
                        </>
                      )}
                      {task.dueAt && (
                        <span className="text-xs text-muted-foreground shrink-0">
                          {t("due", { date: format.dateTime(new Date(task.dueAt), { year: "numeric", month: "short", day: "numeric" }) })}
                        </span>
                      )}
                    </div>
                  </div>
                  <div className="flex items-center gap-2 shrink-0">
                    <DropdownMenu>
                      <DropdownMenuTrigger
                        render={
                          <Button
                            variant="ghost"
                            size="sm"
                            className="h-7 px-2 cursor-pointer"
                          >
                            <Badge
                              variant={STATUS_VARIANT[task.status]}
                              className="text-xs"
                            >
                              {t(`statuses.${statusToTranslationKey(task.status)}`)}
                            </Badge>
                          </Button>
                        }
                      />
                      <DropdownMenuContent align="end">
                        {STATUS_ORDER.filter((s) => s !== task.status).map(
                          (s) => (
                            <DropdownMenuItem
                              key={s}
                              onClick={() => updateStatus(task.id, s)}
                            >
                              {t(`statuses.${statusToTranslationKey(s)}`)}
                            </DropdownMenuItem>
                          )
                        )}
                      </DropdownMenuContent>
                    </DropdownMenu>
                  </div>
                </li>
              ))}
            </ul>
          </section>
        );
      })}
    </div>
  );
}
