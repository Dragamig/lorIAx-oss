"use client";

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { toast } from "sonner";
import { refreshCrmStatus } from "@/lib/crm/use-crm-status";
import { useTranslations } from "next-intl";
import type { ColumnFact } from "@/lib/crm/automap";
import { CRM_FIELDS, CRM_ROLES, type CrmRole } from "@/lib/crm/fields";
import { validateRole, type FieldState } from "@/lib/crm/validate";

export interface CrmRoleView {
  role: CrmRole;
  connected: boolean;
  databaseId?: string;
  databaseName?: string;
  spaceId?: string;
  spaceName?: string;
  fields: Record<string, FieldState>;
  columnIds: Record<string, string | null>;
  ok: number;
  total: number;
  bad: number;
  complete: boolean;
}

export interface CrmConnectionData {
  canAdmin: boolean;
  roles: Record<CrmRole, CrmRoleView>;
  okTotal: number;
  badTotal: number;
  complete: boolean;
}

export interface CrmCandidate {
  databaseId: string;
  name: string;
  spaceName: string;
  columns: ColumnFact[];
  proposal: Record<string, string | null>;
}

type Candidates = Record<CrmRole, CrmCandidate[]>;

const emptyCandidates = (): Candidates => ({ contacts: [], dossiers: [], interactions: [] });

function disconnected(role: CrmRole): CrmRoleView {
  const fields: Record<string, FieldState> = {};
  for (const def of CRM_FIELDS[role]) fields[def.key] = { state: "none" };
  return { role, connected: false, fields, columnIds: {}, ok: 0, total: CRM_FIELDS[role].length, bad: 0, complete: false };
}

function totals(roles: Record<CrmRole, CrmRoleView>) {
  let okTotal = 0;
  let badTotal = 0;
  let complete = true;
  for (const r of CRM_ROLES) {
    okTotal += roles[r].ok;
    badTotal += roles[r].bad;
    if (!roles[r].complete) complete = false;
  }
  return { okTotal, badTotal, complete };
}

function emptyData(canAdmin: boolean): CrmConnectionData {
  const roles = {
    contacts: disconnected("contacts"),
    dossiers: disconnected("dossiers"),
    interactions: disconnected("interactions"),
  };
  return { canAdmin, roles, ...totals(roles) };
}

function normalize(raw: unknown, canAdminFallback: boolean): CrmConnectionData {
  const j = (raw ?? {}) as Partial<CrmConnectionData>;
  const roles = {} as Record<CrmRole, CrmRoleView>;
  for (const r of CRM_ROLES) {
    const v = j.roles?.[r];
    roles[r] = v ? { ...disconnected(r), ...v, columnIds: v.columnIds ?? {} } : disconnected(r);
  }
  return { canAdmin: j.canAdmin ?? canAdminFallback, roles, ...totals(roles) };
}

/** Recalcule états et compteurs à partir des bases et colonnes choisies (écriture optimiste). */
function recompute(data: CrmConnectionData, candidates: Candidates): CrmConnectionData {
  const facts = new Map<string, ColumnFact[]>();
  for (const r of CRM_ROLES) for (const c of candidates[r]) facts.set(c.databaseId, c.columns);
  const targets: Partial<Record<CrmRole, string | null>> = {};
  for (const r of CRM_ROLES) targets[r] = data.roles[r].databaseId ?? null;
  const roles = {} as Record<CrmRole, CrmRoleView>;
  for (const r of CRM_ROLES) {
    const cur = data.roles[r];
    if (!cur.connected || !cur.databaseId) {
      roles[r] = disconnected(r);
      continue;
    }
    const v = validateRole(r, cur.columnIds, facts.get(cur.databaseId) ?? [], targets);
    roles[r] = { ...cur, ...v };
  }
  return { ...data, roles, ...totals(roles) };
}

