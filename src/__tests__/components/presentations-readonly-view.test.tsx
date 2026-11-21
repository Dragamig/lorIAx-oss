// @vitest-environment jsdom
/**
 * Lecteur d'espace sur une présentation (revue finale, I4) : aperçu sans
 * moteur, bandeau lecture seule, aucun bouton d'écriture.
 */
import { afterEach, describe, expect, it, vi } from "vitest";
import { cleanup, screen } from "@testing-library/react";
import { renderWithIntl } from "./support/render-intl";
import { PresentationReadOnlyView } from "@/components/presentations/presentation-readonly-view";

vi.mock("@/i18n/routing", () => ({
  Link: ({ href, children }: { href: unknown; children: React.ReactNode }) => (
    <a href={typeof href === "string" ? href : "#"}>{children}</a>
  ),
}));

const DECK = {
  format: "bento/slides",
  version: 1,
  docId: "11111111-1111-4111-8111-111111111111",
  title: "Pitch",
  size: { width: 1280, height: 720 },
  theme: { background: "#FFFFFF", color: "#1E2A3A", accent: "#F7A600", fontFamily: "Inter" },
  slides: [{ id: "s1", elements: [] }],
} as never;

afterEach(cleanup);

describe("vue en lecture seule d'une présentation", () => {
  it("aucune iframe, bandeau lecture seule, retour à la liste, pas de pastille de modèle", () => {
    renderWithIntl(<PresentationReadOnlyView title="Bilan" deck={DECK} />);
    expect(document.querySelector("iframe")).toBeNull();
    expect(screen.getByTestId("presentation-readonly-banner").textContent).toContain(
      "Présentation en lecture seule : Bilan"
    );
    expect(screen.getByText("Retour à la liste")).toBeTruthy();
    expect(screen.queryByRole("button", { name: "Terminer" })).toBeNull();
    expect(screen.getByRole("group", { name: "Diapositives du modèle" })).toBeTruthy();
    expect(document.querySelector("[data-template-badge]")).toBeNull();
  });
});
