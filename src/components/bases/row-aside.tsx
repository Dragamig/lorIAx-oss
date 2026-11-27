"use client";

import { useCallback, useState } from "react";
import { useTranslations } from "next-intl";
import { History, ListChecks, Mail } from "lucide-react";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { Tip } from "@/components/editor/extensions/database-block/row-tip";
import type { DbColumn } from "@/components/editor/extensions/database-block/types";
import type { RelationData } from "@/components/editor/extensions/database-block/use-relation-data";
import { RowActivity } from "./row-activity";
import { RowTasks } from "./row-tasks";
import { useRowTasks } from "./use-row-tasks";
import { MailsPanel } from "@/components/mailing/mails-tab";
import { useFicheMails, type ComposeOptions } from "@/components/mailing/use-fiche-mails";
import { ComposeDrawer, composeDraftKey } from "@/components/mailing/compose-drawer";
import { isMeaningful, useComposeDraft } from "@/components/mailing/use-compose-draft";

export interface RowAsideProps {
  databaseId: string;
  rowId: string;
  /** Serialized cells of the open row. */
  revision: string;
  columns: DbColumn[];
  relationData?: RelationData;
}

type AsideTab = "activity" | "tasks" | "mails";

/** Right column of the record sheet: Activity and Tasks tabs. */
export function RowAside({ databaseId, rowId, revision, columns, relationData }: RowAsideProps) {
  const t = useTranslations("rowActivity");
  const tTasks = useTranslations("rowTasks");
  const tMail = useTranslations("mailing.tab");
  // Single load: tab visibility, count and panel share it.
  const [compose, setCompose] = useState<{ open: boolean; opts: ComposeOptions }>({ open: false, opts: {} });
  const openCompose = useCallback((opts?: ComposeOptions) => setCompose({ open: true, opts: opts ?? {} }), []);
  const mails = useFicheMails(databaseId, rowId, openCompose);
  // Unknown scope (context not loaded yet): no draft key, no badge.
  const draftScope = mails.context?.viewer ?? null;
  const { draft: plainDraft } = useComposeDraft(draftScope ? composeDraftKey(draftScope, databaseId, rowId) : "");
  // Keep the last known context so a reload after a send does not unmount the drawer.
  const [lastContext, setLastContext] = useState(mails.context);
  if (mails.context && mails.context !== lastContext) setLastContext(mails.context);
  const hasDraft = Boolean(plainDraft && isMeaningful(plainDraft));
  const mailsAvailable = mails.available === true;
  const mailCount = mails.conversations.length;
  const [tab, setTab] = useState<AsideTab>("activity");
  const [tasksVersion, setTasksVersion] = useState(0);
  // Single instance: the badge and the tasks list read the same state.
  const rowTasks = useRowTasks(databaseId, rowId);
  const { openCount, reload } = rowTasks;
  const [focusTaskId, setFocusTaskId] = useState<string | null>(null);

  const onTasksChange = useCallback(async () => {
    await reload();
    setTasksVersion((v) => v + 1);
  }, [reload]);

  const onOpenTask = useCallback((taskId: string) => {
    setFocusTaskId(taskId);
    setTab("tasks");
  }, []);

  const onTabChange = useCallback((v: string) => {
    setTab(v as AsideTab);
    // A new visit to Tasks starts without a stale focus.
    if (v !== "tasks") setFocusTaskId(null);
  }, []);

  // No empty panel when the new row has no mail context.
  const activeTab: AsideTab = tab === "mails" && mails.available === false ? "activity" : tab;
  const tasksLabel = openCount > 0 ? `${t("tabTasks")}, ${tTasks("openTaskCount", { count: openCount })}` : t("tabTasks");

  return (
    <Tabs value={activeTab} onValueChange={onTabChange} className="h-full">
      <TabsList aria-label={t("title")}>
        <Tip label={t("tabActivity")}>
          <TabsTrigger value="activity">
            <History className="size-3.5" aria-hidden="true" />
            <span>{t("tabActivity")}</span>
          </TabsTrigger>
        </Tip>
        <Tip label={tTasks("title")}>
          <TabsTrigger value="tasks" aria-label={tasksLabel}>
            <ListChecks className="size-3.5" aria-hidden="true" />
            <span>{t("tabTasks")}</span>
            {openCount > 0 && (
              <span
                data-testid="open-tasks-badge"
                aria-hidden="true"
                className="inline-flex h-5 min-w-5 items-center justify-center rounded-full bg-primary/15 px-1.5 text-[0.6875rem] font-bold text-primary"
              >
                {openCount}
              </span>
            )}
          </TabsTrigger>
        </Tip>
        {mailsAvailable && (
          <Tip label={tMail("tip")}>
            <TabsTrigger value="mails" aria-label={mailCount > 0 ? tMail("countLabel", { count: mailCount }) : tMail("title")}>
              <Mail className="size-3.5" aria-hidden="true" />
              <span>{tMail("title")}</span>
              {mailCount > 0 && (
                <span
                  data-testid="mail-count-badge"
                  aria-hidden="true"
                  className="inline-flex h-5 min-w-5 items-center justify-center rounded-full bg-primary/15 px-1.5 text-[0.6875rem] font-bold text-primary"
                >
                  {mailCount}
                </span>
              )}
            </TabsTrigger>
          </Tip>
        )}
      </TabsList>
      {/* keepMounted: the comment draft, pagination and scroll survive tab switches. */}
      <TabsContent value="activity" keepMounted>
        <RowActivity
          databaseId={databaseId}
          rowId={rowId}
          revision={`${revision}:${tasksVersion}`}
          columns={columns}
          relationData={relationData}
          onOpenTask={onOpenTask}
        />
      </TabsContent>
      <TabsContent value="tasks">
        <RowTasks
          databaseId={databaseId}
          rowId={rowId}
          rowTasks={rowTasks}
          onChange={() => void onTasksChange()}
          focusTaskId={focusTaskId}
        />
      </TabsContent>
      {mailsAvailable && (
        <TabsContent value="mails" keepMounted>
          <MailsPanel mails={mails} hasDraft={hasDraft} />
        </TabsContent>
      )}
      {lastContext && (
        <ComposeDrawer
          open={compose.open}
          onClose={() => setCompose((c) => ({ ...c, open: false }))}
          onReopen={openCompose}
          onSent={mails.reload}
          databaseId={databaseId}
          rowId={rowId}
          context={lastContext}
          replyTo={compose.opts.replyTo}
          resume={compose.opts.resume}
        />
      )}
    </Tabs>
  );
}
