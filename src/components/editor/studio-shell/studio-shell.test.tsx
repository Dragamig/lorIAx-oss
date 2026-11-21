// @vitest-environment jsdom
import { describe, it, expect, vi, beforeEach } from "vitest";
import { render, screen, fireEvent, renderHook, act, waitFor } from "@testing-library/react";
import { StudioRail } from "./studio-rail";
import { PanelSection } from "./panel-section";
import { StudioTopbar } from "./studio-topbar";
import { StudioShell } from "./studio-shell";
import { useStudioTheme } from "./use-studio-theme";

// ---------------------------------------------------------------------------
// Mocks
// ---------------------------------------------------------------------------

// Mock getComputedStyle for useStudioTheme
beforeEach(() => {
  vi.stubGlobal(
    "getComputedStyle",
    (_el: Element) => ({
      getPropertyValue: (prop: string) => {
        const values: Record<string, string> = {
          "--background": "oklch(1 0 0)",
          "--muted": "oklch(0.97 0 0)",
          "--border": "oklch(0.92 0 0)",
          "--foreground": "oklch(0.15 0 0)",
          "--accent": "oklch(0.94 0 0)",
          "--ring": "oklch(0.7 0 0)",
        };
        return values[prop] ?? "";
      },
    })
  );
});

// ---------------------------------------------------------------------------
// StudioRail
// ---------------------------------------------------------------------------

describe("StudioRail", () => {
  const items = [
    { id: "shapes", icon: <span>S</span>, label: "Formes" },
    { id: "text", icon: <span>T</span>, label: "Texte" },
  ];

  it("renders all items", () => {
    render(<StudioRail items={items} onSelect={vi.fn()} />);
    expect(screen.getByLabelText("Formes")).toBeTruthy();
    expect(screen.getByLabelText("Texte")).toBeTruthy();
  });

  it("calls onSelect with the correct id on click", () => {
    const onSelect = vi.fn();
    render(<StudioRail items={items} onSelect={onSelect} />);
    fireEvent.click(screen.getByLabelText("Texte"));
    expect(onSelect).toHaveBeenCalledWith("text");
  });

  it("active item has aria-pressed=true", () => {
    render(<StudioRail items={items} activeId="shapes" onSelect={vi.fn()} />);
    const shapesBtn = screen.getByLabelText("Formes");
    const textBtn = screen.getByLabelText("Texte");
    expect(shapesBtn.getAttribute("aria-pressed")).toBe("true");
    expect(textBtn.getAttribute("aria-pressed")).toBe("false");
  });

  it("has role=toolbar and aria-orientation=vertical", () => {
    const { container } = render(<StudioRail items={items} onSelect={vi.fn()} />);
    const toolbar = container.querySelector('[role="toolbar"]');
    expect(toolbar).toBeTruthy();
    expect(toolbar?.getAttribute("aria-orientation")).toBe("vertical");
  });
});

// ---------------------------------------------------------------------------
// PanelSection
// ---------------------------------------------------------------------------

describe("PanelSection", () => {
  it("shows children by default (defaultOpen=true)", () => {
    render(
      <PanelSection title="Couleurs">
        <span>contenu couleurs</span>
      </PanelSection>
    );
    expect(screen.getByText("contenu couleurs")).toBeTruthy();
  });

  it("hides children when defaultOpen=false", () => {
    render(
      <PanelSection title="Couleurs" defaultOpen={false}>
        <span>contenu couleurs</span>
      </PanelSection>
    );
    expect(screen.queryByText("contenu couleurs")).toBeNull();
  });

  it("toggles on header click: open → closed → open", () => {
    render(
      <PanelSection title="Typo">
        <span>contenu typo</span>
      </PanelSection>
    );
    const header = screen.getByRole("button");
    expect(screen.getByText("contenu typo")).toBeTruthy();
    fireEvent.click(header);
    expect(screen.queryByText("contenu typo")).toBeNull();
    fireEvent.click(header);
    expect(screen.getByText("contenu typo")).toBeTruthy();
  });

  it("aria-expanded reflects open state", () => {
    render(
      <PanelSection title="Typo">
        <span>contenu</span>
      </PanelSection>
    );
    const btn = screen.getByRole("button");
    expect(btn.getAttribute("aria-expanded")).toBe("true");
    fireEvent.click(btn);
    expect(btn.getAttribute("aria-expanded")).toBe("false");
  });

  it("content has role=region with aria-labelledby pointing to the title", () => {
    const { container, getByRole } = render(
      <PanelSection title="Typo">
        <span>contenu</span>
      </PanelSection>
    );
    const region = container.querySelector('[role="region"]');
    expect(region).toBeTruthy();
    const labelId = region?.getAttribute("aria-labelledby");
    expect(labelId).toBeTruthy();
    // Verify the labelling element exists and has the correct text
    const titleEl = container.ownerDocument.getElementById(labelId!);
    expect(titleEl?.textContent).toBe("Typo");
    // Testing-library: region accessible name is resolved via aria-labelledby
    expect(getByRole("region", { name: "Typo" })).toBeTruthy();
  });
});

