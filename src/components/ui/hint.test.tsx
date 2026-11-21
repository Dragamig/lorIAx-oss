// @vitest-environment jsdom
import { afterEach, describe, expect, it } from "vitest";
import { cleanup, fireEvent, render, screen } from "@testing-library/react";
import { Hint } from "./hint";

afterEach(cleanup);

describe("Hint", () => {
  it("s'affiche au focus clavier et se ferme avec Echap", () => {
    render(
      <Hint label="Astuce">
        <button type="button">Go</button>
      </Hint>
    );
    expect(screen.queryByRole("tooltip")).toBeNull();
    fireEvent.focus(screen.getByRole("button"));
    expect(screen.getByRole("tooltip").textContent).toBe("Astuce");
    fireEvent.keyDown(screen.getByRole("button"), { key: "Escape" });
    expect(screen.queryByRole("tooltip")).toBeNull();
  });

  it("fonctionne sur un bouton désactivé : survol de l'enveloppe et focus clavier", () => {
    const { container } = render(
      <Hint label="Pourquoi" disabled>
        <button type="button" disabled>
          Go
        </button>
      </Hint>
    );
    const wrapper = container.firstElementChild as HTMLElement;
    expect(wrapper.getAttribute("tabindex")).toBe("0");
    fireEvent.mouseEnter(wrapper);
    expect(screen.getByRole("tooltip").textContent).toBe("Pourquoi");
    fireEvent.mouseLeave(wrapper);
    fireEvent.focus(wrapper);
    expect(screen.getByRole("tooltip")).toBeTruthy();
  });

  it("relie le contrôle à l'info-bulle par aria-describedby", () => {
    render(
      <Hint label="Aide">
        <button type="button">Go</button>
      </Hint>
    );
    const tip = document.querySelector("[role=tooltip]") as HTMLElement;
    expect(screen.getByRole("button").getAttribute("aria-describedby")).toBe(tip.id);
  });
});
