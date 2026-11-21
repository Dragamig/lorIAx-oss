"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import { toast } from "sonner";
import { useTranslations } from "next-intl";
import { apiPatch } from "@/components/editor/extensions/database-block/api";
import { kanbanTotalsSchema, type KanbanTotalsConfig } from "@/lib/bases/view-config";
import { createLatestGate } from "@/lib/bases/latest-wins";
import { createSerialSaver } from "@/lib/bases/serial-saver";

interface Args {
  databaseId: string;
  viewId: string;
  viewConfig: Record<string, unknown>;
}

function parse(raw: unknown): KanbanTotalsConfig | null {
  if (raw == null) return null;
  const r = kanbanTotalsSchema.safeParse(raw);
  return r.success ? r.data : null;
}

/**
 * État des totaux du kanban : mise à jour optimiste, `kanbanTotals` envoyé ENTIER à chaque
 * changement (le PATCH fusionne en surface), `null` désactive. Échec = retour à l'état confirmé.
 */
export function useKanbanTotalsConfig({ databaseId, viewId, viewConfig }: Args) {
  const t = useTranslations("basesTotals");
  const [config, setConfig] = useState<KanbanTotalsConfig | null>(() => parse(viewConfig.kanbanTotals));
  const confirmedRef = useRef<KanbanTotalsConfig | null>(config);
  const gateRef = useRef(createLatestGate());
  const saverRef = useRef<ReturnType<typeof createSerialSaver<KanbanTotalsConfig | null>> | null>(null);
  const tRef = useRef(t);
  useEffect(() => {
    tRef.current = t;
  });

  const save = useCallback(
    (next: KanbanTotalsConfig | null) => {
      saverRef.current ??= createSerialSaver((value: KanbanTotalsConfig | null) =>
        apiPatch(`/api/databases/${databaseId}/views/${viewId}`, { config: { kanbanTotals: value } }),
      );
      return saverRef.current.save(next);
    },
    [databaseId, viewId],
  );

  const update = useCallback(
    async function run(next: KanbanTotalsConfig | null, isUndo = false): Promise<void> {
      const token = gateRef.current.next("totals");
      setConfig(next);
      const outcome = await save(next);
      if (outcome === "superseded") return;
      if (outcome === "failed") {
        if (!gateRef.current.isLatest("totals", token)) return;
        setConfig(confirmedRef.current);
        toast.error(tRef.current("saveError"), {
          action: { label: tRef.current("retry"), onClick: () => void run(next, isUndo) },
        });
        return;
      }
      // Une seule requête en vol : l'ordre d'acquittement est l'ordre d'envoi.
      const previous = confirmedRef.current;
      confirmedRef.current = next;
      if (!gateRef.current.isLatest("totals", token)) return;
      if (isUndo) {
        toast.success(tRef.current("undoneToast"));
      } else {
        toast.success(tRef.current("savedToast"), {
          action: { label: tRef.current("undo"), onClick: () => void run(previous, true) },
        });
      }
    },
    [save],
  );

  return { config, update: (next: KanbanTotalsConfig | null) => update(next) };
}
