// @vitest-environment jsdom
/**
 * Bloc de document (revue finale, C1 et UX du lot 1).
 *
 * Le moteur est remplacé par un double qui expose ses propriétés : on vérifie
 * ce que le bloc lui donne à l'ouverture, pas le moteur lui-même.
 *
 * Preuves par mutation (retrait temporaire, test rouge, restauration, vert) :
 *   - `setDeck(deck)` retiré de `onSaved` : « modifier, enregistrer, fermer,
 *     rouvrir » échoue (le moteur reçoit le deck périmé) ;
 *   - `Hint` retiré autour de « Modifier » : « info-bulle » échoue.
 */
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { act, cleanup, fireEvent, screen, waitFor } from "@testing-library/react";
import { renderWithIntl } from "./support/render-intl";

const seen: { initialDeck: unknown; initialVersion: number; onSaved: (v: number, n: number, d: unknown) => void }[] = [];

vi.mock("next/dynamic", () => ({
  default: () =>
    function Fake(props: {
      initialDeck: unknown;
      initialVersion: number;
      onSaved: (v: number, n: number, d: unknown) => void;
      action: React.ReactNode;
    }) {
      seen.push(props);
      return <div data-testid="engine">{props.action}</div>;
    },
}));
vi.mock("@/components/presentations/deck-thumbnail", () => ({ DeckThumbnail: () => null }));
vi.mock("@tiptap/react", () => ({
  NodeViewWrapper: ({ children }: { children: React.ReactNode }) => <div>{children}</div>,
}));

import { PresentationBlockView } from "@/components/editor/extensions/presentation-block";

const DECK_OLD = { slides: [{ id: "a" }], marker: "ancien" };
const DECK_NEW = { slides: [{ id: "a" }, { id: "b" }], marker: "nouveau" };

beforeEach(() => {
  seen.length = 0;
  vi.stubGlobal(
    "fetch",
    vi.fn(async () =>
      new Response(
        JSON.stringify({
          presentation: { id: "p1", title: "Pitch", version: 3, slideCount: 1, thumbnailKey: null },
          deck: DECK_OLD,
        }),
        { status: 200 }
      )
    )
  );
});
afterEach(() => {
  cleanup();
  vi.unstubAllGlobals();
});

function mount() {
  const props = {
    node: { attrs: { presentationId: "p1", title: "Pitch" } },
    updateAttributes: vi.fn(),
    deleteNode: vi.fn(),
    selected: false,
    editor: { isEditable: true },
  } as never;
  return renderWithIntl(<PresentationBlockView {...(props as object as Parameters<typeof PresentationBlockView>[0])} />);
}

describe("bloc de document", () => {
  it("modifier, enregistrer, fermer, rouvrir : le moteur reçoit le dernier deck écrit et la version à jour", async () => {
    mount();
    const edit = await screen.findByRole("button", { name: "Modifier" });
    await waitFor(() => expect((edit as HTMLButtonElement).disabled).toBe(false));
    fireEvent.click(edit);
    expect(seen.at(-1)?.initialDeck).toEqual(DECK_OLD);
    expect(seen.at(-1)?.initialVersion).toBe(3);

    act(() => seen.at(-1)!.onSaved(4, 2, DECK_NEW));
    fireEvent.click(screen.getByRole("button", { name: "Fermer" }));
    expect(screen.queryByTestId("engine")).toBeNull();

    fireEvent.click(screen.getByRole("button", { name: "Modifier" }));
    expect(seen.at(-1)?.initialDeck).toEqual(DECK_NEW);
    expect(seen.at(-1)?.initialVersion).toBe(4);
  });

  it("info-bulle et nom accessible sur Lire, Modifier, Fermer et Supprimer", async () => {
    mount();
    await screen.findByRole("button", { name: "Lire" });
    fireEvent.click(screen.getByRole("button", { name: "Modifier" }));
    for (const name of ["Lire", "Modifier", "Fermer", "Supprimer le bloc"]) {
      const button = screen.getByRole("button", { name });
      const tip = document.getElementById(button.getAttribute("aria-describedby") ?? "");
      expect(tip?.getAttribute("role")).toBe("tooltip");
      expect(tip?.textContent).toBe(name);
      expect(button.querySelector("svg")).toBeTruthy();
    }
  });

  it("avant le chargement : Lire et Modifier désactivés, la raison est dans l'info-bulle", () => {
    vi.stubGlobal("fetch", vi.fn(() => new Promise(() => {})));
    mount();
    for (const name of ["Lire", "Modifier"]) {
      const button = screen.getByRole("button", { name }) as HTMLButtonElement;
      expect(button.disabled).toBe(true);
      const tip = document.getElementById(button.getAttribute("aria-describedby") ?? "");
      expect(tip?.textContent).toMatch(/Chargement/);
    }
  });
});
