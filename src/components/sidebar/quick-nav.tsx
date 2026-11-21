"use client";

import { Link } from "@/i18n/routing";
import { useTranslations } from "next-intl";
import useSWR from "swr";
import { canAccessAdminArea } from "@/lib/auth/rbac";
import { useCrmStatus } from "@/lib/crm/use-crm-status";
import { Tip } from "@/components/editor/extensions/database-block/row-tip";
import type { UserRole, UserCapability } from "@/types";
import {
  Home,
  Search,
  Network,
  Sparkles,
  CalendarDays,
  CheckSquare,
  Video,
  Shield,
  Building2,
  Database,
  BarChart3,
  Workflow,
  LibraryBig,
  Briefcase,
  Presentation,
} from "lucide-react";

interface QuickNavProps {
  pathname: string;
  user: {
    globalRole?: string;
    capabilities?: string[];
  } | null;
}

export function QuickNav({ pathname, user }: QuickNavProps) {
  const t = useTranslations("shell.quickNav");
  const { data } = useSWR<{ tasks: { status: string }[] }>(
    "/api/tasks/my",
    (url: string) => fetch(url).then((r) => r.json()),
    { refreshInterval: 30000 }
  );
  const { data: caps } = useSWR<{ modules?: string[] }>(
    "/api/modules/active",
    (url: string) => fetch(url).then((r) => (r.ok ? r.json() : null)),
    { revalidateOnFocus: false }
  );
  const libraryActive = Array.isArray(caps?.modules) && caps.modules.includes("library");
  const crmActive = Array.isArray(caps?.modules) && caps.modules.includes("crm");
  const crmStatus = useCrmStatus(crmActive);
  const tCrm = useTranslations("crm.nav");

  const presentationsActive = caps?.modules?.includes("presentations") ?? false;

  const tasks = Array.isArray(data?.tasks) ? data.tasks : [];
  const openTaskCount =
    tasks.filter(
      (t) => t.status === "open" || t.status === "in_progress"
    ).length ?? 0;

  return (
    <nav className="px-3 py-2 space-y-1">
      <Link
        href="/"
        className={`flex items-center gap-2 px-2 py-1.5 rounded-md text-sm transition-colors ${
          pathname === "/"
            ? "bg-sidebar-accent font-medium"
            : "hover:bg-sidebar-accent"
        }`}
      >
        <Home className="h-4 w-4" />
        {t("home")}
      </Link>
      <Link
        href="/search"
        className={`flex items-center gap-2 px-2 py-1.5 rounded-md text-sm transition-colors ${
          pathname === "/search"
            ? "bg-sidebar-accent font-medium"
            : "hover:bg-sidebar-accent"
        }`}
      >
        <Search className="h-4 w-4" />
        {t("search")}
      </Link>
      <Link
        href="/graph"
        className={`flex items-center gap-2 px-2 py-1.5 rounded-md text-sm transition-colors ${
          pathname === "/graph"
            ? "bg-sidebar-accent font-medium"
            : "hover:bg-sidebar-accent"
        }`}
      >
        <Network className="h-4 w-4" />
        {t("graph")}
      </Link>
      <Link
        href="/ai"
        data-tour="nav-ai"
        className={`flex items-center gap-2 px-2 py-1.5 rounded-md text-sm transition-colors ${
          pathname === "/ai"
            ? "bg-sidebar-accent font-medium"
            : "hover:bg-sidebar-accent"
        }`}
      >
        <Sparkles className="h-4 w-4" />
        {t("aiAssistant")}
      </Link>
      <Link
        href="/calendar"
        className={`flex items-center gap-2 px-2 py-1.5 rounded-md text-sm transition-colors ${
          pathname === "/calendar"
            ? "bg-sidebar-accent font-medium"
            : "hover:bg-sidebar-accent"
        }`}
      >
        <CalendarDays className="h-4 w-4" />
        {t("calendar")}
      </Link>
      <Link
        href="/tasks"
        data-tour="nav-tasks"
        className={`flex items-center gap-2 px-2 py-1.5 rounded-md text-sm transition-colors ${
          pathname.startsWith("/tasks")
            ? "bg-sidebar-accent font-medium"
            : "hover:bg-sidebar-accent"
        }`}
      >
        <CheckSquare className="h-4 w-4" />
        {t("tasks")}
        {openTaskCount > 0 && (
          <span className="ml-auto text-xs bg-primary text-primary-foreground rounded-full px-1.5 py-0.5 leading-none">
            {openTaskCount}
          </span>
        )}
      </Link>
      <Link
        href="/bases"
        className={`flex items-center gap-2 px-2 py-1.5 rounded-md text-sm transition-colors ${
          pathname.startsWith("/bases")
            ? "bg-sidebar-accent font-medium"
            : "hover:bg-sidebar-accent"
        }`}
      >
        <Database className="h-4 w-4" />
        {t("databases")}
      </Link>
      {libraryActive && (
        <Link
          href="/mediatheque"
          className={`flex items-center gap-2 px-2 py-1.5 rounded-md text-sm transition-colors ${
            pathname.startsWith("/mediatheque")
              ? "bg-sidebar-accent font-medium"
              : "hover:bg-sidebar-accent"
          }`}
        >
          <LibraryBig className="h-4 w-4" />
          {t("library")}
        </Link>
      )}
      {crmActive && crmStatus?.enabled && (
        <Link
          href="/crm"
          className={`flex items-center gap-2 px-2 py-1.5 rounded-md text-sm transition-colors ${
            pathname.startsWith("/crm")
              ? "bg-sidebar-accent font-medium"
              : "hover:bg-sidebar-accent"
          }`}
        >
          <Briefcase className="h-4 w-4" />
          {tCrm("crm")}
          {!crmStatus.complete && (
            <Tip label={tCrm("notConnectedTip")}>
              <span
                role="img"
                aria-label={tCrm("notConnectedAria")}
                className="ml-auto inline-flex h-5 min-w-5 items-center justify-center rounded-full bg-amber-500/20 px-1 text-xs font-semibold leading-none text-amber-700 dark:text-amber-300"
              >
                !
              </span>
            </Tip>
          )}
        </Link>
      )}
      <Link
        href="/dashboards"
        className={`flex items-center gap-2 px-2 py-1.5 rounded-md text-sm transition-colors ${
          pathname.startsWith("/dashboards")
            ? "bg-sidebar-accent font-medium"
            : "hover:bg-sidebar-accent"
        }`}
      >
        <BarChart3 className="h-4 w-4" />
        {t("dashboards")}
      </Link>
      {presentationsActive && (
        <Link
          href="/presentations"
          className={`flex items-center gap-2 px-2 py-1.5 rounded-md text-sm transition-colors ${
            pathname.startsWith("/presentations")
              ? "bg-sidebar-accent font-medium"
              : "hover:bg-sidebar-accent"
          }`}
        >
          <Presentation className="h-4 w-4" />
          {t("presentations")}
        </Link>
      )}
      <Link
        href="/automations"
        className={`flex items-center gap-2 px-2 py-1.5 rounded-md text-sm transition-colors ${
          pathname.startsWith("/automations")
            ? "bg-sidebar-accent font-medium"
            : "hover:bg-sidebar-accent"
        }`}
      >
        <Workflow className="h-4 w-4" />
        {t("automations")}
      </Link>
      <Link
        href="/meet"
        className={`flex items-center gap-2 px-2 py-1.5 rounded-md text-sm transition-colors ${
          pathname.startsWith("/meet")
            ? "bg-sidebar-accent font-medium"
            : "hover:bg-sidebar-accent"
        }`}
      >
        <Video className="h-4 w-4" />
        {t("meetings")}
      </Link>
      <Link
        href="/organisation"
        className={`flex items-center gap-2 px-2 py-1.5 rounded-md text-sm transition-colors ${
          pathname.startsWith("/organisation")
            ? "bg-sidebar-accent font-medium"
            : "hover:bg-sidebar-accent"
        }`}
      >
        <Building2 className="h-4 w-4" />
        {t("organisation")}
      </Link>

      {/* Administration (socle admin/super_admin OU badge à surface admin) */}
      {user &&
        canAccessAdminArea(
          (user.globalRole ?? "viewer") as UserRole,
          (user.capabilities ?? []) as UserCapability[]
        ) && (
          <Link
            href="/admin"
            className={`flex items-center gap-2 px-2 py-1.5 rounded-md text-sm transition-colors ${
              pathname.startsWith("/admin")
                ? "bg-sidebar-accent font-medium"
                : "hover:bg-sidebar-accent"
            }`}
          >
            <Shield className="h-4 w-4" />
            {t("admin")}
          </Link>
        )}
    </nav>
  );
}
