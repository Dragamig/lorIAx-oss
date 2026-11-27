// @vitest-environment jsdom
import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { cleanup, screen, waitFor } from "@testing-library/react";
import { renderWithIntl } from "@/__tests__/components/support/render-intl";

let tokenParam: string | null = "tok";
vi.mock("next/navigation", () => ({
  useSearchParams: () => ({ get: (k: string) => (k === "token" ? tokenParam : null) }),
}));
vi.mock("@/i18n/routing", () => ({
  Link: ({ href, children, ...rest }: { href: string; children: React.ReactNode }) => (
    <a href={href} {...rest}>{children}</a>
  ),
  useRouter: () => ({ push: vi.fn() }),
}));
vi.mock("sonner", () => ({ toast: Object.assign(vi.fn(), { success: vi.fn(), error: vi.fn() }) }));

import VerifyEmailPage from "@/app/[locale]/(auth)/verify-email/page";

const fetchMock = vi.fn();
const json = (b: unknown, status = 200) =>
  Promise.resolve(new Response(JSON.stringify(b), { status, headers: { "Content-Type": "application/json" } }));

beforeEach(() => {
  tokenParam = "tok";
  fetchMock.mockReset();
  vi.stubGlobal("fetch", fetchMock);
});
afterEach(() => {
  cleanup();
  vi.unstubAllGlobals();
});

describe("AZ-27 verify-email page", () => {
  it("makes no network call during the initial server render (GET only)", async () => {
    const { renderToString } = await import("react-dom/server");
    const { NextIntlClientProvider } = await import("next-intl");
    const fr = (await import("../../../messages/fr.json")).default;
    renderToString(
      <NextIntlClientProvider locale="fr" messages={fr}>
        <VerifyEmailPage />
      </NextIntlClientProvider>,
    );
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it("after mount, POSTs the token and shows done", async () => {
    fetchMock.mockReturnValue(json({ status: "verified" }));
    renderWithIntl(<VerifyEmailPage />);
    await screen.findByText("Adresse vérifiée");
    expect(fetchMock).toHaveBeenCalledTimes(1);
    const [url, init] = fetchMock.mock.calls[0];
    expect(url).toBe("/api/auth/verify-email");
    expect(init.method).toBe("POST");
    expect(JSON.parse(init.body)).toEqual({ token: "tok" });
  });

  it("400 expired shows expired", async () => {
    fetchMock.mockReturnValue(json({ status: "expired" }, 400));
    renderWithIntl(<VerifyEmailPage />);
    await screen.findByText("Lien expiré");
  });

  it("400 used shows used", async () => {
    fetchMock.mockReturnValue(json({ status: "used" }, 400));
    renderWithIntl(<VerifyEmailPage />);
    await screen.findByText("Lien déjà utilisé");
  });

  it("400 invalid shows expired", async () => {
    fetchMock.mockReturnValue(json({ status: "invalid" }, 400));
    renderWithIntl(<VerifyEmailPage />);
    await screen.findByText("Lien expiré");
  });

  it("429 shows the network error with retry, not expired", async () => {
    fetchMock.mockReturnValue(json({}, 429));
    renderWithIntl(<VerifyEmailPage />);
    await screen.findByRole("heading", { name: "Erreur réseau, réessayez." });
    expect(screen.getByRole("button", { name: "Erreur réseau, réessayez." })).toBeTruthy();
    expect(screen.queryByText("Lien expiré")).toBeNull();
  });

  it("missing token shows expired without any call", async () => {
    tokenParam = null;
    renderWithIntl(<VerifyEmailPage />);
    await screen.findByText("Lien expiré");
    await waitFor(() => expect(fetchMock).not.toHaveBeenCalled());
  });
});
