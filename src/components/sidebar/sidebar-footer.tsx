"use client";

import { Link } from "@/i18n/routing";
import { signOut } from "next-auth/react";
import { Settings, LogOut, Moon, Sun, Users, MessageSquare, GraduationCap, Award } from "lucide-react";
import { UserAvatar } from "@/components/ui/user-avatar";
import { NotificationsDropdown } from "@/components/notifications/notifications-dropdown";
import { useTour } from "@/components/onboarding/tour-context";
import { HelpAssistant } from "@/components/help/help-assistant";
import { PresenceBadge } from "@/components/ui/presence-badge";
import { useMyStatus } from "@/hooks/use-my-status";
import { useTheme } from "@/contexts/theme-context";
import { useTranslations } from "next-intl";
import { LocaleSubMenu } from "@/components/LocaleSwitcher";
import useSWR from "swr";
import { AiCredit } from "@/components/layout/ai-credit";
import {
  DropdownMenu,
  DropdownMenuTrigger,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuSeparator,
  DropdownMenuGroup,
  DropdownMenuLabel,
} from "@/components/ui/dropdown-menu";

interface SidebarFooterProps {
  user: {
    name?: string | null;
    email: string;
    avatarUrl?: string | null;
  } | null;
}

const fetcher = (url: string) => fetch(url).then((r) => r.json());

export function SidebarFooter({ user }: SidebarFooterProps) {
  const t = useTranslations("shell.userMenu");
  const { effectiveStatus } = useMyStatus();
  const { darkMode, toggleDarkMode } = useTheme();
  const { data: channels } = useSWR<{ unreadCount: number }[]>("/api/chat/channels", fetcher, { refreshInterval: 15000 });
  const unreadTotal = channels?.reduce((sum, c) => sum + (c.unreadCount ?? 0), 0) ?? 0;
  const tour = useTour();

  return (
    <div className="p-3 border-t border-sidebar-border">
      <div className="flex items-center gap-1">
        <div className="flex-1 min-w-0">
        <DropdownMenu>
          <DropdownMenuTrigger
            render={
              <button data-tour="user-menu" className="flex flex-1 min-w-0 items-center gap-2 rounded-md px-1.5 py-1 hover:bg-sidebar-accent transition-colors text-left cursor-pointer" />
            }
          >
            {user && (
              <div className="relative shrink-0">
                <UserAvatar email={user.email} avatarUrl={user.avatarUrl} size={32} />
                <PresenceBadge status={effectiveStatus} size="sm" />
              </div>
            )}
            <div className="flex-1 min-w-0">
              <p className="text-sm font-medium truncate leading-tight">{user?.name}</p>
              <p className="text-xs text-muted-foreground truncate leading-tight">{user?.email}</p>
            </div>
          </DropdownMenuTrigger>

          <DropdownMenuContent side="top" align="start" sideOffset={8} className="w-56">
            <DropdownMenuGroup>
              <DropdownMenuLabel className="font-normal pb-2">
                <div className="flex items-center gap-2">
                  {user && (
                    <div className="relative shrink-0">
                      <UserAvatar email={user.email} avatarUrl={user.avatarUrl} size={28} />
                      <PresenceBadge status={effectiveStatus} size="sm" />
                    </div>
                  )}
                  <div className="flex flex-col min-w-0">
                    <p className="font-medium text-sm truncate">{user?.name}</p>
                    <p className="text-xs text-muted-foreground truncate">{user?.email}</p>
                  </div>
                </div>
              </DropdownMenuLabel>
            </DropdownMenuGroup>
            <DropdownMenuSeparator />
            <DropdownMenuItem onClick={toggleDarkMode}>
              {darkMode ? <Sun className="h-4 w-4" /> : <Moon className="h-4 w-4" />}
              {darkMode ? t("lightMode") : t("darkMode")}
            </DropdownMenuItem>
            <DropdownMenuItem
              onClick={() => window.dispatchEvent(new CustomEvent("loriax:toggle-team-panel"))}
            >
              <Users className="h-4 w-4" />
              {t("myTeam")}
            </DropdownMenuItem>
            <DropdownMenuSeparator />
            <DropdownMenuItem render={<Link href="/settings" />}>
              <Settings className="h-4 w-4" />
              {t("settings")}
            </DropdownMenuItem>
            <DropdownMenuItem render={<Link href="/settings/profile" />}>
              <Award className="h-4 w-4" />
              {t("myBadges")}
            </DropdownMenuItem>
            <DropdownMenuItem onClick={() => void tour.open()}>
              <GraduationCap className="h-4 w-4" />
              {t("relaunchTour")}
            </DropdownMenuItem>
            <LocaleSubMenu label={t("language")} />
            <DropdownMenuSeparator />
            <DropdownMenuItem
              className="text-destructive focus:text-destructive"
              onClick={() => signOut({ callbackUrl: "/login" })}
            >
              <LogOut className="h-4 w-4" />
              {t("signOut")}
            </DropdownMenuItem>
          </DropdownMenuContent>
        </DropdownMenu>
        </div>

        <button
          onClick={() => window.dispatchEvent(new CustomEvent("loriax:toggle-chat-panel"))}
          className="relative shrink-0 p-1.5 rounded-md hover:bg-sidebar-accent transition-colors"
          title={t("messaging")}
        >
          <MessageSquare className="h-4 w-4" />
          {unreadTotal > 0 && (
            <span className="absolute -top-0.5 -right-0.5 bg-destructive text-destructive-foreground text-[10px] rounded-full w-3.5 h-3.5 flex items-center justify-center leading-none">
              {unreadTotal > 9 ? "9+" : unreadTotal}
            </span>
          )}
        </button>
        <HelpAssistant />
        <NotificationsDropdown />
      </div>
      <AiCredit className="mt-2 px-1.5 leading-tight" />
    </div>
  );
}
