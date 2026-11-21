"use client";

import { Home, Search, Plus, Calendar, Video } from "lucide-react";
import { Link, usePathname } from "@/i18n/routing";
import { useTranslations } from "next-intl";
import type { LucideIcon } from "lucide-react";

// Stable tab identifiers (not translated — labels come from t() inside the component).
type TabId = "home" | "search" | "new" | "calendar" | "meeting";

const TAB_HREFS: Record<TabId, string> = {
  home: "/",
  search: "/search",
  new: "/new",
  calendar: "/calendar",
  meeting: "/meet",
};

const TAB_ICONS: Record<TabId, LucideIcon> = {
  home: Home,
  search: Search,
  new: Plus,
  calendar: Calendar,
  meeting: Video,
};

const TAB_IDS: TabId[] = ["home", "search", "new", "calendar", "meeting"];

export function BottomTabs() {
  const t = useTranslations("shell.bottomTabs");
  const pathname = usePathname();

  return (
    <nav
      className="fixed bottom-0 left-0 right-0 z-30 flex items-center justify-around h-16 bg-background/95 backdrop-blur-sm border-t border-border md:hidden"
      style={{ paddingBottom: "env(safe-area-inset-bottom)" }}
    >
      {TAB_IDS.map((id) => {
        const href = TAB_HREFS[id];
        const Icon = TAB_ICONS[id];
        const label = t(id);
        const isActive =
          href === "/"
            ? pathname === "/"
            : pathname === href || pathname.startsWith(href + "/");

        return (
          <Link
            key={id}
            href={href}
            className={`flex flex-col items-center justify-center gap-1 flex-1 h-full transition-colors ${
              isActive
                ? "text-[var(--color-loriax-coral)] border-t-2 border-[var(--color-loriax-coral)]"
                : "text-muted-foreground"
            }`}
          >
            <Icon className="h-5 w-5" />
            <span className="text-[10px] leading-none">{label}</span>
          </Link>
        );
      })}
    </nav>
  );
}
