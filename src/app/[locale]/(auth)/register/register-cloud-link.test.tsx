// @vitest-environment jsdom
import { describe, it, expect, vi, afterEach, beforeEach } from "vitest";
import { render, screen, cleanup, fireEvent, waitFor } from "@testing-library/react";

vi.mock("next-intl", () => ({ useTranslations: () => (k: string) => k }));
vi.mock("next-auth/react", () => ({ signIn: vi.fn() }));
vi.mock("next/image", () => ({ default: () => null }));
vi.mock("@/i18n/routing", () => ({
  useRouter: () => ({ push: vi.fn(), refresh: vi.fn() }),
  Link: ({ href, children }: { href: string; children: React.ReactNode }) => <a href={href}>{children}</a>,
}));
vi.mock("@/lib/modules/hooks.client.generated", () => ({ registerIncludedModuleHooks: () => {} }));

import { resetClientSlotsForTests, registerClientSlots } from "@/lib/modules/hooks.client";
import RegisterPage from "./page";

beforeEach(() => {
  resetClientSlotsForTests();
  vi.stubGlobal(
    "fetch",
    vi.fn(async () => ({ ok: false, json: async () => ({ error: "Organisation requise", needsOrg: true }) })),
  );
});
afterEach(() => {
  cleanup();
  vi.unstubAllGlobals();
});

async function submit() {
  const { container } = render(<RegisterPage />);
  fireEvent.change(container.querySelector("#name")!, { target: { value: "A" } });
  fireEvent.change(container.querySelector("#email")!, { target: { value: "a@b.fr" } });
  fireEvent.change(container.querySelector("#password")!, { target: { value: "motdepasse12" } });
  fireEvent.submit(container.querySelector("form")!);
  await waitFor(() => expect(screen.getByText(/Organisation requise/)).toBeTruthy());
  return container;
}

describe("page d'inscription du noyau", () => {
  it("core_auth_pages_do_not_link_to_signup_without_commercial", async () => {
    const c = await submit();
    expect(c.querySelector('a[href="/signup"]')).toBeNull();
  });

  it("links_to_signup_when_the_cloud_slot_is_registered", async () => {
    registerClientSlots({ cloudSignup: true });
    const c = await submit();
    expect(c.querySelector('a[href="/signup"]')).not.toBeNull();
  });
});
