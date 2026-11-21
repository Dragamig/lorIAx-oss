// @vitest-environment jsdom
import { describe, it, expect, vi } from "vitest";
import { render, screen } from "@testing-library/react";
import AuthLayout from "./layout";

vi.mock("@/components/layout/ai-credit", () => ({
  AiCredit: () => <span data-testid="ai-credit">credit</span>,
}));

describe("AuthLayout", () => {
  it("auth_layout_renders_credit_in_footer_after_main", () => {
    render(
      <AuthLayout>
        <div data-testid="child" />
      </AuthLayout>,
    );
    const footer = screen.getByRole("contentinfo");
    expect(footer.contains(screen.getByTestId("ai-credit"))).toBe(true);
    const main = screen.getByRole("main");
    expect(main.contains(screen.getByTestId("child"))).toBe(true);
    expect(main.compareDocumentPosition(footer) & Node.DOCUMENT_POSITION_FOLLOWING).toBeTruthy();
  });
});
