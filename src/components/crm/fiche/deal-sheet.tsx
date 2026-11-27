"use client";

import { useCallback, useMemo, useState } from "react";
import { useTranslations } from "next-intl";
import { toast } from "sonner";
import { RecordDialog } from "@/components/bases/record-dialog";
import { useRowWrites } from "@/components/bases/use-row-writes";
import type { CellValue, DbColumn, DbRow } from "@/components/editor/extensions/database-block/types";
import { useRelationData } from "@/components/editor/extensions/database-block/use-relation-data";
import type { RecordNav } from "@/lib/bases/record-navigation";
import type { DealSheetDto } from "@/lib/crm/deals";
import { refreshCrmData, useCrmDeal } from "@/lib/crm/use-crm-data";
import { FieldsNotice } from "../shell/fields-notice";
import { ContactSection } from "./contact-section";
import { DealActivity } from "./deal-activity";
import { RelanceSection } from "./relance-section";
import { useDealRelance } from "./use-deal-relance";

export interface DealSheetProps {
  rowId: string;
  nav?: RecordNav | null;
  onNavigate?: (rowId: string) => void;
  onClose: () => void;
}

const asRow = (r: DealSheetDto["row"]) => r as unknown as DbRow;
const asColumns = (c: DealSheetDto["columns"]) => c as unknown as DbColumn[];

/** Fiche d'un dossier : Sheet générique des Bases, avec les sections CRM dans ses emplacements. */
export function DealSheet({ rowId, nav, onNavigate, onClose }: DealSheetProps) {
  const { data, error, mutate } = useCrmDeal(rowId);
  const noop = useCallback(() => undefined, []);
  const relationData = useRelationData([]);
  if (!data) {
    const notFound = !!error && String((error as Error).message).endsWith("404");
    return (
      <RecordDialog
        row={null}
        columns={[]}
        spaceId=""
        relationData={relationData}
        onWriteCell={noop}
        onClose={onClose}
        status={error ? (notFound ? "notFound" : "error") : "loading"}
        onRetry={() => void mutate()}
      />
    );
  }
  return <LoadedDealSheet key={rowId} dto={data} mutate={mutate} nav={nav} onNavigate={onNavigate} onClose={onClose} />;
}

interface LoadedProps extends Omit<DealSheetProps, "rowId"> {
  dto: DealSheetDto;
  mutate: ReturnType<typeof useCrmDeal>["mutate"];
}

function LoadedDealSheet({ dto, mutate, nav, onNavigate, onClose }: LoadedProps) {
  const t = useTranslations("crm.fiche");
  const [contactOpen, setContactOpen] = useState(false);

  const rows = useMemo(() => [asRow(dto.row)], [dto.row]);
  const columns = useMemo(() => asColumns(dto.columns), [dto.columns]);
  const contactRows = useMemo(() => (dto.contactRow ? [asRow(dto.contactRow)] : []), [dto.contactRow]);
  const contactColumns = useMemo(() => asColumns(dto.contactColumns), [dto.contactColumns]);
  const dealWrites = useRowWrites(dto.databaseId, rows);
  const contactWrites = useRowWrites(dto.contactDatabaseId, contactRows);
  const relationData = useRelationData(columns);
  const contactRelationData = useRelationData(contactColumns);
  const relance = useDealRelance(dto, mutate);

  const writeDeal = useCallback(
    async (rowId: string, columnId: string, value: CellValue, opts?: { silent?: boolean }) => {
      const ok = await dealWrites.writeCell(rowId, columnId, value, opts);
      if (ok) void refreshCrmData();
      return ok;
    },
    [dealWrites],
  );
  const writeContact = useCallback(
    async (rowId: string, columnId: string, value: CellValue, opts?: { silent?: boolean }) => {
      const ok = await contactWrites.writeCell(rowId, columnId, value, opts);
      if (ok) void refreshCrmData();
      return ok;
    },
    [contactWrites],
  );

  async function changeContact(value: CellValue) {
    if (!dto.contactColumnId) return false;
    const ok = await writeDeal(dto.deal.id, dto.contactColumnId, value, { silent: true });
    if (ok) toast.success(t("contact.changed"));
    else toast.error(t("contact.changeError"));
    return ok;
  }

  if (contactOpen && dto.contactRow) {
    return (
      <RecordDialog
        row={contactWrites.mergedRows[0] ?? asRow(dto.contactRow)}
        columns={contactColumns}
        spaceId={dto.contactSpaceId}
        databaseId={dto.contactDatabaseId}
        titleColumnId={dto.contactTitleColumnId ?? undefined}
        relationData={contactRelationData}
        onWriteCell={writeContact}
        onClose={() => setContactOpen(false)}
        entityLabel={t("contactEntity")}
        openInBasesHref={`/bases/${dto.contactDatabaseId}?row=${dto.contactRow.id}`}
      />
    );
  }

  return (
    <RecordDialog
      row={dealWrites.mergedRows[0] ?? asRow(dto.row)}
      columns={columns}
      spaceId={dto.spaceId}
      databaseId={dto.databaseId}
      titleColumnId={dto.titleColumnId ?? undefined}
      relationData={relationData}
      onWriteCell={writeDeal}
      onClose={onClose}
      deletion={{ onChanged: () => void refreshCrmData(), readOnly: !dto.canEdit }}
      nav={nav}
      onNavigate={onNavigate}
      entityLabel={t("entity")}
      openInBasesHref={`/bases/${dto.databaseId}?row=${dto.deal.id}`}
      sections={() => (
        <>
          <FieldsNotice role="dossiers" missing={dto.missing} />
          {dto.relanceColumnId !== null && (
            <RelanceSection dto={dto} today={relance.today()} onDone={() => void relance.markDone()} onPlan={(d) => void relance.planTo(d)} />
          )}
          <ContactSection
            dto={dto}
            relationData={relationData}
            onOpenContact={() => setContactOpen(true)}
            onChangeContact={changeContact}
          />
          <DealActivity
            dto={dto}
            onCreated={() => {
              void mutate();
              void refreshCrmData();
            }}
          />
        </>
      )}
    />
  );
}
