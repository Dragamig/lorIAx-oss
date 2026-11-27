// @vitest-environment jsdom
import { afterEach, describe, expect, it, vi } from "vitest";
import { cleanup, fireEvent, render, screen } from "@testing-library/react";
import { SWRConfig } from "swr";
import { CrmScreen } from "./crm-screen";
import { ToggleFilter } from "./toggle-filter";

vi.mock("next-intl", async () => (await import("@/components/media/test-fixtures")).intlMock());
vi.mock("@/i18n/routing", () => ({
  Link: ({ href, children, ...rest }: { href: string; children: React.ReactNode }) => (
    <a href={href} {...rest}>
      {children}
    </a>
  ),
}));

const connection = {
  enabled: true,
  complete: true,
  canAdmin: true,
  roles: { dossiers: { connected: true, databaseId: "db-1", databaseName: "Affaires", spaceName: "Direction" } },
};

function wrap(ui: React.ReactElement, conn: unknown = connection) {
  vi.stubGlobal("fetch", vi.fn(async () => ({ ok: true, json: async () => conn })));
  return render(<SWRConfig value={{ provider: () => new Map(), dedupingInterval: 0 }}>{ui}</SWRConfig>);
}

afterEach(() => {
  cleanup();
  vi.unstubAllGlobals();
});

describe("CrmScreen", () => {
  it("affiche un squelette annoncé pendant le chargement", () => {
    wrap(<CrmScreen title="Pipeline" role="dossiers" state="loading" />);
    expect(screen.getByRole("status")).toBeTruthy();
  });

  it("affiche l'erreur et Réessayer appelle onRetry", async () => {
    const onRetry = vi.fn();
    wrap(<CrmScreen title="Pipeline" role="dossiers" state="error" onRetry={onRetry} />);
    expect(screen.getByRole("alert")).toBeTruthy();
    fireEvent.click(screen.getByRole("button", { name: "Réessayer" }));
    expect(onRetry).toHaveBeenCalledTimes(1);
    const links = await screen.findAllByText("Ouvrir dans Bases");
    expect(links.length).toBeGreaterThan(0);
    for (const l of links) expect(l.closest("a")?.getAttribute("href")).toBe("/bases/db-1");
  });

  it("l'état erreur n'offre pas de lien Bases tant que la base du rôle est inconnue", async () => {
    wrap(<CrmScreen title="Pipeline" role="dossiers" state="error" />, { roles: {} });
    await screen.findByText("Aucune base raccordée");
    expect(screen.queryByText("Ouvrir dans Bases")).toBeNull();
  });

  it("l'état non raccordé renvoie vers le raccordement (administrateur)", async () => {
    wrap(<CrmScreen title="Pipeline" role="dossiers" state="notConnected" />);
    expect((await screen.findByRole("link", { name: "Raccordement" })).getAttribute("href")).toBe("/crm/raccordement");
  });

  it("connexion incomplète : avis avec lien Raccordement pour un administrateur", async () => {
    wrap(
      <CrmScreen title="Pipeline" role="dossiers" state="ready" missing={["statut"]}>
        <p>contenu</p>
      </CrmScreen>,
    );
    expect((await screen.findByTestId("crm-fields-notice")).textContent).toContain("Statut");
    expect((await screen.findByRole("link", { name: "Raccordement" })).getAttribute("href")).toBe("/crm/raccordement");
  });

  it("connexion incomplète : un membre voit l'avis sans lien Raccordement", async () => {
    wrap(
      <CrmScreen title="Pipeline" role="dossiers" state="ready" missing={["statut"]}>
        <p>contenu</p>
      </CrmScreen>,
      { ...connection, canAdmin: false },
    );
    await screen.findByTestId("crm-fields-notice");
    expect(screen.queryByRole("link", { name: "Raccordement" })).toBeNull();
  });

  it("affiche la barre de source avec le nom de la base et le lien vers Bases", async () => {
    wrap(
      <CrmScreen title="Pipeline" role="dossiers" state="ready" tools={<span>outil</span>}>
        <p>contenu</p>
      </CrmScreen>,
    );
    expect(await screen.findByText("Source : Affaires, espace Direction")).toBeTruthy();
    expect(screen.getByRole("link", { name: "Ouvrir dans Bases : Affaires" }).getAttribute("href")).toBe("/bases/db-1");
    expect(screen.getByText("contenu")).toBeTruthy();
    expect(screen.getByText("outil")).toBeTruthy();
  });

  it("sans base raccordée, la barre le dit et n'offre pas de lien", async () => {
    wrap(<CrmScreen title="Pipeline" role="dossiers" state="ready" />, { roles: {} });
    expect(await screen.findByText("Aucune base raccordée")).toBeTruthy();
    expect(screen.queryByRole("link")).toBeNull();
  });

  it("pendant le chargement du raccordement, la barre n'affirme pas qu'aucune base n'est raccordée", async () => {
    vi.stubGlobal("fetch", vi.fn(() => new Promise(() => {})));
    render(
      <SWRConfig value={{ provider: () => new Map(), dedupingInterval: 0 }}>
        <CrmScreen title="Pipeline" role="dossiers" state="ready" />
      </SWRConfig>,
    );
    expect(await screen.findByText("Chargement de la source")).toBeTruthy();
    expect(screen.queryByText("Aucune base raccordée")).toBeNull();
  });

  it("si le raccordement est en erreur, la barre signale la source indisponible", async () => {
    vi.stubGlobal("fetch", vi.fn(async () => ({ ok: false, status: 500, json: async () => ({}) })));
    render(
      <SWRConfig value={{ provider: () => new Map(), dedupingInterval: 0, shouldRetryOnError: false }}>
        <CrmScreen title="Pipeline" role="dossiers" state="ready" />
      </SWRConfig>,
    );
    expect(await screen.findByText("Source indisponible")).toBeTruthy();
    expect(screen.queryByText("Aucune base raccordée")).toBeNull();
  });
});

describe("ToggleFilter", () => {
  it("reflète aria-pressed et appelle onToggle", () => {
    const onToggle = vi.fn();
    render(<ToggleFilter actionId="pipelineMine" pressed onToggle={onToggle} />);
    const b = screen.getByRole("button");
    expect(b.getAttribute("aria-pressed")).toBe("true");
    fireEvent.click(b);
    expect(onToggle).toHaveBeenCalledTimes(1);
  });

  it("désactivé : la raison est dans l'info-bulle et le clic est sans effet", async () => {
    const onToggle = vi.fn();
    render(<ToggleFilter actionId="pipelineMine" pressed={false} onToggle={onToggle} disabledReason="Raison X" />);
    const b = screen.getByRole("button");
    expect(b.getAttribute("aria-disabled")).toBe("true");
    fireEvent.click(b);
    expect(onToggle).not.toHaveBeenCalled();
    fireEvent.focus(b);
    fireEvent.mouseEnter(b);
    expect(await screen.findByText("Raison X")).toBeTruthy();
  });
});
