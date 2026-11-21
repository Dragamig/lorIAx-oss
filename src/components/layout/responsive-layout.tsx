"use client";

import { useState, useEffect, useRef } from "react";
import { Menu, ChevronsLeft } from "lucide-react";
import { AppSidebar } from "@/components/sidebar/app-sidebar";
import { MobileHeader } from "@/components/layout/mobile-header";
import { BottomTabs } from "@/components/layout/bottom-tabs";
import { usePathname } from "@/i18n/routing";
import { useTranslations } from "next-intl";
import { useSidebarResize } from "@/hooks/use-sidebar-resize";
import { useIsMobile } from "@/hooks/use-mobile";
import { NetworkStatusBanner } from "@/components/network-status-banner";
import { syncManager } from "@/lib/offline/sync-manager";

export function ResponsiveLayout({ children }: { children: React.ReactNode }) {
  const t = useTranslations("shell.sidebar");
  const [sidebarOpen, setSidebarOpen] = useState(false);
  const isMobile = useIsMobile();
  const [mounted, setMounted] = useState(false);
  const [hoverHandle, setHoverHandle] = useState(false);
  const pathname = usePathname();
  const syncInitRef = useRef(false);
  const {
    width,
    collapsed,
    isDragging,
    toggleCollapsed,
    handleMouseDown,
    handleDoubleClick,
  } = useSidebarResize();

  // Initialize SyncManager singleton once at app level
  useEffect(() => {
    if (!syncInitRef.current) {
      syncManager.init();
      syncInitRef.current = true;
    }
  }, []);

  // Activer les transitions après le montage
  useEffect(() => {
    requestAnimationFrame(() => setMounted(true));
  }, []);

  // Fermer l'overlay sidebar quand on repasse en desktop
  useEffect(() => {
    if (!isMobile) setSidebarOpen(false);
  }, [isMobile]);

  // Fermer la sidebar à chaque navigation sur mobile
  useEffect(() => {
    if (isMobile) setSidebarOpen(false);
  }, [pathname, isMobile]);

  return (
    <div className="flex flex-col h-screen overflow-hidden">
      <NetworkStatusBanner />
      <div className="flex flex-1 overflow-hidden">
      {/* Overlay mobile */}
      {isMobile && sidebarOpen && (
        <div
          className="fixed inset-0 bg-black/50 z-40 md:hidden"
          onClick={() => setSidebarOpen(false)}
        />
      )}

      {/* Sidebar desktop */}
      {!isMobile && (
        <div
          className="relative flex-shrink-0 group/sidebar"
          style={{
            width: collapsed ? 0 : width,
            transition: !mounted || isDragging ? "none" : "width 200ms ease",
          }}
        >
          {/* Sidebar content (overflow hidden during collapse) */}
          <div
            className="h-full overflow-hidden"
            style={{
              width: collapsed ? 0 : width,
              minWidth: collapsed ? 0 : width,
              transition: isDragging ? "none" : "width 200ms ease, min-width 200ms ease",
            }}
          >
            <AppSidebar />
          </div>

          {/* Collapse button — visible on sidebar hover */}
          {!collapsed && (
            <button
              onClick={toggleCollapsed}
              className="absolute top-3 right-2 z-10 p-1 rounded-md
                opacity-0 group-hover/sidebar:opacity-100
                hover:bg-sidebar-accent text-sidebar-foreground/60 hover:text-sidebar-foreground
                transition-opacity duration-150"
              title={t("collapseAria")}
            >
              <ChevronsLeft className="h-4 w-4" />
            </button>
          )}

          {/* Resize handle */}
          {!collapsed && (
            <div
              className="absolute top-0 right-0 w-1 h-full cursor-col-resize z-20
                hover:bg-primary/30 active:bg-primary/50 transition-colors"
              onMouseDown={handleMouseDown}
              onDoubleClick={handleDoubleClick}
              onMouseEnter={() => setHoverHandle(true)}
              onMouseLeave={() => setHoverHandle(false)}
              style={{
                backgroundColor: isDragging
                  ? "var(--color-primary)"
                  : hoverHandle
                    ? "hsl(var(--primary) / 0.3)"
                    : "transparent",
              }}
            />
          )}
        </div>
      )}

      {/* Mobile sidebar (behavior unchanged) */}
      {isMobile && (
        <div
          className={`
            fixed inset-y-0 left-0 z-50 transform transition-transform duration-200 ease-in-out
            ${!sidebarOpen ? "-translate-x-full" : "translate-x-0"}
          `}
          style={{ width: 256 }}
        >
          <AppSidebar />
        </div>
      )}

      {/* Mobile header — always rendered, hidden on desktop via CSS */}
      <MobileHeader onOpenMenu={() => setSidebarOpen(true)} />

      {/* Contenu principal */}
      <main
        className={`flex-1 overflow-y-auto relative min-w-0 pt-14 pb-[calc(4rem+env(safe-area-inset-bottom))] md:pt-0 md:pb-0 transition-[padding] duration-200 ${
          !isMobile && collapsed ? "md:pl-4" : ""
        }`}
      >

        {/* Expand sidebar tab (desktop, when collapsed) */}
        {!isMobile && collapsed && (
          <button
            onClick={toggleCollapsed}
            title={t("expandAria")}
            className="group fixed top-3 left-0 z-30 h-10 w-4 flex items-center justify-center
              hover:bg-accent/40 transition-colors rounded-r-md"
          >
            <span className="absolute inset-y-0 left-0 w-px bg-border group-hover:bg-primary/60 transition-colors" />
            <Menu className="h-3.5 w-3.5 text-foreground/40 group-hover:text-foreground transition-colors" />
          </button>
        )}

        {children}
      </main>

      {/* Mobile bottom tabs — always rendered, hidden on desktop via CSS */}
      <BottomTabs />
      </div>
    </div>
  );
}
