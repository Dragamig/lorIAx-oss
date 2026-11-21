// @vitest-environment jsdom
import { describe, it, expect, vi, afterEach } from "vitest";
import { render, screen, cleanup, waitFor } from "@testing-library/react";

vi.mock("next-intl", () => ({ useTranslations: () => (k: string) => k }));
vi.mock("next-auth/react", () => ({ signIn: vi.fn() }));
vi.mock("next/navigation", () => ({ useSearchParams: () => new URLSearchParams() }));
vi.mock("next/image", () => ({ default: () => null }));
vi.mock("@/i18n/routing", () => ({
  useRouter: () => ({ push: vi.fn(), refresh: vi.fn() }),
  Link: ({ href, children }: { href: string; children: React.ReactNode }) => <a href={href}>{children}</a>,
}));

import LoginPage from "./page";

afterEach(() => {
  cleanup();
  vi.unstubAllGlobals();
});

function stubStatus(open: boolean) {
  const fetchMock = vi.fn(async () => ({ ok: true, json: async () => ({ open }) }));
  vi.stubGlobal("fetch", fetchMock);
  return fetchMock;
}

describe("page de connexion : lien d'inscription", () => {
  it("masque le lien quand l'inscription est fermee", async () => {
    const f = stubStatus(false);
    render(<LoginPage />);
    await waitFor(() => expect(f).toHaveBeenCalledWith("/api/auth/registration-status", expect.anything()));
    expect(screen.queryByText("createAccount")).toBeNull();
  });
  it("affiche le lien quand l'inscription est ouverte", async () => {
    stubStatus(true);
    render(<LoginPage />);
    await waitFor(() => expect(screen.getByText("createAccount")).toBeTruthy());
  });
});
