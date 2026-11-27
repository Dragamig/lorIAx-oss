// @vitest-environment jsdom
import { afterEach, describe, expect, it, vi } from "vitest";
import { cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react";
import { NextIntlClientProvider } from "next-intl";
import fr from "../../../../messages/fr.json";
import { ContactSection } from "./contact-section";
import { makeDealSheetDto } from "./deal-sheet-fixture";

vi.mock("sonner", () => ({ toast: Object.assign(vi.fn(), { success: vi.fn(), error: vi.fn() }) }));
vi.mock("@/components/editor/extensions/database-block/database-cell-editor", () => ({
  CellEditor: ({ onChange }: { onChange: (v: string[]) => void }) => (
    <button type="button" data-testid="pick" onClick={() => onChange(["k2"])}>
      pick
    </button>
  ),
}));

afterEach(cleanup);

function setup(onChangeContact: (v: unknown) => Promise<boolean>) {
  render(
    <NextIntlClientProvider locale="fr" messages={fr}>
      <ContactSection
        dto={makeDealSheetDto()}
        relationData={{} as never}
        onOpenContact={() => undefined}
        onChangeContact={onChangeContact as never}
      />
    </NextIntlClientProvider>,
  );
  fireEvent.click(screen.getByRole("button", { name: "Changer le contact du dossier" }));
}

describe("ContactSection : Changer de contact", () => {
  it("se replie après un choix réussi", async () => {
    setup(async () => true);
    fireEvent.click(screen.getByTestId("pick"));
    await waitFor(() => expect(screen.queryByTestId("pick")).toBeNull());
  });

  it("reste ouvert après un échec", async () => {
    const fn = vi.fn(async () => false);
    setup(fn);
    fireEvent.click(screen.getByTestId("pick"));
    await waitFor(() => expect(fn).toHaveBeenCalled());
    expect(screen.getByTestId("pick")).toBeTruthy();
  });
});
