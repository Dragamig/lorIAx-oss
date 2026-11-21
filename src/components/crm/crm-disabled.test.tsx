// @vitest-environment jsdom
import { afterEach, describe, expect, it, vi } from "vitest";
import { cleanup, fireEvent, render, screen } from "@testing-library/react";
import { CrmDisabled } from "./crm-disabled";

vi.mock("next-intl", async () => (await import("@/components/media/test-fixtures")).intlMock());
vi.mock("@/i18n/routing", () => ({ useRouter: () => ({ refresh: vi.fn() }) }));
vi.mock("./activation-dialog", () => ({
  ActivationDialog: ({ open }: { open: boolean }) => (open ? <div role="dialog">assistant</div> : null),
}));

afterEach(cleanup);

describe("CrmDisabled", () => {
  it("bouton Activer ouvre la modale d'activation", () => {
    render(<CrmDisabled organisationName="Acme" isAdmin />);
    expect(screen.queryByRole("dialog")).toBeNull();
    fireEvent.click(screen.getByRole("button", { name: "Activer le module" }));
    expect(screen.getByRole("dialog")).toBeTruthy();
  });

  it("info-bulle et aria-label présents", () => {
    render(<CrmDisabled organisationName="Acme" isAdmin />);
    const btn = screen.getByRole("button", { name: "Activer le module" });
    expect(btn.getAttribute("aria-label")).toBe("Activer le module");
    fireEvent.focus(btn);
    expect(document.body.textContent).toContain("Choisir les bases et activer le module CRM");
  });

  it("non admin : bouton désactivé, ne s'ouvre pas", () => {
    render(<CrmDisabled organisationName="Acme" isAdmin={false} />);
    fireEvent.click(screen.getByRole("button", { name: "Activer le module" }));
    expect(screen.queryByRole("dialog")).toBeNull();
  });
});
