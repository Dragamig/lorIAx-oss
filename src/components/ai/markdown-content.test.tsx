// @vitest-environment jsdom
import { afterEach, describe, expect, it } from "vitest";
import { cleanup, render } from "@testing-library/react";
import { MarkdownContent } from "./markdown-content";

afterEach(cleanup);

describe("MarkdownContent", () => {
  it("rend gras, liste, titre et séparateur", () => {
    const { container } = render(
      <MarkdownContent text={"## Titre\n\n**gras**\n\n- un\n- deux\n\n---\n"} />
    );
    expect(container.querySelector("h2")?.textContent).toBe("Titre");
    expect(container.querySelector("strong")?.textContent).toBe("gras");
    expect(container.querySelectorAll("li")).toHaveLength(2);
    expect(container.querySelector("hr")).not.toBeNull();
    expect(container.textContent).not.toContain("**");
  });

  it("rend les tableaux GFM", () => {
    const { container } = render(<MarkdownContent text={"| a | b |\n|---|---|\n| 1 | 2 |"} />);
    expect(container.querySelectorAll("th")).toHaveLength(2);
    expect(container.querySelectorAll("td")).toHaveLength(2);
  });

  it("n'injecte pas de HTML brut", () => {
    const { container } = render(
      <MarkdownContent text={'<script>alert(1)</script><img src=x onerror="alert(1)">'} />
    );
    expect(container.querySelector("script")).toBeNull();
    expect(container.querySelector("img")).toBeNull();
    expect(container.textContent).toContain("<script>");
  });

  it("neutralise les liens javascript: et ouvre les autres avec noopener", () => {
    const { container } = render(
      <MarkdownContent text={"[x](javascript:alert(1)) [ok](https://example.com)"} />
    );
    const links = container.querySelectorAll("a");
    expect(links).toHaveLength(1);
    expect(links[0].getAttribute("href")).toBe("https://example.com");
    expect(links[0].getAttribute("rel")).toBe("noopener noreferrer");
  });

  it("tolère un markdown incomplet (streaming)", () => {
    const { container } = render(<MarkdownContent text={"**gras non fermé\n\n- item"} />);
    expect(container.querySelectorAll("li")).toHaveLength(1);
  });
});
