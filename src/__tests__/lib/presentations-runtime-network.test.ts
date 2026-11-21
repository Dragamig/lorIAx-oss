/**
 * Le runtime de présentation ne doit atteindre aucun serveur. Le moteur Bento
 * embarque un transport de partage en direct vers wss://sync.bento.page : la CSP
 * de la route (connect-src 'none') et le pont (constructeur WebSocket neutralisé)
 * le coupent, et le champ `collab` du document n'est ni conservé ni comparé.
 */
import { describe, it, expect, vi } from "vitest";

vi.mock("@/lib/auth/get-user", () => ({
  getSessionUser: vi.fn(async () => ({ id: "u1" })),
}));
vi.mock("@/lib/presentations/guards", () => ({
  guardPresentationsModule: vi.fn(async () => null),
}));

import { GET } from "@/app/api/presentations/runtime/[version]/route";
import { BENTO_RUNTIME_VERSION } from "@/lib/presentations/runtime";
import { RUNTIME_BRIDGE_SCRIPT } from "@/lib/presentations/runtime-bridge-script";
import { deckSchema, deckFingerprint } from "@/lib/presentations/deck";

describe("réseau du runtime", () => {
  it("la route pose connect-src 'none' et aucune autre source réseau", async () => {
    const res = await GET(new Request("http://x/api/presentations/runtime/v?lang=fr"), {
      params: Promise.resolve({ version: BENTO_RUNTIME_VERSION }),
    });
    expect(res.status).toBe(200);
    const csp = res.headers.get("Content-Security-Policy") ?? "";
    const directives = Object.fromEntries(
      csp.split(";").map((d) => {
        const [name, ...values] = d.trim().split(/\s+/);
        return [name, values.join(" ")];
      })
    );
    expect(directives["connect-src"]).toBe("'none'");
    expect(directives["default-src"]).toBe("'none'");
    expect(csp).not.toMatch(/\bwss?:|https?:/);
  });

  it("le pont neutralise WebSocket", () => {
    expect(RUNTIME_BRIDGE_SCRIPT).toMatch(/window\.WebSocket\s*=\s*function/);
  });
});

describe("champ collab et empreinte", () => {
  const base = {
    format: "bento/slides",
    version: 1,
    title: "T",
    slides: [{ id: "s" }],
    modified: "2026-01-01T00:00:00.000Z",
  };

  it("deckSchema retire collab, garde le reste", () => {
    const parsed = deckSchema.parse({
      ...base,
      collab: { room: "wss://sync.bento.page/d/x", key: "k", ownerPriv: "p" },
      theme: { accent: "#fff" },
    });
    expect("collab" in parsed).toBe(false);
    expect(parsed.theme).toEqual({ accent: "#fff" });
    expect(parsed.modified).toBe(base.modified);
  });

  it("un deck qui ne diffère que par collab/modified a la même empreinte", () => {
    const other = {
      ...base,
      modified: "2030-05-05T10:00:00.000Z",
      collab: { room: "wss://sync.bento.page/d/x", key: "k" },
    };
    expect(deckFingerprint(other)).toBe(deckFingerprint(base));
    expect(deckFingerprint({ ...base, title: "U" })).not.toBe(deckFingerprint(base));
  });
});
