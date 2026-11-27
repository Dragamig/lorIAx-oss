// @vitest-environment jsdom
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { cleanup, render, screen, within } from "@testing-library/react";
import { ActivationAutomationsRecap } from "./activation-automations-recap";
import { saveActivationHandoff, takeActivationHandoff } from "./activation-handoff";

vi.mock("next-intl", async () => (await import("@/components/media/test-fixtures")).intlMock());
vi.mock("@/i18n/routing", () => ({
  Link: ({ children, href, ...rest }: { children: React.ReactNode; href: string }) => (
    <a href={href} {...rest}>
      {children}
    </a>
  ),
}));

afterEach(cleanup);

const ALL = ["quoteFollowUp", "waitingFollowUp", "wonClose", "lostClose", "dailyReminders", "receptionTally"];
const HREF = "/automations?spaceId=sp1";

describe("ActivationAutomationsRecap", () => {
  it("cas nominal : compte, lien, options de Statut et mention Tally, sans avertissement", () => {
    render(<ActivationAutomationsRecap created={ALL} skipped={[]} statusOptionsAdded={["Devis envoyé", "En attente client"]} automationsHref={HREF} />);
    expect(screen.getByText("6 automatismes d'exemple créés, désactivés")).toBeTruthy();
    expect(screen.getByText(/2 options de Statut ajoutées : Devis envoyé, En attente client/)).toBeTruthy();
    expect(screen.getByText(/formulaire à choisir avant de l'activer/)).toBeTruthy();
    expect(screen.queryByRole("alert")).toBeNull();
    const link = screen.getByRole("link", { name: "Voir dans Automatisations" });
    expect(link.getAttribute("href")).toBe(HREF);
    expect(link.getAttribute("data-action")).toBe("openAutomations");
    expect(link.querySelector("svg")?.getAttribute("aria-hidden")).toBe("true");
  });

  it("affiche les noms localisés des automatismes créés, jamais les clés", () => {
    render(<ActivationAutomationsRecap created={["wonClose"]} skipped={[]} statusOptionsAdded={[]} automationsHref={HREF} />);
    expect(screen.getByText(/1 automatisme d'exemple créé, désactivé/)).toBeTruthy();
    expect(screen.getByText(/Gagnée : clôture et trace/)).toBeTruthy();
    expect(screen.queryByText(/wonClose/)).toBeNull();
    expect(screen.queryByText(/Statut ajout/)).toBeNull();
    expect(screen.queryByText(/formulaire à choisir/)).toBeNull();
  });

  it("cas dégradé : avertissement annoncé pour les exemples non créés", () => {
    render(<ActivationAutomationsRecap created={ALL.slice(0, 5)} skipped={["receptionTally"]} statusOptionsAdded={[]} automationsHref={HREF} />);
    const alert = screen.getByRole("alert");
    expect(within(alert).getByText(/1 automatisme non créé/)).toBeTruthy();
    expect(alert.textContent).toContain("Réception Tally");
    expect(screen.queryByText(/formulaire à choisir/)).toBeNull();
  });

  it("rien à montrer : aucun rendu", () => {
    const { container } = render(<ActivationAutomationsRecap created={[]} skipped={[]} statusOptionsAdded={[]} automationsHref={HREF} />);
    expect(container.firstChild).toBeNull();
  });
});

describe("transmission de l'activation", () => {
  beforeEach(() => sessionStorage.clear());

  it("lit une seule fois puis efface", () => {
    saveActivationHandoff({ created: ["wonClose"], skipped: [], statusOptionsAdded: ["X"] });
    expect(takeActivationHandoff()).toEqual({ created: ["wonClose"], skipped: [], statusOptionsAdded: ["X"] });
    expect(takeActivationHandoff()).toBeNull();
  });

  it("ignore une valeur invalide", () => {
    sessionStorage.setItem("crm.activation.handoff", "{oops");
    expect(takeActivationHandoff()).toBeNull();
  });
});
