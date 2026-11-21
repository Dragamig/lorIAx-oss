/**
 * AZ-25 — la route de soumission d'un formulaire public lisait l'adresse dans
 * le PREMIER élément de `x-forwarded-for`, c'est-à-dire la partie que le client
 * écrit lui-même. Un robot changeait donc de seau de quota à chaque requête, et
 * ni le plafond horaire ni le captcha ne freinaient quoi que ce soit.
 *
 * Second volet : `getClientIp` rend une CONSTANTE quand aucune adresse n'est
 * déterminable. L'indexer comme une adresse met tous les clients anonymes dans
 * le même seau, ce qui transforme le plafond en déni de service partagé.
 *
 * La limitation de débit n'est PAS doublée : le test exerce le vrai module,
 * avec son adossement mémoire, qui est aussi le comportement de production
 * sans Redis.
 */
import { describe, it, expect, vi, beforeEach } from "vitest";

vi.mock("@/lib/db", () => {
  // La vue n'existe pas : la route répond 410 une fois le quota franchi.
  // Seul le code de statut nous intéresse ici, pas l'insertion.
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const self: any = {
    select: vi.fn(() => self),
    from: vi.fn(() => self),
    where: vi.fn(() => Object.assign(Promise.resolve([]), self)),
    limit: vi.fn(() => Promise.resolve([])),
  };
  return { db: self };
});

vi.mock("@/lib/automations/executor", () => ({ dispatchTrigger: vi.fn(async () => {}) }));
vi.mock("@/lib/logger", () => ({
  default: { info: vi.fn(), warn: vi.fn(), error: vi.fn(), debug: vi.fn() },
}));

import { NextRequest } from "next/server";
import { POST } from "@/app/api/public/views/[token]/submit/route";
import { getClientIp, getClientIpOrNull, UNKNOWN_CLIENT_IP } from "@/lib/rate-limit";

let seq = 0;
/** Jeton unique par test : le magasin de quotas est partagé par le fichier. */
const freshToken = () => `t${"0".repeat(30)}${(seq++).toString().padStart(2, "0")}`;

const params = (token: string) => ({ params: Promise.resolve({ token }) });

function submission(headers: Record<string, string>) {
  return new NextRequest("http://localhost/api/public/views/x/submit", {
    method: "POST",
    headers: { "content-type": "application/json", ...headers },
    body: JSON.stringify({ cells: {} }),
  });
}

beforeEach(() => {
  delete process.env.HCAPTCHA_SECRET;
  delete process.env.REDIS_URL;
});

describe("AZ-25 — un en-tête forgé ne permet plus de changer de seau", () => {
  it("plafonne le robot qui change de valeur à chaque requête", async () => {
    const token = freshToken();

    // Le robot forge une valeur différente à chaque appel ; le proxy de
    // confiance ajoute, lui, la vraie adresse à droite.
    const forged = (i: number) => `10.0.0.${i}, 198.51.100.25`;

    for (let i = 0; i < 10; i++) {
      const res = await POST(submission({ "x-forwarded-for": forged(i) }), params(token));
      expect(res.status).not.toBe(429);
    }

    const refused = await POST(
      submission({ "x-forwarded-for": forged(99) }),
      params(token)
    );
    expect(refused.status).toBe(429);
  });

  it("garde des seaux distincts pour deux adresses réellement différentes", async () => {
    const token = freshToken();

    for (let i = 0; i < 10; i++) {
      await POST(submission({ "x-forwarded-for": "198.51.100.31" }), params(token));
    }
    expect(
      (await POST(submission({ "x-forwarded-for": "198.51.100.31" }), params(token)))
        .status
    ).toBe(429);

    // Un autre client n'est pas puni pour le premier.
    expect(
      (await POST(submission({ "x-forwarded-for": "198.51.100.32" }), params(token)))
        .status
    ).not.toBe(429);
  });
});

describe("AZ-25 — l'absence d'adresse ne fait pas partager un compteur à tout le monde", () => {
  it("ne ferme pas le formulaire à tous après dix soumissions sans en-tête", async () => {
    const token = freshToken();

    for (let i = 0; i < 15; i++) {
      const res = await POST(submission({}), params(token));
      expect(res.status).not.toBe(429);
    }
  });

  it("n'enferme pas un client identifié dans le seau des soumissions sans adresse", async () => {
    const token = freshToken();

    for (let i = 0; i < 15; i++) {
      await POST(submission({}), params(token));
    }

    // Le client qui a, lui, une adresse garde son propre plafond intact.
    for (let i = 0; i < 10; i++) {
      const res = await POST(
        submission({ "x-forwarded-for": "198.51.100.41" }),
        params(token)
      );
      expect(res.status).not.toBe(429);
    }
  });
});

describe("AZ-25 — le contrat du helper d'adresse est explicite", () => {
  const withHeader = (value?: string) =>
    new Request("http://localhost/", {
      headers: value ? { "x-forwarded-for": value } : {},
    });

  it("prend la valeur de droite, pas celle que le client a écrite", () => {
    expect(getClientIp(withHeader("10.0.0.1, 198.51.100.7"))).toBe("198.51.100.7");
    expect(getClientIpOrNull(withHeader("10.0.0.1, 198.51.100.7"))).toBe("198.51.100.7");
  });

  it("distingue une adresse indéterminable d'une adresse", () => {
    expect(getClientIp(withHeader())).toBe(UNKNOWN_CLIENT_IP);
    // La variante destinée aux clés de quota rend une ABSENCE, pas la constante.
    expect(getClientIpOrNull(withHeader())).toBeNull();
  });
});
