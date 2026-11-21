"use client";

import { createContext, useContext, ReactNode } from "react";

export type OrgRole = "owner" | "admin" | "member";

export interface OrgContextValue {
  org: {
    id: string;
    slug: string;
    name: string;
    plan: string;
    /** Plafonds de l'organisation, `null` = pas de plafond. */
    maxUsers: number | null;
    maxSpaces: number | null;
    memberCount: number;
  } | null;
  role: OrgRole | null;
  isSuperAdmin: boolean;
}

const OrganizationContext = createContext<OrgContextValue>({
  org: null,
  role: null,
  isSuperAdmin: false,
});

export function OrganizationProvider({
  children,
  value,
}: {
  children: ReactNode;
  value: OrgContextValue;
}) {
  return (
    <OrganizationContext.Provider value={value}>
      {children}
    </OrganizationContext.Provider>
  );
}

export function useOrganization(): OrgContextValue {
  return useContext(OrganizationContext);
}
