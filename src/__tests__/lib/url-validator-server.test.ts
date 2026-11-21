/**
 * Anti DNS rebinding — `src/lib/security/url-validator-server.ts`.
 *
 * Ce module n'avait aucun test direct : `assertPublicHostname` était mockée
 * partout ailleurs, alors qu'elle porte le correctif le plus subtil du lot,
 * la revalidation des réponses DNS de type AAAA. `URL.hostname` rejette
 * silencieusement une IPv6 sans crochets (l'affectation est un no-op) : sans
 * la mise entre crochets, une réponse AAAA privée n'était jamais revalidée.
 */
import { describe, it, expect, vi, beforeEach } from "vitest";

const h = vi.hoisted(() => ({ lookup: vi.fn() }));

vi.mock("dns", () => ({
  promises: { lookup: h.lookup },
}));

import { assertPublicHostname } from "@/lib/security/url-validator-server";

/** Réponse `dns.lookup(..., { all: true })`. */
function resolvesTo(...addresses: { address: string; family: number }[]) {
  h.lookup.mockResolvedValue(addresses);
}

beforeEach(() => {
  vi.clearAllMocks();
});

describe("assertPublicHostname — résolution DNS", () => {
  it("refuse une réponse AAAA vers une adresse unique locale", async () => {
    resolvesTo({ address: "fd00::1", family: 6 });

    await expect(assertPublicHostname(new URL("https://rebind.attaquant.tld/"))).rejects.toThrow(
      "adresse privée",
    );
  });

  it("refuse une réponse AAAA vers le loopback IPv6", async () => {
    resolvesTo({ address: "::1", family: 6 });

    await expect(assertPublicHostname(new URL("https://rebind.attaquant.tld/"))).rejects.toThrow(
      "adresse privée",
    );
  });

  it("refuse une réponse AAAA vers l'adresse non spécifiée", async () => {
    resolvesTo({ address: "::", family: 6 });

    await expect(assertPublicHostname(new URL("https://rebind.attaquant.tld/"))).rejects.toThrow(
      "adresse privée",
    );
  });

  it("accepte une réponse AAAA vers une adresse publique", async () => {
    resolvesTo({ address: "2001:4860:4860::8888", family: 6 });

    await expect(assertPublicHostname(new URL("https://dns.google/"))).resolves.toBeUndefined();
    expect(h.lookup).toHaveBeenCalledWith("dns.google", { all: true });
  });

  it("refuse une réponse A vers une adresse privée", async () => {
    resolvesTo({ address: "169.254.169.254", family: 4 });

    await expect(assertPublicHostname(new URL("https://rebind.attaquant.tld/"))).rejects.toThrow(
      "adresse privée",
    );
  });

  it("accepte une réponse A vers une adresse publique", async () => {
    resolvesTo({ address: "203.0.113.8", family: 4 });

    await expect(assertPublicHostname(new URL("https://dns.google/"))).resolves.toBeUndefined();
  });

  it("refuse dès qu'une seule des adresses résolues est privée", async () => {
    resolvesTo(
      { address: "203.0.113.34", family: 4 },
      { address: "fd00::1", family: 6 },
    );

    await expect(assertPublicHostname(new URL("https://mixte.tld/"))).rejects.toThrow(
      "adresse privée",
    );
  });

  it("refuse quand la résolution échoue", async () => {
    h.lookup.mockRejectedValue(new Error("ENOTFOUND"));

    await expect(assertPublicHostname(new URL("https://inexistant.tld/"))).rejects.toThrow(
      "Résolution DNS impossible",
    );
  });
});

describe("assertPublicHostname — littéraux, jamais résolus", () => {
  it("refuse un littéral IPv6 privé sans appeler le DNS", async () => {
    for (const raw of [
      "http://[::1]/",
      "http://[fd00::1]/",
      "http://[fe80::1]/",
      "http://[::]/",
      "http://[fec0::1]/",
      "http://[ff02::1]/",
      "http://[::ffff:127.0.0.1]/",
    ]) {
      await expect(assertPublicHostname(new URL(raw))).rejects.toThrow("adresse privée");
    }
    expect(h.lookup).not.toHaveBeenCalled();
  });

  it("refuse un littéral IPv4 privé sans appeler le DNS", async () => {
    await expect(assertPublicHostname(new URL("http://169.254.169.254/"))).rejects.toThrow(
      "adresse privée",
    );
    expect(h.lookup).not.toHaveBeenCalled();
  });

  it("accepte un littéral public sans appeler le DNS", async () => {
    await expect(assertPublicHostname(new URL("https://203.0.113.8/"))).resolves.toBeUndefined();
    await expect(
      assertPublicHostname(new URL("https://[2001:4860:4860::8888]/")),
    ).resolves.toBeUndefined();
    expect(h.lookup).not.toHaveBeenCalled();
  });
});
