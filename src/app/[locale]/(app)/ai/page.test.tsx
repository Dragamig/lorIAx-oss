// @vitest-environment jsdom
import { afterEach, describe, expect, it, vi } from "vitest";
import { cleanup, render, screen } from "@testing-library/react";

vi.mock("next-intl", () => ({ useTranslations: () => (k: string) => k }));
vi.mock("ai", () => ({ DefaultChatTransport: class {} }));
vi.mock("@/components/ai/proposal-card", () => ({
  ProposalCard: ({ proposalId }: { proposalId: string }) => <div>carte {proposalId}</div>,
}));
vi.mock("@/components/ai/pending-proposals-banner", () => ({
  PendingProposalsBanner: ({ hiddenIds }: { hiddenIds?: string[] }) => <div>bandeau masque {(hiddenIds ?? []).join(",")}</div>,
}));
vi.mock("@ai-sdk/react", () => ({
  useChat: () => ({
    status: "ready",
    sendMessage: vi.fn(),
    messages: [
      { id: "1", role: "user", parts: [{ type: "text", text: "**brut**" }] },
      { id: "2", role: "assistant", parts: [{ type: "text", text: "**gras**\n\n- a\n- b" }] },
      {
        id: "3",
        role: "assistant",
        parts: [
          { type: "tool-query_rows", state: "output-available", input: {}, output: { rows: [] } },
          { type: "tool-propose_merge_duplicates", state: "output-available", input: {}, output: { proposalId: "p-1" } },
          { type: "tool-propose_delete_rows", state: "output-available", input: {}, output: { error: "refus" } },
        ],
      },
    ],
  }),
}));

import AIPage from "./page";

Element.prototype.scrollIntoView = vi.fn();

afterEach(cleanup);

describe("AIPage", () => {
  it("place le focus dans le champ de saisie au montage", () => {
    render(<AIPage />);
    expect(document.activeElement).toBe(screen.getByPlaceholderText("inputPlaceholder"));
  });

  it("reprend le focus du lien de menu cliqué", () => {
    const link = document.createElement("a");
    link.href = "/ai";
    document.body.appendChild(link);
    link.focus();
    render(<AIPage />);
    expect(document.activeElement).toBe(screen.getByPlaceholderText("inputPlaceholder"));
    link.remove();
  });

  it("ne vole pas le focus d'une autre saisie", () => {
    const other = document.createElement("input");
    document.body.appendChild(other);
    other.focus();
    render(<AIPage />);
    expect(document.activeElement).toBe(other);
    other.remove();
  });

  it("rend le markdown de l'assistant et laisse le texte utilisateur brut", () => {
    const { container } = render(<AIPage />);
    expect(container.querySelector("strong")?.textContent).toBe("gras");
    expect(container.querySelectorAll("li")).toHaveLength(2);
    expect(container.textContent).toContain("**brut**");
  });

  it("rend une part propose_* en carte et les autres outils en ligne repliable", () => {
    render(<AIPage />);
    expect(screen.getByText("carte p-1")).toBeTruthy();
    expect(screen.getByRole("button", { name: /Lecture de lignes, terminé/ })).toBeTruthy();
    // sortie { error } : ligne d'appel, pas de carte (R4)
    expect(screen.getByRole("button", { name: /propose delete rows, terminé/ })).toBeTruthy();
    expect(screen.getAllByText(/^carte /)).toHaveLength(1);
  });

  it("transmet au bandeau les propositions déjà rendues en carte", () => {
    render(<AIPage />);
    expect(screen.getByText("bandeau masque p-1")).toBeTruthy();
  });
});
