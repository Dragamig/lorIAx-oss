// @vitest-environment jsdom
import { afterEach, describe, expect, it } from "vitest";
import { cleanup, screen } from "@testing-library/react";
import { renderWithIntl } from "@/__tests__/components/support/render-intl";
import { FailedToast } from "../sent-toast";

afterEach(cleanup);

describe("FailedToast", () => {
  it("le bouton Réessayer porte une icône", () => {
    renderWithIntl(<FailedToast message="Échec" onRetry={() => {}} onDismiss={() => {}} />);
    const btn = screen.getByRole("button", { name: "Réessayer" });
    expect(btn.querySelector("svg")).not.toBeNull();
  });
});
