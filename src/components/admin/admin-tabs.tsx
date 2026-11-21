"use client";

import { usePathname, Link } from "@/i18n/routing";
import { useEffect, useState } from "react";
import {
  Users,
  Building2,
  FileText,
  Settings,
  Shield,
  Tag,
  DoorOpen,
  PenLine,
  Blocks,
} from "lucide-react";
import { cn } from "@/lib/utils";
import { getModuleManifests } from "@/lib/modules/registry";
import { getClientSlots } from "@/lib/modules/hooks.client";

type AccessLevel = "admin" | "facility_manager" | "template_editor";
export type Tab = {
  href: string;
  label: string;
  icon: typeof Users;
  access: AccessLevel[];
  flag?: "meeting_rooms";
  superAdminOnly?: boolean;
};

const ALL: AccessLevel[] = ["admin"];
const ROOMS: AccessLevel[] = ["admin", "facility_manager"];
const TEMPLATES: AccessLevel[] = ["admin", "template_editor"];

export const BASE_ADMIN_TABS: Tab[] = [
  { href: "/admin/users", label: "Utilisateurs", icon: Users, access: ALL },
  { href: "/admin/teams", label: "Équipes", icon: Building2, access: ALL },
  { href: "/admin/templates", label: "Modèles", icon: FileText, access: TEMPLATES },
  { href: "/admin/labels", label: "Labels", icon: Tag, access: ALL },
  { href: "/admin/editor", label: "Éditeur", icon: PenLine, access: ALL },
  { href: "/admin/modules", label: "Modules et services", icon: Blocks, access: ALL },
  { href: "/admin/meeting-rooms", label: "Salles", icon: DoorOpen, access: ROOMS, flag: "meeting_rooms" },
  { href: "/admin/system", label: "Système", icon: Settings, access: ALL },
];

/**
 * Insère les onglets des modules dans la liste du noyau : après `after` quand il
 * existe, sinon juste avant « Système ». Les onglets d'un même ancrage gardent
 * leur ordre, et un onglet peut s'ancrer sur un autre onglet de modules.
 */
export function composeAdminTabs(
  base: Tab[],
  slotTabs: Array<Tab & { after?: string }>
): Tab[] {
  const result = [...base];
  for (const { after, ...tab } of slotTabs) {
    const anchor = after ? result.findIndex((t) => t.href === after) : -1;
    if (anchor >= 0) {
      result.splice(anchor + 1, 0, tab);
      continue;
    }
    const system = result.findIndex((t) => t.href === "/admin/system");
    result.splice(system >= 0 ? system : result.length, 0, tab);
  }
  return result;
}

const MODULES_TAB_HREF = "/admin/modules";

/**
 * Routes de configuration des modules, dérivées du manifeste (pas d'une liste
 * écrite en dur). Le registre n'importe que des types et `registry.generated`,
 * il est donc utilisable depuis un composant client.
 */
const MODULE_CONFIG_HREFS: string[] = Array.from(
  new Set(
    getModuleManifests()
      .map((m) => m.configHref)
      .filter((href): href is string => Boolean(href))
  )
);

function matchesRoute(pathname: string, href: string): boolean {
  return pathname === href || pathname.startsWith(href + "/");
}

/**
 * Href de l'onglet à marquer comme actif, ou `null` si aucun.
 *
 * Règle : une correspondance directe avec un onglet l'emporte toujours (la plus
 * spécifique quand plusieurs onglets s'imbriquent). À défaut seulement, une page
 * de configuration de module marque « Modules et services ». Un seul onglet est
 * donc marqué, quelle que soit la page.
 */
export function resolveActiveTabHref(
  pathname: string,
  tabHrefs: string[],
  moduleConfigHrefs: string[] = MODULE_CONFIG_HREFS
): string | null {
  const direct = tabHrefs
    .filter((href) => matchesRoute(pathname, href))
    .sort((a, b) => b.length - a.length)[0];
  if (direct) return direct;

  if (!tabHrefs.includes(MODULES_TAB_HREF)) return null;
  const isModuleConfigPage = moduleConfigHrefs.some((href) =>
    matchesRoute(pathname, href)
  );
  return isModuleConfigPage ? MODULES_TAB_HREF : null;
}

interface AdminTabsProps {
  userRole: string;
  userCapabilities: string[];
}

export function AdminTabs({ userRole, userCapabilities }: AdminTabsProps) {
  const pathname = usePathname();
  const [meetingRoomsEnabled, setMeetingRoomsEnabled] = useState(false);

  // Capacités des modules actifs : tient compte de la licence, de l'offre de
  // l'organisation et des dépendances, contrairement au réglage brut.
  useEffect(() => {
    fetch("/api/modules/active")
      .then((r) => (r.ok ? r.json() : null))
      .then((caps) => {
        if (!caps) return;
        const modules: string[] = caps.modules ?? [];
        setMeetingRoomsEnabled(modules.includes("meeting-rooms"));
      })
      .catch(() => {});
  }, []);

  const isAdmin = userRole === "admin" || userRole === "super_admin";
  const isSuperAdmin = userRole === "super_admin";
  const isFacilityManager = userCapabilities.includes("facility_manager");
  const isTemplateEditor =
    userCapabilities.includes("template_doc_editor") ||
    userCapabilities.includes("template_graphic_editor");

  const tabs = composeAdminTabs(BASE_ADMIN_TABS, getClientSlots().adminTabs);
  const visibleTabs = tabs.filter((t) => {
    if (t.flag === "meeting_rooms" && !meetingRoomsEnabled) return false;
    if (t.superAdminOnly && !isSuperAdmin) return false;
    if (isAdmin && t.access.includes("admin")) return true;
    if (isFacilityManager && t.access.includes("facility_manager")) return true;
    if (isTemplateEditor && t.access.includes("template_editor")) return true;
    return false;
  });

  const activeHref = resolveActiveTabHref(
    pathname,
    visibleTabs.map((t) => t.href)
  );

  return (
    <div className="border-b border-border bg-card px-6 py-4">
      <div className="flex items-center gap-3 mb-4">
        <Shield className="h-6 w-6 text-primary" />
        <h1 className="text-2xl font-bold">Administration</h1>
      </div>
      <div className="flex gap-1 flex-wrap">
        {visibleTabs.map((tab) => {
          const Icon = tab.icon;
          const isActive = tab.href === activeHref;
          return (
            <Link
              key={tab.href}
              href={tab.href}
              aria-current={isActive ? "page" : undefined}
              className={cn(
                "flex items-center gap-2 px-4 py-2 text-sm font-medium rounded-lg transition-colors",
                isActive
                  ? "bg-primary text-primary-foreground"
                  : "text-muted-foreground hover:bg-accent hover:text-foreground"
              )}
            >
              <Icon className="h-4 w-4" />
              {tab.label}
            </Link>
          );
        })}
      </div>
    </div>
  );
}
