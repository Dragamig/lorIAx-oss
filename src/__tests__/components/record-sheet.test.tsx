// @vitest-environment jsdom
import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { cleanup, fireEvent, screen, waitFor } from "@testing-library/react";
import { toast } from "sonner";
import { RecordSheet, type RecordSheetProps } from "@/components/bases/record-sheet";
import type { RecordNav } from "@/lib/bases/record-navigation";
import { renderWithIntl } from "./support/render-intl";

vi.mock("sonner", () => {
  const fn = Object.assign(vi.fn(), { info: vi.fn(), success: vi.fn(), error: vi.fn() });
  return { toast: fn };
});

const nav: RecordNav = { index: 2, total: 18, prevId: "p", nextId: "n", outOfList: false };

function build(over: Partial<RecordSheetProps> = {}) {
  const onClose = vi.fn();
  const onNavigate = vi.fn();
  const props: RecordSheetProps = {
    open: true,
    title: "Dossier test",
    status: "ready",
    nav,
    onClose,
    onNavigate,
    children: <div data-testid="props">properties</div>,
    ...over,
  };
  return { props, onClose, onNavigate };
}

beforeEach(() => vi.clearAllMocks());
afterEach(() => cleanup());

describe("RecordSheet", () => {
  it("exposes a modal dialog named after the record", () => {
    const { props } = build();
    renderWithIntl(<RecordSheet {...props} />);
    expect(screen.getByRole("dialog").getAttribute("aria-label")).toBe("Fiche : Dossier test");
  });

  it("falls back to the untitled name", () => {
    const { props } = build({ title: "" });
    renderWithIntl(<RecordSheet {...props} />);
    expect(screen.getByRole("dialog").getAttribute("aria-label")).toBe("Fiche : Fiche sans titre");
  });

  it("shows the position label", () => {
    const { props } = build();
    const { unmount } = renderWithIntl(<RecordSheet {...props} />);
    expect(screen.getByText("Fiche 3 sur 18")).toBeTruthy();
    unmount();
    const b = build({ entityLabel: "Dossier" });
    const r2 = renderWithIntl(<RecordSheet {...b.props} />);
    expect(screen.getByText("Dossier 3 sur 18")).toBeTruthy();
    r2.unmount();
    const b3 = build({ nav: { ...nav, outOfList: true } });
    renderWithIntl(<RecordSheet {...b3.props} />);
    expect(screen.getByText("Hors de la liste affichée")).toBeTruthy();
  });

  it("closes on Escape", () => {
    const { props, onClose } = build();
    renderWithIntl(<RecordSheet {...props} />);
    fireEvent.keyDown(document.body, { key: "Escape" });
    expect(onClose).toHaveBeenCalledTimes(1);
  });

  it("closes on a single Escape from the close button", () => {
    const { props, onClose } = build();
    renderWithIntl(<RecordSheet {...props} />);
    fireEvent.keyDown(screen.getByRole("button", { name: "Fermer la fiche" }), { key: "Escape" });
    expect(onClose).toHaveBeenCalled();
  });

  it("leaves Escape to a field that handles it (edit revert) and keeps the sheet open", () => {
    const { props, onClose } = build({
      children: (
        <input
          data-testid="field"
          onKeyDown={(e) => {
            if (e.key === "Escape") e.preventDefault();
          }}
        />
      ),
    });
    renderWithIntl(<RecordSheet {...props} />);
    fireEvent.keyDown(screen.getByTestId("field"), { key: "Escape" });
    expect(onClose).not.toHaveBeenCalled();
  });

  it("navigates with Alt+ArrowLeft and Alt+ArrowRight", () => {
    const { props, onNavigate } = build();
    renderWithIntl(<RecordSheet {...props} />);
    const dialog = screen.getByRole("dialog");
    fireEvent.keyDown(dialog, { key: "ArrowLeft" });
    fireEvent.keyDown(dialog, { key: "ArrowRight" });
    expect(onNavigate).not.toHaveBeenCalled();
    fireEvent.keyDown(dialog, { key: "ArrowLeft", altKey: true });
    expect(onNavigate).toHaveBeenLastCalledWith("p");
    fireEvent.keyDown(dialog, { key: "ArrowRight", altKey: true });
    expect(onNavigate).toHaveBeenLastCalledWith("n");
  });

  it("explains and ignores navigation at the edges", () => {
    const first = build({ nav: { ...nav, prevId: null } });
    const r = renderWithIntl(<RecordSheet {...first.props} />);
    const prev = screen.getByLabelText("Fiche précédente");
    expect(prev.hasAttribute("disabled") || prev.getAttribute("aria-disabled") === "true").toBe(true);
    expect(document.getElementById(prev.getAttribute("aria-describedby") ?? "")?.textContent).toBe(
      "Première fiche de la liste",
    );
    fireEvent.keyDown(screen.getByRole("dialog"), { key: "ArrowLeft", altKey: true });
    expect(first.onNavigate).not.toHaveBeenCalled();
    expect(toast.info).toHaveBeenCalledWith("Vous êtes sur la première fiche de la liste");
    r.unmount();

    const last = build({ nav: { ...nav, nextId: null } });
    renderWithIntl(<RecordSheet {...last.props} />);
    const next = screen.getByLabelText("Fiche suivante");
    expect(next.hasAttribute("disabled") || next.getAttribute("aria-disabled") === "true").toBe(true);
    expect(document.getElementById(next.getAttribute("aria-describedby") ?? "")?.textContent).toBe(
      "Dernière fiche de la liste",
    );
    fireEvent.keyDown(screen.getByRole("dialog"), { key: "ArrowRight", altKey: true });
    expect(last.onNavigate).not.toHaveBeenCalled();
    expect(toast.info).toHaveBeenCalledWith("Vous êtes sur la dernière fiche de la liste");
  });

  it("disables both arrows on a single-record list", () => {
    const { props } = build({ nav: { index: 0, total: 1, prevId: null, nextId: null, outOfList: false } });
    renderWithIntl(<RecordSheet {...props} />);
    for (const name of ["Fiche précédente", "Fiche suivante"]) {
      const b = screen.getByLabelText(name);
      expect(b.hasAttribute("disabled") || b.getAttribute("aria-disabled") === "true").toBe(true);
    }
  });

  it("toggles fullscreen with the button and Alt+Enter", () => {
    const { props } = build();
    renderWithIntl(<RecordSheet {...props} />);
    const dialog = screen.getByRole("dialog");
    expect(dialog.getAttribute("data-fullscreen")).toBe("false");
    fireEvent.click(screen.getByLabelText("Passer en plein écran"));
    expect(dialog.getAttribute("data-fullscreen")).toBe("true");
    expect(screen.getByLabelText("Réduire en panneau latéral")).toBeTruthy();
    expect(toast).toHaveBeenCalledWith("Fiche en plein écran");
    fireEvent.keyDown(dialog, { key: "Enter", altKey: true });
    expect(dialog.getAttribute("data-fullscreen")).toBe("false");
  });

  it("forces fullscreen on a narrow viewport and disables the toggle", () => {
    const { props } = build();
    renderWithIntl(<RecordSheet {...props} />, { narrow: true });
    expect(screen.getByRole("dialog").getAttribute("data-fullscreen")).toBe("true");
    const toggle = screen.getByLabelText("Plein écran imposé sur un écran étroit");
    expect(toggle.hasAttribute("disabled") || toggle.getAttribute("aria-disabled") === "true").toBe(true);
  });

  it("renders the slots and the two-column layout only when aside is given", () => {
    const single = build({ sections: <div data-testid="sections" /> });
    const r = renderWithIntl(<RecordSheet {...single.props} />);
    expect(screen.getByRole("dialog").getAttribute("data-layout")).toBe("single");
    r.unmount();
    const split = build({
      sections: <div data-testid="sections" />,
      aside: <div data-testid="aside" />,
    });
    renderWithIntl(<RecordSheet {...split.props} />);
    expect(screen.getByRole("dialog").getAttribute("data-layout")).toBe("split");
    const sections = screen.getByTestId("sections");
    const props = screen.getByTestId("props");
    const aside = screen.getByTestId("aside");
    expect(sections.compareDocumentPosition(props) & Node.DOCUMENT_POSITION_FOLLOWING).toBeTruthy();
    expect(sections.parentElement).toBe(props.parentElement);
    expect(aside.parentElement).not.toBe(sections.parentElement);
  });

  it("stacks the aside under the fields on a narrow viewport and keeps two columns in wide fullscreen", () => {
    const mk = () =>
      build({ sections: <div data-testid="sections" />, aside: <div data-testid="aside" /> }).props;
    const r = renderWithIntl(<RecordSheet {...mk()} />, { narrow: true });
    const grid = () => screen.getByTestId("aside").parentElement!.parentElement!;
    expect(grid().className).toContain("grid-cols-1");
    expect(screen.getByTestId("aside").parentElement!.className).toContain("border-t");
    r.unmount();
    renderWithIntl(<RecordSheet {...mk()} />);
    fireEvent.click(screen.getByLabelText("Passer en plein écran"));
    expect(grid().className).toContain("grid-cols-[");
  });

  it("renders the open in bases button only with an href", () => {
    const { props } = build({ openInBasesHref: "/bases/x" });
    const r = renderWithIntl(<RecordSheet {...props} />);
    expect(screen.getByLabelText("Ouvrir dans Bases").getAttribute("href")).toBe("/bases/x");
    r.unmount();
    const b = build();
    renderWithIntl(<RecordSheet {...b.props} />);
    expect(screen.queryByLabelText("Ouvrir dans Bases")).toBeNull();
  });

  it("renders the loading state", () => {
    const { props } = build({ status: "loading" });
    renderWithIntl(<RecordSheet {...props} />);
    expect(screen.getByRole("status", { name: "Chargement de la fiche" })).toBeTruthy();
    expect(screen.queryByTestId("props")).toBeNull();
  });

  it("renders the error state with retry", () => {
    const onRetry = vi.fn();
    const { props } = build({ status: "error", onRetry });
    const r = renderWithIntl(<RecordSheet {...props} />);
    expect(screen.getByText("Impossible de charger la fiche")).toBeTruthy();
    fireEvent.click(screen.getByRole("button", { name: "Réessayer" }));
    expect(onRetry).toHaveBeenCalledTimes(1);
    r.unmount();
    const b = build({ status: "error" });
    renderWithIntl(<RecordSheet {...b.props} />);
    expect(screen.queryByRole("button", { name: "Réessayer" })).toBeNull();
  });

  it("renders the not found state with navigation still available", () => {
    const { props } = build({ status: "notFound" });
    renderWithIntl(<RecordSheet {...props} />);
    expect(screen.getByText("Fiche introuvable")).toBeTruthy();
    expect(screen.getByText("Elle a été supprimée ou vous n'y avez pas accès.")).toBeTruthy();
    expect(screen.getByLabelText("Fermer la fiche")).toBeTruthy();
  });

  it("truncates a long title and exposes it in a tooltip attribute", () => {
    const long = "A".repeat(200);
    const { props } = build({ title: long });
    renderWithIntl(<RecordSheet {...props} />);
    const h2 = screen.getByRole("heading", { level: 2 });
    expect(h2.className).toContain("truncate");
    expect(h2.getAttribute("title")).toBe(long);
  });

  it("focuses the close button on open", async () => {
    const { props } = build();
    renderWithIntl(<RecordSheet {...props} />);
    await waitFor(() => expect(document.activeElement).toBe(screen.getByLabelText("Fermer la fiche")));
  });

  it("restores focus to the opener on close", () => {
    const opener = document.createElement("button");
    document.body.appendChild(opener);
    opener.focus();
    const { props } = build();
    const r = renderWithIntl(<RecordSheet {...props} />);
    r.rerender(<RecordSheet {...props} open={false} />);
    expect(document.activeElement).toBe(opener);
    opener.remove();
  });
});
