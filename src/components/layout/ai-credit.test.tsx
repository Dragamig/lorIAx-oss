// @vitest-environment jsdom
import { describe, it, expect, vi } from "vitest";
import { render, screen } from "@testing-library/react";
import { AiCredit, AI_CREDIT } from "./ai-credit";

vi.mock("next-intl", () => ({
  useTranslations: () => (key: string) =>
    key === "aiCredit" ? "Créé par Studio Dragamig avec l'aide de Claude d'Anthropic" : key,
}));
vi.mock("@/i18n/routing", () => ({ Link: ({ children }: { children: React.ReactNode }) => <a>{children}</a> }));
vi.mock("next-auth/react", () => ({ signOut: vi.fn() }));
vi.mock("swr", () => ({ default: () => ({ data: [] }) }));
vi.mock("@/components/ui/user-avatar", () => ({ UserAvatar: () => null }));
vi.mock("@/components/notifications/notifications-dropdown", () => ({ NotificationsDropdown: () => null }));
vi.mock("@/components/onboarding/tour-context", () => ({ useTour: () => ({ open: vi.fn() }) }));
vi.mock("@/components/help/help-assistant", () => ({ HelpAssistant: () => null }));
vi.mock("@/components/ui/presence-badge", () => ({ PresenceBadge: () => null }));
vi.mock("@/hooks/use-my-status", () => ({ useMyStatus: () => ({ effectiveStatus: "online" }) }));
vi.mock("@/contexts/theme-context", () => ({ useTheme: () => ({ darkMode: false, toggleDarkMode: vi.fn() }) }));
vi.mock("@/components/LocaleSwitcher", () => ({ LocaleSubMenu: () => null }));
vi.mock("@/components/ui/dropdown-menu", () => {
  const Pass = ({ children }: { children?: React.ReactNode }) => <div>{children}</div>;
  return {
    DropdownMenu: Pass,
    DropdownMenuTrigger: Pass,
    DropdownMenuContent: Pass,
    DropdownMenuItem: Pass,
    DropdownMenuSeparator: Pass,
    DropdownMenuGroup: Pass,
    DropdownMenuLabel: Pass,
  };
});

describe("AiCredit", () => {
  it("ai_credit_renders_exact_text", () => {
    render(<AiCredit />);
    expect(screen.getByTestId("ai-credit").textContent).toBe(
      "Créé par Studio Dragamig avec l'aide de Claude d'Anthropic",
    );
    expect(AI_CREDIT).toBe("Créé par Studio Dragamig avec l'aide de Claude d'Anthropic");
  });

  it("sidebar_footer_renders_ai_credit", async () => {
    const { SidebarFooter } = await import("@/components/sidebar/sidebar-footer");
    render(<SidebarFooter user={{ name: "A", email: "a@b.c" }} />);
    expect(screen.getByTestId("ai-credit")).toBeTruthy();
  });
});
