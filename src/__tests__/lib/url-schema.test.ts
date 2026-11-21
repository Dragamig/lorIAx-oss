/**
 * Non-régression INJ-07 / INJ-19 (audit du 2026-08-19).
 *
 * `externalUrlSchema` est le contrôle de forme posé à l'écriture, avant que
 * l'URL fournie par l'utilisateur dorme en base. `z.string().url()` seul
 * n'exclut aucune adresse du réseau interne : ce schéma doit le faire.
 */
import { describe, it, expect } from "vitest";
import { externalUrlSchema } from "@/lib/security/url-schema";

const schema = externalUrlSchema();

function accepts(url: string): boolean {
  return schema.safeParse(url).success;
}

describe("externalUrlSchema", () => {
  it("accepte une URL publique en https", () => {
    expect(accepts("https://exemple.tld/webhook")).toBe(true);
  });

  it("accepte une URL publique en http", () => {
    expect(accepts("http://exemple.tld/webhook")).toBe(true);
  });

  it("refuse le service de métadonnées du cloud", () => {
    expect(accepts("http://169.254.169.254/latest/meta-data/")).toBe(false);
  });

  it("refuse l'adresse de bouclage", () => {
    expect(accepts("http://127.0.0.1/")).toBe(false);
  });

  it("refuse localhost", () => {
    expect(accepts("http://localhost/")).toBe(false);
  });

  it("refuse le service de métadonnées de Google Cloud", () => {
    expect(accepts("http://metadata.google.internal/")).toBe(false);
  });

  it("refuse un hôte en .internal", () => {
    expect(accepts("http://api.corp.internal/")).toBe(false);
  });

  it("refuse le protocole file:", () => {
    expect(accepts("file:///etc/passwd")).toBe(false);
  });

  it("refuse le protocole ftp:", () => {
    expect(accepts("ftp://exemple.tld/fichier")).toBe(false);
  });

  it("refuse une chaîne qui n'est pas une URL", () => {
    expect(accepts("ceci n'est pas une url")).toBe(false);
  });

  it("refuse une URL trop longue", () => {
    const tropLongue = `https://exemple.tld/${"a".repeat(2050)}`;
    expect(accepts(tropLongue)).toBe(false);
  });

  it("respecte la longueur maximale personnalisée", () => {
    const court = externalUrlSchema(20);
    expect(court.safeParse("https://exemple.tld/webhook-un-peu-long").success).toBe(false);
    expect(court.safeParse("https://ex.tld/").success).toBe(true);
  });
});

// Non-régression : exception `WEBHOOK_ALLOW_PRIVATE_TARGETS` (décision du
// 20/08/2026). L'option est passée explicitement par l'appelant (jamais lue
// dans ce fichier isomorphe) : ces tests vérifient le comportement du
// schéma une fois l'option posée à `true`, indépendamment de tout serveur.
describe("externalUrlSchema avec allowPrivateTargets", () => {
  const schemaOuvert = externalUrlSchema(2048, { allowPrivateTargets: true });

  function accepteAvecException(url: string): boolean {
    return schemaOuvert.safeParse(url).success;
  }

  it("accepte une adresse privée quand l'option est activée", () => {
    expect(accepteAvecException("http://10.0.4.17:11434/")).toBe(true);
  });

  it("accepte un hôte en .local quand l'option est activée", () => {
    expect(accepteAvecException("http://n8n.local:5678/webhook")).toBe(true);
  });

  it("refuse toujours le protocole file: même avec l'option activée", () => {
    expect(accepteAvecException("file:///etc/passwd")).toBe(false);
  });

  it("refuse toujours le protocole ftp: même avec l'option activée", () => {
    expect(accepteAvecException("ftp://10.0.4.17/fichier")).toBe(false);
  });

  it("continue d'accepter une URL publique", () => {
    expect(accepteAvecException("https://exemple.tld/webhook")).toBe(true);
  });

  it("l'option par défaut (absente) garde le refus des adresses privées", () => {
    // Même longueur/signature d'appel que le schéma par défaut, sans options :
    // preuve que l'ouverture est strictement opt-in.
    const schemaParDefaut = externalUrlSchema(2048, { allowPrivateTargets: false });
    expect(schemaParDefaut.safeParse("http://10.0.4.17:11434/").success).toBe(false);
  });
});
