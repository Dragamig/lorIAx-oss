import { describe, it, expect } from "vitest";
import { isPrivateUrl, validateExternalUrl } from "@/lib/security/url-validator";

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
    expect(isPrivateUrl(new URL("http://172.15.0.1"))).toBe(false);
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
    expect(isPrivateUrl(new URL("https://8.8.8.8"))).toBe(false);
  });

  it("détecte la plage CGNAT 100.64.0.0/10", () => {
    expect(isPrivateUrl(new URL("http://100.64.0.1"))).toBe(true);
    expect(isPrivateUrl(new URL("http://100.127.255.255"))).toBe(true);
  });

  it("ne bloque pas les adresses voisines de la CGNAT", () => {
    expect(isPrivateUrl(new URL("http://100.63.255.255"))).toBe(false);
    expect(isPrivateUrl(new URL("http://100.128.0.1"))).toBe(false);
  });

  it("détecte 0.0.0.0, le broadcast et le multicast", () => {
    expect(isPrivateUrl(new URL("http://0.0.0.0"))).toBe(true);
    expect(isPrivateUrl(new URL("http://255.255.255.255"))).toBe(true);
    expect(isPrivateUrl(new URL("http://224.0.0.1"))).toBe(true);
    expect(isPrivateUrl(new URL("http://240.0.0.1"))).toBe(true);
  });

  it("détecte les plages réservées à la documentation et au benchmark", () => {
    expect(isPrivateUrl(new URL("http://192.0.2.1"))).toBe(true);
    expect(isPrivateUrl(new URL("http://198.18.0.1"))).toBe(true);
    expect(isPrivateUrl(new URL("http://198.51.100.1"))).toBe(true);
    expect(isPrivateUrl(new URL("http://203.0.113.1"))).toBe(true);
  });

  it("détecte les IPv6 littérales entre crochets (H1)", () => {
    expect(isPrivateUrl(new URL("http://[::1]"))).toBe(true);
    expect(isPrivateUrl(new URL("http://[::1]:8080"))).toBe(true);
    expect(isPrivateUrl(new URL("http://[fe80::1]"))).toBe(true);
    expect(isPrivateUrl(new URL("http://[fc00::1]"))).toBe(true);
    expect(isPrivateUrl(new URL("http://[fd12:3456:789a::1]"))).toBe(true);
    expect(isPrivateUrl(new URL("http://[fec0::1]"))).toBe(true);
    expect(isPrivateUrl(new URL("http://[ff02::1]"))).toBe(true);
    expect(isPrivateUrl(new URL("http://[::]"))).toBe(true);
  });

  it("détecte les IPv6 sous forme non compressée", () => {
    expect(isPrivateUrl(new URL("http://[0:0:0:0:0:0:0:1]"))).toBe(true);
    expect(isPrivateUrl(new URL("http://[fe80:0:0:0:0:0:0:1]"))).toBe(true);
  });

  it("détecte les IPv6-mapped IPv4", () => {
    expect(isPrivateUrl(new URL("http://[::ffff:10.0.0.1]"))).toBe(true);
    expect(isPrivateUrl(new URL("http://[::ffff:a00:1]"))).toBe(true);
    expect(isPrivateUrl(new URL("http://[::ffff:169.254.169.254]"))).toBe(true);
    expect(isPrivateUrl(new URL("http://[::ffff:127.0.0.1]"))).toBe(true);
  });

  it("détecte les IPv4 embarquées dans 6to4 et NAT64", () => {
    expect(isPrivateUrl(new URL("http://[2002:a00:1::1]"))).toBe(true); // 6to4 de 10.0.0.1
    expect(isPrivateUrl(new URL("http://[64:ff9b::a9fe:a9fe]"))).toBe(true); // NAT64 de 169.254.169.254
  });

  it("accepte les IPv6 publiques", () => {
    expect(isPrivateUrl(new URL("http://[2001:4860:4860::8888]"))).toBe(false);
    expect(isPrivateUrl(new URL("http://[2606:4700:4700::1111]"))).toBe(false);
    expect(isPrivateUrl(new URL("http://[::ffff:8.8.8.8]"))).toBe(false);
  });

  it("détecte la documentation IPv6 et les préfixes IETF", () => {
    expect(isPrivateUrl(new URL("http://[2001:db8::1]"))).toBe(true);
    expect(isPrivateUrl(new URL("http://[2001::1]"))).toBe(true); // Teredo
  });

  it("neutralise le point final et la casse du hostname", () => {
    expect(isPrivateUrl(new URL("http://localhost."))).toBe(true);
    expect(isPrivateUrl(new URL("http://MyService.LOCAL"))).toBe(true);
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
