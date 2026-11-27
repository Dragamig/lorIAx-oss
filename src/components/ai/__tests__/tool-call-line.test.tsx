// @vitest-environment jsdom
import { afterEach, describe, expect, it } from "vitest";
import { cleanup, fireEvent, render, screen } from "@testing-library/react";
import { ToolCallLine } from "../tool-call-line";

afterEach(cleanup);

describe("ToolCallLine", () => {
  it("affiche un nom lisible et l'état en cours", () => {
    render(<ToolCallLine part={{ type: "tool-query_rows", state: "input-available", input: { databaseId: "d1" } }} />);
    const btn = screen.getByRole("button", { name: /Lecture de lignes, en cours/ });
    expect(btn.getAttribute("aria-expanded")).toBe("false");
    expect(screen.queryByText(/d1/)).toBeNull();
  });

  it("déplie le résultat condensé et expose une info-bulle", () => {
    render(
      <ToolCallLine part={{ type: "tool-find_duplicates", state: "output-available", input: { a: 1 }, output: { groups: 12 } }} />,
    );
    expect(screen.getByText("terminé")).toBeTruthy();
    const btn = screen.getByRole("button", { name: /Recherche de doublons/ });
    expect(screen.getByRole("tooltip", { hidden: true }).textContent).toBe("Afficher le détail de l'appel");
    fireEvent.click(btn);
    expect(btn.getAttribute("aria-expanded")).toBe("true");
    expect(screen.getByText(/"groups": 12/)).toBeTruthy();
  });

  it("tronque un résultat volumineux", () => {
    render(<ToolCallLine part={{ type: "tool-query_rows", state: "output-available", output: "x".repeat(5000) }} />);
    fireEvent.click(screen.getByRole("button"));
    expect(screen.getByText(/x+…$/).textContent!.length).toBeLessThan(1600);
  });

  it("signale un échec avec son message", () => {
    render(<ToolCallLine part={{ type: "tool-list_databases", state: "output-error", errorText: "Accès refusé" }} />);
    expect(screen.getByText("échec")).toBeTruthy();
    fireEvent.click(screen.getByRole("button"));
    expect(screen.getByText("Accès refusé")).toBeTruthy();
  });

  it("nomme un outil inconnu sans casser", () => {
    render(<ToolCallLine part={{ type: "tool-mon_outil", state: "output-available" }} />);
    expect(screen.getByRole("button", { name: /mon outil/ })).toBeTruthy();
  });
});
