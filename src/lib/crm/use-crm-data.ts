"use client";

import useSWR, { mutate, type KeyedMutator } from "swr";
import type { ActivityItem } from "./activity-model";
import { crmActivityKey } from "./activity-actions";
import type { ContactsDto } from "./contacts";
import type { DealSheetDto } from "./deals";
import type { DossiersDto } from "./dossiers";
import type { PipelineDto } from "./pipeline";
import type { RelancesDto } from "./relances";

export interface CrmQueryResult<T> {
  data: T | undefined;
  error: unknown;
  isLoading: boolean;
  mutate: KeyedMutator<T>;
}

const RELANCES_REFRESH_MS = 60_000;
const COUNT_REFRESH_MS = 5 * 60_000;

/** Préfixe des clés SWR de données CRM (hors statut et raccordement). */
const DATA_PREFIXES = [
  "/api/crm/pipeline",
  "/api/crm/relances",
  "/api/crm/dossiers",
  "/api/crm/contacts",
  "/api/crm/deals/",
] as const;

export function crmTimezone(): string {
  try {
    return Intl.DateTimeFormat().resolvedOptions().timeZone;
  } catch {
    return "UTC";
  }
}

export async function crmFetcher<T>(url: string): Promise<T> {
  const res = await fetch(url);
  if (!res.ok) throw new Error(`CRM ${res.status}`);
  return (await res.json()) as T;
}

function withQuery(path: string, params: Record<string, string | number | boolean | null | undefined>): string {
  const sp = new URLSearchParams();
  for (const [k, v] of Object.entries(params)) {
    if (v === null || v === undefined || v === false || v === "") continue;
    sp.set(k, v === true ? "1" : String(v));
  }
  const qs = sp.toString();
  return qs ? `${path}?${qs}` : path;
}

function useCrmQuery<T>(key: string, refreshInterval?: number): CrmQueryResult<T> {
  const { data, error, isLoading, mutate: boundMutate } = useSWR<T>(key, crmFetcher<T>, {
    revalidateOnFocus: false,
    refreshInterval,
  });
  return { data, error, isLoading, mutate: boundMutate };
}

export function useCrmPipeline(params: { mine?: boolean; late?: boolean; ownerId?: string | null } = {}) {
  return useCrmQuery<PipelineDto>(
    withQuery("/api/crm/pipeline", { mine: params.mine, late: params.late, ownerId: params.ownerId, tz: crmTimezone() }),
  );
}

export function useCrmRelances(params: { horizon?: number; mine?: boolean } = {}) {
  return useCrmQuery<RelancesDto>(
    withQuery("/api/crm/relances", { horizon: params.horizon, mine: params.mine, tz: crmTimezone() }),
    RELANCES_REFRESH_MS,
  );
}

export function useCrmContacts(search = "") {
  return useCrmQuery<ContactsDto>(withQuery("/api/crm/contacts", { search: search.trim(), tz: crmTimezone() }));
}

export function useCrmDossiers() {
  return useCrmQuery<DossiersDto>("/api/crm/dossiers");
}

/** Dossier de la fiche ; clé nulle tant qu'aucun dossier n'est ouvert. */
export function useCrmDeal(rowId: string | null) {
  const { data, error, isLoading, mutate: boundMutate } = useSWR<DealSheetDto>(
    rowId ? `/api/crm/deals/${rowId}` : null,
    crmFetcher<DealSheetDto>,
    { revalidateOnFocus: false },
  );
  return { data, error, isLoading, mutate: boundMutate };
}

export interface CrmActivityDto {
  items: ActivityItem[];
  role: string;
  canLogInteraction: boolean;
  /** Sources en échec (« interactions », « tasks », « mails »), vide si tout est chargé. */
  partial: string[];
}

/** Fil d'activité de la fiche ; clé nulle tant que la fiche n'est pas ouverte. */
export function useCrmActivity(databaseId: string | null, rowId: string | null) {
  const key = databaseId && rowId ? crmActivityKey(databaseId, rowId) : null;
  const { data, error, isLoading, mutate: boundMutate } = useSWR<CrmActivityDto>(
    key,
    crmFetcher<CrmActivityDto>,
    { revalidateOnFocus: false },
  );
  return { data, error, isLoading, mutate: boundMutate, key };
}

export const CRM_RELANCES_COUNT_KEY = "/api/crm/relances/count";

export function useCrmRelancesCount() {
  return useCrmQuery<{ count: number }>(withQuery(CRM_RELANCES_COUNT_KEY, { tz: crmTimezone() }), COUNT_REFRESH_MS);
}

/** Revalide pipeline, relances, compteur, dossiers et contacts après une écriture. */
export function refreshCrmData(): Promise<unknown> {
  return mutate((key) => typeof key === "string" && DATA_PREFIXES.some((p) => key.startsWith(p)));
}
