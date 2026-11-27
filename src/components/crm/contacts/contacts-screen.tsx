"use client";

import { useEffect, useMemo, useState } from "react";
import { Users } from "lucide-react";
import { useTranslations } from "next-intl";
import { RecordDialog } from "@/components/bases/record-dialog";
import { useRecordSheet } from "@/components/bases/use-record-sheet";
import { useRowWrites } from "@/components/bases/use-row-writes";
import type { CellValue, DbColumn, DbRow } from "@/components/editor/extensions/database-block/types";
import { useRelationData } from "@/components/editor/extensions/database-block/use-relation-data";
import { getCrmAction } from "@/lib/crm/actions";
import type { ContactsDto } from "@/lib/crm/contacts";
import { refreshCrmData, useCrmContacts } from "@/lib/crm/use-crm-data";
import { cn } from "@/lib/utils";
import { CrmActionButton, fieldClass } from "../crm-states";
import { CrmScreen, type CrmScreenState } from "../shell/crm-screen";
import { ActivityFeed } from "../fiche/activity/activity-feed";
import { ContactsTable } from "./contacts-table";

const SEARCH_DELAY_MS = 250;

const asRow = (r: ContactsDto["contacts"][number]["row"]) => r as unknown as DbRow;

export function ContactsScreen() {
  const t = useTranslations("crm.contacts");
  const tRoot = useTranslations("crm");
  const tShell = useTranslations("crm.shell");
  const [input, setInput] = useState("");
  const [search, setSearch] = useState("");

  // La requête part une fois la frappe terminée, pas à chaque touche.
  useEffect(() => {
    const id = setTimeout(() => setSearch(input), SEARCH_DELAY_MS);
    return () => clearTimeout(id);
  }, [input]);

  const { data, error, isLoading, mutate } = useCrmContacts(search);
  // Garde la dernière liste affichée pendant le rechargement après un changement de recherche.
  const [shown, setShown] = useState(data);
  if (data && data !== shown) setShown(data);
  const dto = data ?? shown;

  const failed = data === undefined && !!error;
  const notConnected = failed && String((error as Error).message).endsWith("404");
  // Une recherche qui échoue garde la liste précédente et la barre de recherche : seule la liste passe en erreur.
  const listError = failed && !notConnected && !!dto;
  const stale = data === undefined && !!dto && !error;

  let state: CrmScreenState = "ready";
  if (notConnected) state = "notConnected";
  else if (failed && !dto) state = "error";
  else if (!dto) state = isLoading || data === undefined ? "loading" : "ready";

  const contacts = useMemo(() => dto?.contacts ?? [], [dto]);
  const listRows = useMemo(() => contacts.map((c) => asRow(c.row)), [contacts]);
  const orderedIds = useMemo(() => contacts.map((c) => c.id), [contacts]);
  const columns = useMemo(() => (dto?.columns ?? []) as unknown as DbColumn[], [dto]);
  // La fiche ouverte reste ouverte quand une recherche ou une modification fait sortir le contact de la liste.
  const [snap, setSnap] = useState<DbRow | null>(null);
  const [openId, setOpenId] = useState<string | null>(null);
  const inList = openId !== null && listRows.some((r) => r.id === openId);
  if (inList) {
    const cur = listRows.find((r) => r.id === openId) ?? null;
    if (cur !== snap) setSnap(cur);
  }
  const rows = useMemo(() => (openId && !inList && snap?.id === openId ? [...listRows, snap] : listRows), [listRows, openId, inList, snap]);
  const { openRecord, openRowId, status, nav, navigate, closeRecord } = useRecordSheet({ rows, orderedIds });
  if (openRowId !== openId) setOpenId(openRowId);
  const writes = useRowWrites(dto?.databaseId ?? "", rows);
  const relationData = useRelationData(columns);

  async function writeCell(rowId: string, columnId: string, value: CellValue, opts?: { silent?: boolean }) {
    const ok = await writes.writeCell(rowId, columnId, value, opts);
    if (ok) void refreshCrmData();
    return ok;
  }

  const searching = search.trim() !== "";
  const noMatch = !!dto && contacts.length === 0 && searching;
  const emptyBase = !!dto && contacts.length === 0 && !noMatch;
  const openRow = openRowId ? (writes.mergedRows.find((r) => r.id === openRowId) ?? null) : null;

  return (
    <CrmScreen
      title={t("title")}
      role="contacts"
      state={state}
      onRetry={() => void mutate()}
      missing={dto?.missing}
      tools={
        <div className="flex items-center gap-2">
          <label htmlFor="contacts-q" className="sr-only">
            {t("searchAria")}
          </label>
          <input
            id="contacts-q"
            type="search"
            value={input}
            placeholder={t("search")}
            className={`${fieldClass} w-60`}
            onChange={(e) => setInput(e.target.value)}
          />
        </div>
      }
    >
      {dto && (
        <div aria-busy={stale || undefined} className={cn("min-h-0 flex-1 overflow-y-auto px-6 py-4 transition-opacity", stale && "opacity-60")}>
          {listError ? (
            <div className="flex flex-col items-center gap-3 rounded-lg border border-border p-8 text-center">
              <p role="alert" className="text-sm font-medium">
                {tShell("errorTitle")}
              </p>
              <CrmActionButton
                actionId="retry"
                label={tRoot(getCrmAction("retry").labelKey)}
                tip={tShell("errorRetryTip")}
                ariaLabel={tRoot(getCrmAction("retry").labelKey)}
                onClick={() => void mutate()}
              />
            </div>
          ) : contacts.length === 0 ? (
            <div className="flex flex-col items-center gap-3 rounded-lg border border-dashed border-border p-8 text-center">
              <Users className="size-5 text-muted-foreground" aria-hidden="true" />
              <p className="text-sm font-medium">{emptyBase ? t("emptyTitle") : t("noMatchTitle")}</p>
              <p className="text-xs text-muted-foreground">{emptyBase ? t("emptyBody") : t("noMatchBody")}</p>
              {noMatch && (
                <CrmActionButton
                  actionId="contactsSearchClear"
                  label={t("searchClear")}
                  tip={t("searchClearTip")}
                  ariaLabel={t("searchClear")}
                  onClick={() => {
                    setInput("");
                    setSearch("");
                  }}
                />
              )}
            </div>
          ) : (
            <ContactsTable contacts={contacts} databaseId={dto.databaseId} currency={dto.currency} openId={openRowId} onOpen={openRecord} />
          )}
        </div>
      )}
      {openRowId && dto && (
        <RecordDialog
          row={openRow}
          columns={columns}
          spaceId={dto.spaceId}
          databaseId={dto.databaseId}
          relationData={relationData}
          onWriteCell={writeCell}
          onClose={closeRecord}
          deletion={{ onChanged: () => void refreshCrmData(), readOnly: !dto.canEdit }}
          status={status === "notFound" ? "notFound" : "ready"}
          nav={nav}
          onNavigate={navigate}
          entityLabel={t("entity")}
          openInBasesHref={`/bases/${dto.databaseId}?row=${openRowId}`}
          sections={() => <ActivityFeed databaseId={dto.databaseId} rowId={openRowId} />}
        />
      )}
    </CrmScreen>
  );
}
