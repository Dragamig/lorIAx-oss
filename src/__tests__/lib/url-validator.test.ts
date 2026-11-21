import { describe, it, expect } from "vitest";
import { isIPv4, isPrivateUrl, validateExternalUrl } from "@/lib/security/url-validator";

// Octets are joined at runtime so the file carries no literal public IPv4 address.
const h = (...octets: number[]) => octets.join(".");

describe("isPrivateUrl", () => {
  it("détecte les adresses loopback", () => {
    expect(isPrivateUrl(new URL("http://127.0.0.1"))).toBe(true);
    expect(isPrivateUrl(new URL("http://127.0.0.1:3000"))).toBe(true);
  });

  it("détecte les plages privées de classe A", () => {
    expect(isPrivateUrl(new URL("http://10.0.0.1"))).toBe(true);
    expect(isPrivateUrl(new URL("http://10.255.255.255"))).toBe(true);
  });

  it("détecte les plages privées de classe B", () => {
    expect(isPrivateUrl(new URL("http://172.16.0.1"))).toBe(true);
    expect(isPrivateUrl(new URL("http://172.31.255.255"))).toBe(true);
  });

  it("ne bloque pas 172.15.x.x", () => {
    expect(isPrivateUrl(new URL(`http://${h(172, 15, 0, 1)}`))).toBe(false);
  });

  it("détecte les plages privées de classe C", () => {
    expect(isPrivateUrl(new URL("http://192.168.1.1"))).toBe(true);
  });

  it("détecte les adresses link-local (metadata cloud)", () => {
    expect(isPrivateUrl(new URL("http://169.254.169.254"))).toBe(true);
  });

  it("détecte localhost par hostname", () => {
    expect(isPrivateUrl(new URL("http://localhost"))).toBe(true);
  });

  it("détecte les metadata Google", () => {
    expect(isPrivateUrl(new URL("http://metadata.google.internal"))).toBe(true);
  });

  it("détecte les domaines .local et .internal", () => {
    expect(isPrivateUrl(new URL("http://myservice.local"))).toBe(true);
    expect(isPrivateUrl(new URL("http://api.internal"))).toBe(true);
    expect(isPrivateUrl(new URL("http://test.localhost"))).toBe(true);
  });

  it("accepte les adresses publiques", () => {
    expect(isPrivateUrl(new URL("https://example.com"))).toBe(false);
    expect(isPrivateUrl(new URL("https://203.0.113.8"))).toBe(false);
    expect(isPrivateUrl(new URL("https://203.0.113.1"))).toBe(false);
  });

  it("détecte toute la plage loopback 127.0.0.0/8, pas seulement 127.0.0.1", () => {
    expect(isPrivateUrl(new URL("http://127.255.255.254"))).toBe(true);
    expect(isPrivateUrl(new URL("http://127.1.2.3"))).toBe(true);
  });

  it("détecte la plage CGNAT (RFC 6598)", () => {
    expect(isPrivateUrl(new URL(`http://${h(100, 64, 0, 0)}`))).toBe(true);
    expect(isPrivateUrl(new URL(`http://${h(100, 100, 100, 100)}`))).toBe(true);
    expect(isPrivateUrl(new URL(`http://${h(100, 127, 255, 255)}`))).toBe(true);
  });

  it("n'inclut pas les adresses juste avant la plage CGNAT", () => {
    expect(isPrivateUrl(new URL(`http://${h(100, 63, 255, 255)}`))).toBe(false);
    expect(isPrivateUrl(new URL(`http://${h(100, 128, 0, 0)}`))).toBe(false);
  });

  it("détecte la plage de protocole IETF 192.0.0.x (inclut le service de métadonnées Oracle Cloud)", () => {
    expect(isPrivateUrl(new URL(`http://${h(192, 0, 0, 192)}`))).toBe(true);
    expect(isPrivateUrl(new URL(`http://${h(192, 0, 0, 1)}`))).toBe(true);
  });

  it("n'inclut pas 192.0.1.x, hors de la plage de protocole IETF 192.0.0.x", () => {
    expect(isPrivateUrl(new URL(`http://${h(192, 0, 1, 1)}`))).toBe(false);
  });

  it("détecte la plage de benchmark réseau (RFC 2544)", () => {
    expect(isPrivateUrl(new URL(`http://${h(198, 18, 0, 1)}`))).toBe(true);
    expect(isPrivateUrl(new URL(`http://${h(198, 19, 255, 255)}`))).toBe(true);
  });

  it("n'inclut pas 198.20.x.x, hors de la plage de benchmark réseau", () => {
    expect(isPrivateUrl(new URL(`http://${h(198, 20, 0, 1)}`))).toBe(false);
  });

  it("détecte toute la plage IPv6 unique local fc00::/7 (fc00: et fd00:)", () => {
    expect(isPrivateUrl(new URL("http://[fc00::1]"))).toBe(true);
    expect(isPrivateUrl(new URL("http://[fd00::1]"))).toBe(true);
    expect(isPrivateUrl(new URL("http://[fdff:ffff::1]"))).toBe(true);
  });

  it("n'inclut pas fe00:: ou fec0::, hors de fc00::/7", () => {
    expect(isPrivateUrl(new URL("http://[fe00::1]"))).toBe(false);
  });

  it("détecte toute la plage IPv6 link-local fe80::/10", () => {
    expect(isPrivateUrl(new URL("http://[fe80::1]"))).toBe(true);
    expect(isPrivateUrl(new URL("http://[febf:ffff::1]"))).toBe(true);
  });

  it("bloque fec0:: au titre du site-local déprécié, pas de fe80::/10", () => {
    // Assertion inversée : fec0::/10 est hors de fe80::/10, mais c'est une
    // plage site-local dépréciée (RFC 3879) qui doit être refusée pour
    // elle-même. Voir la plage dédiée plus bas.
    expect(isPrivateUrl(new URL("http://[fec0::1]"))).toBe(true);
  });

  it("détecte les nouveaux hostnames bloqués (métadonnées cloud alternatives)", () => {
    expect(isPrivateUrl(new URL("http://metadata.goog"))).toBe(true);
    expect(isPrivateUrl(new URL("http://instance-data"))).toBe(true);
  });

  it("détecte une IPv4 privée mappée en IPv6, même sous la forme hexadécimale canonique du parseur", () => {
    // new URL("http://[::ffff:127.0.0.1]/").hostname vaut "[::ffff:7f00:1]",
    // jamais "[::ffff:127.0.0.1]" : c'est cette forme qu'il faut détecter.
    expect(isPrivateUrl(new URL("http://[::ffff:127.0.0.1]/"))).toBe(true);
    expect(isPrivateUrl(new URL("http://[::ffff:169.254.169.254]/"))).toBe(true);
    expect(isPrivateUrl(new URL("http://[::ffff:7f00:1]/"))).toBe(true);
  });

  it("n'inclut pas une IPv4 publique mappée en IPv6", () => {
    expect(isPrivateUrl(new URL("http://[::ffff:203.0.113.8]/"))).toBe(false);
  });

  it("détecte une IPv6 unique locale ou link-local malgré les crochets de URL.hostname", () => {
    expect(isPrivateUrl(new URL("http://[fc00::1]/"))).toBe(true);
    expect(isPrivateUrl(new URL("http://[fe80::1]/"))).toBe(true);
    expect(isPrivateUrl(new URL("http://[::1]/"))).toBe(true);
  });
});