// ---------------------------------------------------------------------------
// StudioTopbar
// ---------------------------------------------------------------------------

describe("StudioTopbar", () => {
  it("renders left, center and right slots", () => {
    render(
      <StudioTopbar
        left={<span>LEFT</span>}
        center={<span>CENTER</span>}
        right={<span>RIGHT</span>}
      />
    );
    expect(screen.getByText("LEFT")).toBeTruthy();
    expect(screen.getByText("CENTER")).toBeTruthy();
    expect(screen.getByText("RIGHT")).toBeTruthy();
  });

  it("editable title calls onTitleChange on input", () => {
    const onTitleChange = vi.fn();
    render(<StudioTopbar title="Mon projet" onTitleChange={onTitleChange} />);
    const input = screen.getByRole("textbox", { name: "Titre" });
    fireEvent.change(input, { target: { value: "Nouveau titre" } });
    expect(onTitleChange).toHaveBeenCalledWith("Nouveau titre");
  });

  it("read-only title renders a span without input", () => {
    render(<StudioTopbar title="Titre fixe" />);
    expect(screen.getByText("Titre fixe")).toBeTruthy();
    expect(screen.queryByRole("textbox")).toBeNull();
  });
});

// ---------------------------------------------------------------------------
// StudioShell
// ---------------------------------------------------------------------------

describe("StudioShell", () => {
  it("renders topbar and children", () => {
    render(
      <StudioShell topbar={<div>TOPBAR</div>}>
        <span>CONTENU</span>
      </StudioShell>
    );
    expect(screen.getByText("TOPBAR")).toBeTruthy();
    expect(screen.getByText("CONTENU")).toBeTruthy();
  });

  it("renders rail when provided", () => {
    render(
      <StudioShell topbar={<div />} rail={<div>RAIL</div>}>
        <span>c</span>
      </StudioShell>
    );
    expect(screen.getByText("RAIL")).toBeTruthy();
  });

  it("renders panel when provided", () => {
    render(
      <StudioShell topbar={<div />} panel={<div>PANEL</div>}>
        <span>c</span>
      </StudioShell>
    );
    expect(screen.getByText("PANEL")).toBeTruthy();
  });

  it("does not render rail/panel slots if not provided", () => {
    const { container } = render(
      <StudioShell topbar={<div>TOP</div>}>
        <span>SEUL</span>
      </StudioShell>
    );
    // Only topbar + main should be present; rail and panel are undefined → not rendered
    expect(screen.queryByText("RAIL")).toBeNull();
    expect(screen.queryByText("PANEL")).toBeNull();
    // children rendered in main
    expect(container.querySelector("main")).toBeTruthy();
  });

  it("renders bottombar slot when provided", () => {
    render(
      <StudioShell topbar={<div />} bottombar={<div>BOTTOMBAR</div>}>
        <span>c</span>
      </StudioShell>
    );
    expect(screen.getByText("BOTTOMBAR")).toBeTruthy();
  });

  it("does not render bottombar when not provided", () => {
    render(
      <StudioShell topbar={<div />}>
        <span>c</span>
      </StudioShell>
    );
    expect(screen.queryByText("BOTTOMBAR")).toBeNull();
  });
});

// ---------------------------------------------------------------------------
// useStudioTheme
// ---------------------------------------------------------------------------

describe("useStudioTheme", () => {
  it("returns string values for all theme keys", () => {
    const { result } = renderHook(() => useStudioTheme());
    expect(typeof result.current.background).toBe("string");
    expect(typeof result.current.muted).toBe("string");
    expect(typeof result.current.border).toBe("string");
    expect(typeof result.current.foreground).toBe("string");
    expect(typeof result.current.accent).toBe("string");
    expect(typeof result.current.ring).toBe("string");
  });

  it("resolve reads the mocked css variable", () => {
    const { result } = renderHook(() => useStudioTheme());
    const val = result.current.resolve("--background");
    expect(val).toBe("oklch(1 0 0)");
  });

  it("resolve returns empty string for unknown variable", () => {
    const { result } = renderHook(() => useStudioTheme());
    const val = result.current.resolve("--unknown-var");
    expect(val).toBe("");
  });

  it("re-computes theme values when darkMode changes", async () => {
    // Ensure .dark is absent at start (clean slate)
    document.documentElement.classList.remove("dark");

    const { result } = renderHook(() => useStudioTheme());
    expect(result.current.background).toBe("oklch(1 0 0)");

    // Update getComputedStyle mock to dark values, then add the .dark class on
    // <html> — this is what theme-context does, and it triggers the MutationObserver
    // that useSyncExternalStore subscribes to.
    await act(async () => {
      vi.stubGlobal(
        "getComputedStyle",
        (_el: Element) => ({
          getPropertyValue: (prop: string) =>
            prop === "--background" ? "oklch(0.14 0 0)" : "",
        })
      );
      document.documentElement.classList.add("dark");
    });

    await waitFor(() => {
      expect(result.current.background).toBe("oklch(0.14 0 0)");
    });

    // Cleanup: restore light state for subsequent tests
    document.documentElement.classList.remove("dark");
  });
});
