// @vitest-environment jsdom
import { describe, it, expect, vi, afterEach, beforeEach } from "vitest";
import { render, screen, cleanup } from "@testing-library/react";
import type { ReactNode } from "react";

vi.mock("@/lib/modules/hooks.client.generated", () => ({ registerIncludedModuleHooks: () => {} }));
vi.mock("next-auth/react", () => ({ SessionProvider: ({ children }: { children: ReactNode }) => <>{children}</> }));
vi.mock("@/contexts/theme-context", () => ({ ThemeProvider: ({ children }: { children: ReactNode }) => <>{children}</> }));
vi.mock("./appearance-provider", () => ({ AppearanceProvider: ({ children }: { children: ReactNode }) => <>{children}</> }));

import { Providers } from "./providers";
import { registerClientSlots, resetClientSlotsForTests } from "@/lib/modules/hooks.client";

beforeEach(() => resetClientSlotsForTests());
afterEach(cleanup);

describe("Providers", () => {
  it("providers_without_license_slot_renders_children_only", () => {
    render(
      <Providers licenseData={{ plan: "growth", valid: true, expired: false, gracePeriod: false }}>
        <span data-testid="child">contenu</span>
      </Providers>,
    );
    expect(screen.getByTestId("child").textContent).toBe("contenu");
  });

  it("providers_with_slot_hands_license_data_to_the_slot_provider", () => {
    const seen = vi.fn();
    registerClientSlots({
      LicenseProvider: ({ license, children }) => {
        seen(license);
        return <div data-testid="slot">{children}</div>;
      },
    });
    const data = { plan: "growth" as const, valid: true, expired: false, gracePeriod: false };
    render(
      <Providers licenseData={data}>
        <span data-testid="child">x</span>
      </Providers>,
    );
    expect(screen.getByTestId("slot")).toBeTruthy();
    expect(seen).toHaveBeenCalledWith(data);
  });

  it("providers_with_slot_and_no_license_passes_null", () => {
    const seen = vi.fn();
    registerClientSlots({
      LicenseProvider: ({ license, children }) => {
        seen(license);
        return <>{children}</>;
      },
    });
    render(<Providers><span>x</span></Providers>);
    expect(seen).toHaveBeenCalledWith(null);
  });
});
