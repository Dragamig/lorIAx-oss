"use client";

import useSWR, { mutate } from "swr";

export interface CrmStatus {
  enabled: boolean;
  complete: boolean;
  canAdmin: boolean;
}

/** Statut du CRM pour l'organisation. Aucune requête tant que le module n'est pas actif sur l'instance. */
export const CRM_STATUS_KEY = "/api/crm/status";

/** À appeler après toute activation, désactivation ou changement de raccordement : l'entrée de menu relit le statut. */
export function refreshCrmStatus(): void {
  void mutate(CRM_STATUS_KEY);
}

export function useCrmStatus(moduleActive: boolean): CrmStatus | null {
  const { data } = useSWR<CrmStatus | null>(
    moduleActive ? CRM_STATUS_KEY : null,
    (url: string) => fetch(url).then((r) => (r.ok ? r.json() : null)),
    { revalidateOnFocus: false }
  );
  return data ?? null;
}