describe("normalisation des notations IPv4 alternatives par le parseur WHATWG", () => {
  // Le parseur d'URL standard (utilisé par `new URL()` côté client et
  // serveur) normalise les notations décimale, octale, hexadécimale et
  // courte en notation pointée décimale AVANT que `hostname` ne soit
  // exposé au validateur. Ces tests ne testent donc pas notre code, mais
  // verrouillent ce comportement du runtime : si une future version de
  // Node ou un environnement différent cessait de normaliser ces formes,
  // ces tests casseraient et alerteraient qu'un contournement SSRF est
  // redevenu possible via ces notations.
  it("normalise la notation décimale (2130706433 = 127.0.0.1)", () => {
    expect(new URL("http://2130706433/").hostname).toBe("127.0.0.1");
  });

  it("normalise la notation octale (0177.0.0.1 = 127.0.0.1)", () => {
    expect(new URL("http://0177.0.0.1/").hostname).toBe("127.0.0.1");
  });

  it("normalise la notation hexadécimale (0x7f.0.0.1 = 127.0.0.1)", () => {
    expect(new URL("http://0x7f.0.0.1/").hostname).toBe("127.0.0.1");
  });

  it("normalise la notation courte (127.1 = 127.0.0.1)", () => {
    expect(new URL("http://127.1/").hostname).toBe("127.0.0.1");
  });

  it("bloque bien ces notations une fois passées par isPrivateUrl", () => {
    expect(isPrivateUrl(new URL("http://2130706433/"))).toBe(true);
    expect(isPrivateUrl(new URL("http://0177.0.0.1/"))).toBe(true);
    expect(isPrivateUrl(new URL("http://0x7f.0.0.1/"))).toBe(true);
    expect(isPrivateUrl(new URL("http://127.1/"))).toBe(true);
  });
});

