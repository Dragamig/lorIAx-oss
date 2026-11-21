// @vitest-environment jsdom
import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { render, screen, fireEvent, waitFor, cleanup } from "@testing-library/react";

const push = vi.fn();
vi.mock("@/i18n/routing", () => ({ useRouter: () => ({ push }) }));
vi.mock("next-intl", () => ({
  useTranslations: () => (k: string) => k,
  useFormatter: () => ({ dateTime: () => "date" }),
}));
vi.mock("@/components/ui/dropdown-menu", () => ({
  DropdownMenu: ({ children }: { children: React.ReactNode }) => <div>{children}</div>,
  DropdownMenuTrigger: ({ children }: { children: React.ReactNode }) => <button>{children}</button>,
  DropdownMenuContent: ({ children }: { children: React.ReactNode }) => <div>{children}</div>,
  DropdownMenuSeparator: () => <hr />,
}));

import { NotificationsDropdown } from "@/components/notifications/notifications-dropdown";

const mk = (over: Record<string, unknown>) => ({
  id: "n",
  type: "mention",
  title: "Titre",
  message: null,
  read: true,
  createdAt: new Date().toISOString(),
  documentId: null,
  databaseId: null,
  rowId: null,
  documentTitle: null,
  spaceSlug: null,
  actor: null,
  ...over,
});

function mockFetch(list: unknown[]) {
  vi.stubGlobal(
    "fetch",
    vi.fn(async () => ({
      ok: true,
      json: async () => ({ notifications: list, unreadCount: 0 }),
    }))
  );
}

beforeEach(() => push.mockClear());
afterEach(() => {
  cleanup();
  vi.unstubAllGlobals();
});

describe("NotificationsDropdown : clic", () => {
  it("notification de ligne : navigation vers /bases/{id}?row={rowId}", async () => {
    mockFetch([mk({ title: "Ligne", databaseId: "db-9", rowId: "row-7" })]);
    render(<NotificationsDropdown />);
    fireEvent.click(await waitFor(() => screen.getByText("Ligne")));
    expect(push).toHaveBeenCalledWith("/bases/db-9?row=row-7");
  });

  it("notification de document et de média : navigation inchangée", async () => {
    mockFetch([
      mk({ id: "d", title: "Doc", documentId: "doc-1", spaceSlug: "esp" }),
      mk({ id: "m", title: "Media", type: "media" }),
    ]);
    render(<NotificationsDropdown />);
    fireEvent.click(await waitFor(() => screen.getByText("Doc")));
    expect(push).toHaveBeenLastCalledWith("/s/esp/doc-1");
    fireEvent.click(screen.getByText("Media"));
    expect(push).toHaveBeenLastCalledWith("/mediatheque?view=trash");
  });
});
