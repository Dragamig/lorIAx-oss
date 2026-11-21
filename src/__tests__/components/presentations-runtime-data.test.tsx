// @vitest-environment jsdom
/**
 * Intégrité des données du côté parent du pont (revue finale, partie A).
 *
 * Le vrai `PresentationRuntime` est monté ; les messages du moteur sont des
 * `MessageEvent` dont la source est la fenêtre de l'iframe.
 *
 * Preuves par mutation (retrait temporaire, test rouge, restauration, vert) :
 *   - `lastDeckRef.current = deck` retiré de `write` : « rechargement » échoue
 *     (le `load` renvoie le deck initial) ;
 *   - `onReadyChangeRef.current?.(false)` retiré de `onLoad` : « remise à faux » échoue ;
 *   - `if (mode !== "edit") break` retiré du cas `saved` : « saved en lecture » échoue ;
 *   - `allow-popups` remis dans `sandbox` : « sandbox » échoue.
 */
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { act, cleanup, fireEvent } from "@testing-library/react";
import { renderWithIntl } from "./support/render-intl";
import { PresentationRuntime } from "@/components/presentations/presentation-runtime";

const DECK_V1 = {
  format: "bento/slides",
  version: 1,
  docId: "11111111-1111-4111-8111-111111111111",
  title: "Pitch",
  size: { width: 1280, height: 720 },
  theme: { background: "#FFFFFF", color: "#1E2A3A", accent: "#F7A600", fontFamily: "Inter" },
  slides: [{ id: "s1", elements: [] }],
} as never;
const DECK_V2 = {
  ...(DECK_V1 as object),
  slides: [
    { id: "s1", elements: [] },
    { id: "s2", elements: [] },
  ],
} as never;

const puts: unknown[] = [];

beforeEach(() => {
  vi.useFakeTimers({ shouldAdvanceTime: true });
  puts.length = 0;
  vi.stubGlobal(
    "fetch",
    vi.fn(async (_url: RequestInfo | URL, init?: RequestInit) => {
      if (init?.method === "PUT") {
        puts.push(JSON.parse(String(init.body)));
        return new Response(JSON.stringify({ presentation: { version: 4, slideCount: 2 } }), {
          status: 200,
        });
      }
      return new Response("{}", { status: 500 });
    })
  );
});
afterEach(() => {
  cleanup();
  vi.useRealTimers();
  vi.unstubAllGlobals();
});

function mount(props: Partial<React.ComponentProps<typeof PresentationRuntime>> = {}) {
  const onSaved = vi.fn();
  const onReadyChange = vi.fn();
  renderWithIntl(
    <PresentationRuntime
      presentationId="p1"
      initialDeck={DECK_V1}
      initialVersion={3}
      mode="edit"
      locale="fr"
      onSaved={onSaved}
      onReadyChange={onReadyChange}
      {...props}
    />
  );
  const iframe = document.querySelector("iframe") as HTMLIFrameElement;
  const win = iframe.contentWindow as Window;
  const post = vi.spyOn(win, "postMessage");
  const send = (data: unknown) =>
    act(() => {
      window.dispatchEvent(new MessageEvent("message", { data, source: win }));
    });
  return { iframe, post, send, onSaved, onReadyChange };
}

const loads = (post: { mock: { calls: unknown[][] } }) =>
  post.mock.calls
    .map((c) => c[0] as { type: string; deck?: unknown })
    .filter((m) => m.type === "load");

describe("dernier deck écrit", () => {
  it("après un enregistrement puis un rechargement de l'iframe, `load` porte le dernier deck écrit", async () => {
    const { iframe, post, send, onSaved } = mount();
    fireEvent.load(iframe); // démarrage
    send({ type: "ready", readonly: false });
    expect(loads(post)[0].deck).toEqual(DECK_V1);

    await act(async () => {
      send({ type: "saved", deck: DECK_V2 });
    });
    await vi.waitFor(() => expect(puts).toHaveLength(1));
    await vi.waitFor(() => expect(onSaved).toHaveBeenCalled());
    // Le parent est averti avec le deck écrit (le bloc de document en a besoin).
    expect(onSaved.mock.calls[0][0]).toBe(4);
    expect(onSaved.mock.calls[0][2]).toEqual(DECK_V2);

    fireEvent.load(iframe); // rechargement du moteur
    send({ type: "ready", readonly: false });
    const all = loads(post);
    expect(all).toHaveLength(2);
    expect(all[1].deck).toEqual(DECK_V2);
  });
});

describe("rechargement de l'iframe", () => {
  it("remet `ready` à faux : onReadyChange(false), puis vrai au nouveau signal", () => {
    const { iframe, send, onReadyChange } = mount();
    fireEvent.load(iframe);
    send({ type: "ready", readonly: false });
    expect(onReadyChange).toHaveBeenLastCalledWith(true);
    fireEvent.load(iframe);
    expect(onReadyChange).toHaveBeenLastCalledWith(false);
    send({ type: "ready", readonly: false });
    expect(onReadyChange).toHaveBeenLastCalledWith(true);
  });
});

describe("mode lecture", () => {
  it("un message `saved` ne déclenche aucun PUT", async () => {
    const { iframe, send } = mount({ mode: "play" });
    fireEvent.load(iframe);
    send({ type: "ready", readonly: false });
    await act(async () => {
      send({ type: "saved", deck: DECK_V2 });
    });
    await act(async () => {
      await vi.advanceTimersByTimeAsync(2000);
    });
    expect(puts).toHaveLength(0);
  });
});

describe("sandbox", () => {
  it("n'autorise pas les fenêtres secondaires ni l'origine d'application", () => {
    const { iframe } = mount();
    const tokens = (iframe.getAttribute("sandbox") ?? "").split(/\s+/);
    expect(tokens).toContain("allow-scripts");
    expect(tokens).not.toContain("allow-popups");
    expect(tokens).not.toContain("allow-same-origin");
  });
});