export interface UseCrmConnection {
  data: CrmConnectionData | null;
  enabled: boolean;
  candidates: Candidates;
  error: boolean;
  isLoading: boolean;
  setRole: (role: CrmRole, databaseId: string | null) => Promise<void>;
  setField: (role: CrmRole, key: string, columnId: string | null) => Promise<void>;
  deactivate: () => Promise<void>;
  activate: () => Promise<void>;
  reload: () => Promise<void>;
}

async function getJson(url: string): Promise<{ ok: boolean; status: number; body: unknown }> {
  const res = await fetch(url);
  let body: unknown = null;
  try {
    body = await res.json();
  } catch {
    body = null;
  }
  return { ok: res.ok, status: res.status, body };
}

export function useCrmConnection(): UseCrmConnection {
  const t = useTranslations("crm");
  const [data, setData] = useState<CrmConnectionData | null>(null);
  const [candidates, setCandidates] = useState<Candidates>(emptyCandidates);
  const [enabled, setEnabled] = useState(true);
  const [error, setError] = useState(false);
  const [isLoading, setLoading] = useState(true);
  const dataRef = useRef<CrmConnectionData | null>(null);
  const candRef = useRef<Candidates>(candidates);
  const queue = useRef<Promise<unknown>>(Promise.resolve());

  const commitData = useCallback((next: CrmConnectionData | null) => {
    dataRef.current = next;
    setData(next);
  }, []);

  const reload = useCallback(async () => {
    setLoading(true);
    setError(false);
    try {
      const status = await getJson("/api/crm/status");
      if (!status.ok) throw new Error("status");
      const s = status.body as { enabled?: boolean; canAdmin?: boolean };
      const canAdmin = !!s.canAdmin;
      if (!s.enabled) {
        setEnabled(false);
        commitData(emptyData(canAdmin));
        return;
      }
      setEnabled(true);
      const conn = await getJson("/api/crm/connection");
      if (conn.status === 404) commitData(emptyData(canAdmin));
      else if (!conn.ok) throw new Error("connection");
      else commitData(normalize(conn.body, canAdmin));
      const next = emptyCandidates();
      if (canAdmin) {
        await Promise.all(
          CRM_ROLES.map(async (role) => {
            try {
              const c = await getJson(`/api/crm/connection/candidates?role=${role}`);
              const list = (c.body as { candidates?: CrmCandidate[] } | null)?.candidates;
              if (c.ok && Array.isArray(list)) next[role] = list;
            } catch {
              /* liste vide : l'écran reste utilisable en lecture */
            }
          }),
        );
      }
      candRef.current = next;
      setCandidates(next);
    } catch {
      setError(true);
    } finally {
      setLoading(false);
    }
  }, [commitData]);

  useEffect(() => {
    void reload();
  }, [reload]);

  /** Écriture optimiste d'un état complet ; retour arrière et toast « Réessayer » en cas d'échec. */
  const write = useCallback(
    (
      nextData: CrmConnectionData,
      changedRoles: Partial<Record<CrmRole, string | null>>,
      onSaved?: (saved: CrmConnectionData) => void,
    ): Promise<void> => {
      const previous = dataRef.current;
      commitData(nextData);
      const run = async () => {
        const fieldMap: Record<string, Record<string, string | null>> = {};
        for (const r of CRM_ROLES) if (nextData.roles[r].connected) fieldMap[r] = nextData.roles[r].columnIds;
        try {
          const res = await fetch("/api/crm/connection", {
            method: "PUT",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify({ roles: changedRoles, fieldMap }),
          });
          if (!res.ok) throw new Error(String(res.status));
          const saved = normalize(await res.json(), nextData.canAdmin);
          commitData(saved);
          refreshCrmStatus();
          onSaved?.(saved);
        } catch {
          commitData(previous);
          toast.error(t("toasts.saveError"), {
            action: { label: t("toasts.retry"), onClick: () => void write(nextData, changedRoles, onSaved) },
          });
        }
      };
      const p = queue.current.then(run, run);
      queue.current = p;
      return p;
    },
    [commitData, t],
  );

  const roleLabel = useCallback((role: CrmRole) => t(`roles.${role}.label`), [t]);

  const setRole = useCallback(
    async (role: CrmRole, databaseId: string | null) => {
      const cur = dataRef.current;
      if (!cur) return;
      const prev = cur.roles[role];
      const prevDb = prev.connected ? (prev.databaseId ?? null) : null;
      if (prevDb === databaseId) return;
      const cand = candRef.current[role].find((c) => c.databaseId === databaseId);
      if (databaseId && !cand) return;
      const nextRole: CrmRoleView = cand
        ? {
            ...disconnected(role),
            connected: true,
            databaseId: cand.databaseId,
            databaseName: cand.name,
            spaceName: cand.spaceName,
            columnIds: { ...cand.proposal },
          }
        : disconnected(role);
      const next = recompute({ ...cur, roles: { ...cur.roles, [role]: nextRole } }, candRef.current);
      const undo = () => {
        const now = dataRef.current;
        if (!now) return;
        const restored = recompute({ ...now, roles: { ...now.roles, [role]: prev } }, candRef.current);
        void write(restored, { [role]: prevDb }, () => toast.success(t("toasts.undone")));
      };
      await write(next, { [role]: databaseId }, (saved) => {
        const v = saved.roles[role];
        toast.success(
          cand
            ? t("toasts.roleChosen", { role: roleLabel(role), base: cand.name, ok: String(v.ok), total: String(v.total) })
            : t("toasts.roleDissociated", { role: roleLabel(role) }),
          { action: { label: t("toasts.undo"), onClick: undo } },
        );
      });
    },
    [roleLabel, t, write],
  );

  const setField = useCallback(
    async (role: CrmRole, key: string, columnId: string | null) => {
      const cur = dataRef.current;
      if (!cur || !cur.roles[role].connected) return;
      const prev = cur.roles[role];
      const prevColumn = prev.columnIds[key] ?? null;
      if (prevColumn === columnId) return;
      const next = recompute(
        { ...cur, roles: { ...cur.roles, [role]: { ...prev, columnIds: { ...prev.columnIds, [key]: columnId } } } },
        candRef.current,
      );
      const field = t(`fields.${role}.${key}`);
      const columnName =
        candRef.current[role]
          .find((c) => c.databaseId === prev.databaseId)
          ?.columns.find((c) => c.id === columnId)?.name ?? "";
      const undo = () => void setField(role, key, prevColumn);
      await write(next, {}, (saved) => {
        const state = saved.roles[role].fields[key]?.state;
        const message = !columnId
          ? t("toasts.fieldNotConnected", { field })
          : state === "bad"
            ? t("toasts.fieldBad", { field })
            : t("toasts.fieldConnected", { field, column: columnName });
        toast(message, { action: { label: t("toasts.undo"), onClick: undo } });
      });
    },
    [t, write],
  );

  const activate = useCallback(async () => {
    try {
      const res = await fetch("/api/crm/activate", { method: "POST" });
      if (!res.ok) throw new Error("activate");
      toast.success(t("activation.reactivatedToast"));
      refreshCrmStatus();
      await reload();
    } catch {
      toast.error(t("activation.error"));
    }
  }, [reload, t]);

  const deactivate = useCallback(async () => {
    try {
      const res = await fetch("/api/crm/deactivate", { method: "POST" });
      if (!res.ok) throw new Error("deactivate");
      setEnabled(false);
      refreshCrmStatus();
      toast.success(t("activation.deactivatedToast"), {
        action: { label: t("activation.undo"), onClick: () => void activate() },
      });
    } catch {
      toast.error(t("activation.deactivateError"));
    }
  }, [activate, t]);

  return useMemo(
    () => ({ data, enabled, candidates, error, isLoading, setRole, setField, deactivate, activate, reload }),
    [data, enabled, candidates, error, isLoading, setRole, setField, deactivate, activate, reload],
  );
}
