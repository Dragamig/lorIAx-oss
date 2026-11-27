"use client";

import useSWR from "swr";
import type { CrmRole } from "@/lib/crm/fields";
import { crmFetcher } from "@/lib/crm/use-crm-data";

interface RoleView {
  connected?: boolean;
  databaseId?: string;
  databaseName?: string;
  spaceName?: string;
}

interface ConnectionLite {
  roles?: Partial<Record<CrmRole, RoleView>>;
}

export type RoleSource =
  | { status: "loading" }
  | { status: "error" }
  | { status: "unconnected" }
  | { status: "connected"; databaseId: string; databaseName: string; spaceName: string };

/** Base raccordée à un rôle : distingue chargement, erreur et rôle réellement non raccordé. */
export function useRoleSource(role: CrmRole): RoleSource {
  const { data, error, isLoading } = useSWR<ConnectionLite>("/api/crm/connection", crmFetcher<ConnectionLite>, {
    revalidateOnFocus: false,
  });
  if (error) return { status: "error" };
  if (isLoading || !data) return { status: "loading" };
  const view = data.roles?.[role];
  if (!view?.connected || !view.databaseId) return { status: "unconnected" };
  return {
    status: "connected",
    databaseId: view.databaseId,
    databaseName: view.databaseName ?? "",
    spaceName: view.spaceName ?? "",
  };
}
