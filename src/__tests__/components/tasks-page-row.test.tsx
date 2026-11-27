// @vitest-environment jsdom
import { describe, it, expect, vi, afterEach } from "vitest";
import { screen, waitFor, cleanup } from "@testing-library/react";
import { SWRConfig } from "swr";
import { renderWithIntl } from "./support/render-intl";

vi.mock("@/i18n/routing", () => ({
  Link: ({ href, children, ...p }: { href: string; children: React.ReactNode }) => (
    <a href={href} {...p}>{children}</a>
  ),
}));

import TasksPage from "@/app/[locale]/(app)/tasks/page";

const task = (over: Record<string, unknown>) => ({
  id: "t",
  kind: "document_item",
  title: "Titre",
  status: "open",
  dueAt: null,
  documentTitle: null,
  eventTitle: null,
  documentUrl: null,
  ganttUrl: null,
  databaseId: null,
  rowId: null,
  databaseName: null,
  rowLink: null,
  restricted: false,
  ...over,
});

function mount(tasks: unknown[]) {
  vi.stubGlobal(
    "fetch",
    vi.fn(async () => ({ ok: true, json: async () => ({ tasks }) }))
  );
  renderWithIntl(
    <SWRConfig value={{ provider: () => new Map() }}>
      <TasksPage />
    </SWRConfig>
  );
}

afterEach(() => {
  cleanup();
  vi.unstubAllGlobals();
});

describe("Mes tâches, tâches de ligne", () => {
  it("une tâche de ligne affiche la source Fiche et un lien vers /bases/...?row=...", async () => {
    mount([task({ id: "r1", kind: "database_row", databaseName: "Clients", rowLink: "/bases/db-1?row=row-1" })]);
    await waitFor(() => expect(screen.getByText("Fiche")).toBeTruthy());
    expect(screen.getByText("Clients")).toBeTruthy();
    const link = screen.getByRole("link", { name: /Clients/ });
    expect(link.getAttribute("href")).toBe("/bases/db-1?row=row-1");
  });

  it("restricted : Accès restreint et aucun lien", async () => {
    mount([task({ id: "r1", kind: "database_row", restricted: true })]);
    await waitFor(() => expect(screen.getByText("Accès restreint")).toBeTruthy());
    expect(screen.queryByRole("link")).toBeNull();
  });

  it("les tâches de document gardent leur rendu", async () => {
    mount([task({ id: "d1", documentTitle: "Mon doc", documentUrl: "/s/x/d1" })]);
    await waitFor(() => expect(screen.getByText("Mon doc")).toBeTruthy());
    const links = screen.getAllByRole("link");
    expect(links.length).toBeGreaterThan(0);
    for (const l of links) expect(l.getAttribute("href")).toBe("/s/x/d1");
    expect(screen.queryByText("Fiche")).toBeNull();
  });
});