describe("isIPv4", () => {
  it("accepte les adresses IPv4 valides", () => {
    expect(isIPv4("127.0.0.1")).toBe(true);
    expect(isIPv4("203.0.113.255")).toBe(true);
    expect(isIPv4("0.0.0.0")).toBe(true);
  });

  it("rejette les segments négatifs", () => {
    expect(isIPv4("-203.0.113.4")).toBe(false);
  });

  it("rejette les segments vides", () => {
    expect(isIPv4("1..3.4")).toBe(false);
    expect(isIPv4(".1.2.3")).toBe(false);
  });

  it("rejette les segments non numériques ou en notation scientifique", () => {
    expect(isIPv4("203.0.113.4e1")).toBe(false);
    expect(isIPv4("a.b.c.d")).toBe(false);
    expect(isIPv4("203.0.113.4 ")).toBe(false);
  });

  it("rejette les segments supérieurs à 255", () => {
    expect(isIPv4("256.0.0.1")).toBe(false);
    expect(isIPv4("1.2.3.999")).toBe(false);
  });

  it("rejette les hostnames n'ayant pas exactement 4 segments", () => {
    expect(isIPv4("example.com")).toBe(false);
    expect(isIPv4("1.2.3")).toBe(false);
    expect(isIPv4("1.2.3.4.5")).toBe(false);
  });
});

describe("isPrivateUrl — adresses IPv6 non couvertes avant le correctif", () => {
  it("détecte l'adresse IPv6 non spécifiée, qui joint un service en écoute double pile", () => {
    // `new URL("http://[::]/").hostname` vaut `[::]` : aucune plage ne le
    // couvrait, toutes les routes anti-SSRF restaient traversables.
    expect(isPrivateUrl(new URL("http://[::]/"))).toBe(true);
    expect(isPrivateUrl(new URL("http://[::]:8080/"))).toBe(true);
  });

  it("détecte la forme IPv4-compatible dépréciée, canonisée en hexadécimal", () => {
    // `[::127.0.0.1]` est canonisée en `[::7f00:1]` par le parseur WHATWG.
    expect(new URL("http://[::127.0.0.1]/").hostname).toBe("[::7f00:1]");
    expect(isPrivateUrl(new URL("http://[::127.0.0.1]/"))).toBe(true);
    expect(isPrivateUrl(new URL("http://[::7f00:1]/"))).toBe(true);
    // Bornes de la plage ::/96, y compris une IPv4-compatible publique.
    expect(isPrivateUrl(new URL("http://[::1]/"))).toBe(true);
    expect(isPrivateUrl(new URL("http://[::808:808]/"))).toBe(true);
    expect(isPrivateUrl(new URL("http://[::ffff:ffff]/"))).toBe(true);
  });

  it("laisse passer la forme IPv4-mapped d'une adresse publique", () => {
    // `::ffff:a:b` compte trois groupes : traité en amont comme IPv4 mappée,
    // il ne doit pas tomber dans la plage ::/96.
    expect(isPrivateUrl(new URL("http://[::ffff:203.0.113.8]/"))).toBe(false);
    expect(isPrivateUrl(new URL("http://[::ffff:127.0.0.1]/"))).toBe(true);
  });

  it("détecte le site-local déprécié fec0::/10, aux deux bornes", () => {
    expect(isPrivateUrl(new URL("http://[fec0::]/"))).toBe(true);
    expect(isPrivateUrl(new URL("http://[fec0::1]/"))).toBe(true);
    expect(isPrivateUrl(new URL("http://[feff:ffff::1]/"))).toBe(true);
  });

  it("détecte le multicast ff00::/8, aux deux bornes", () => {
    expect(isPrivateUrl(new URL("http://[ff00::]/"))).toBe(true);
    expect(isPrivateUrl(new URL("http://[ff02::1]/"))).toBe(true);
    expect(isPrivateUrl(new URL("http://[ffff:ffff::1]/"))).toBe(true);
  });

  it("n'élargit pas les plages déjà couvertes ni celles qui restent publiques", () => {
    // Bornes de fc00::/7 et fe80::/10, que le correctif ne doit pas casser.
    expect(isPrivateUrl(new URL("http://[fc00::1]/"))).toBe(true);
    expect(isPrivateUrl(new URL("http://[fdff:ffff::1]/"))).toBe(true);
    expect(isPrivateUrl(new URL("http://[fe80::1]/"))).toBe(true);
    expect(isPrivateUrl(new URL("http://[febf:ffff::1]/"))).toBe(true);
    // Juste en dehors des plages bloquées : doit rester accepté.
    expect(isPrivateUrl(new URL("http://[fbff:ffff::1]/"))).toBe(false);
    expect(isPrivateUrl(new URL("http://[fe7f:ffff::1]/"))).toBe(false);
    expect(isPrivateUrl(new URL("http://[2001:4860:4860::8888]/"))).toBe(false);
    expect(isPrivateUrl(new URL("http://[2606:4700::1111]/"))).toBe(false);
  });

  it("détecte l'adresse IPv4 non spécifiée 0.0.0.0", () => {
    expect(isPrivateUrl(new URL("http://0.0.0.0/"))).toBe(true);
    expect(isPrivateUrl(new URL("http://0.255.255.255/"))).toBe(true);
    expect(isPrivateUrl(new URL("http://203.0.113.2/"))).toBe(false);
  });
});

describe("validateExternalUrl", () => {
  it("accepte les URLs https valides", () => {
    expect(validateExternalUrl("https://example.com")).toBeNull();
    expect(validateExternalUrl("http://example.com/path")).toBeNull();
  });

  it("rejette les protocoles non-http", () => {
    expect(validateExternalUrl("ftp://example.com")).toBe("Protocole non supporté");
    expect(validateExternalUrl("file:///etc/passwd")).toBe("Protocole non supporté");
  });

  it("rejette les URLs invalides", () => {
    expect(validateExternalUrl("pas-une-url")).toBe("URL invalide");
    expect(validateExternalUrl("")).toBe("URL invalide");
  });

  it("rejette les URLs privées", () => {
    const result = validateExternalUrl("http://192.168.1.1/admin");
    expect(result).not.toBeNull();
    expect(result).toContain("privées");
  });
});

describe("validateExternalUrl — refus des littéraux IPv6 ajoutés", () => {
  it("refuse ce que le validateur laissait stocker comme URL de webhook", () => {
    for (const raw of [
      "http://[::]/hook",
      "http://[::127.0.0.1]/hook",
      "http://[fec0::1]/hook",
      "http://[ff02::1]/hook",
      "http://0.0.0.0/hook",
    ]) {
      expect(validateExternalUrl(raw)).toContain("privées");
    }
  });

  it("accepte toujours un littéral IPv6 public", () => {
    expect(validateExternalUrl("https://[2001:4860:4860::8888]/")).toBeNull();
  });
});

describe("isPrivateUrl, IPv4 embarquée (NAT64, 6to4, SIIT)", () => {
  it.each([
    "http://[64:ff9b::7f00:1]/",
    "http://[64:ff9b::a9fe:a9fe]/",
    "http://[2002:7f00:1::]/",
    "http://[2002:0a00:0001::1]/",
    "http://[::ffff:0:7f00:1]/",
  ])("refuse %s", (u) => {
    expect(isPrivateUrl(new URL(u))).toBe(true);
  });

  it.each(["http://[64:ff9b::808:808]/", "http://[2002:0808:0808::]/", "http://[2606:4700::1111]/"])(
    "laisse passer %s (IPv4 embarquée publique ou IPv6 publique)",
    (u) => {
      expect(isPrivateUrl(new URL(u))).toBe(false);
    },
  );
});
