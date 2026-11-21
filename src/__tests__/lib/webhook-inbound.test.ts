import { describe, it, expect } from "vitest";
import {
  generateWebhookToken,
  verifyWebhookSecret,
  buildWebhookPayload,
  sanitizeWebhookTriggerConfig,
} from "@/lib/automations/webhook-inbound";

describe("webhook entrant — helpers", () => {
  it("génère un token et un secret distincts et non triviaux", () => {
    const a = generateWebhookToken();
    expect(a.token).toMatch(/^[0-9a-f]{48}$/);
    expect(a.secret).toMatch(/^[0-9a-f]{48}$/);
    expect(a.token).not.toBe(a.secret);
    expect(generateWebhookToken().token).not.toBe(a.token);
  });

  it("verifyWebhookSecret : accepte si aucun secret configuré", () => {
    expect(verifyWebhookSecret({}, null)).toBe(true);
  });

  it("verifyWebhookSecret : exige le bon secret quand configuré", () => {
    expect(verifyWebhookSecret({ secret: "s3cr3t" }, "s3cr3t")).toBe(true);
    expect(verifyWebhookSecret({ secret: "s3cr3t" }, "mauvais")).toBe(false);
    expect(verifyWebhookSecret({ secret: "s3cr3t" }, null)).toBe(false);
  });

  it("verifyWebhookSecret : refuse une longueur différente sans lever d'exception", () => {
    expect(verifyWebhookSecret({ secret: "s3cr3t" }, "trop-long-pour-matcher")).toBe(false);
    expect(verifyWebhookSecret({ secret: "s3cr3t" }, "")).toBe(false);
  });

  it("buildWebhookPayload enveloppe le corps sous variables.body", () => {
    expect(buildWebhookPayload({ x: 1 })).toEqual({ variables: { body: { x: 1 } } });
  });

  it("buildWebhookPayload gère un corps null/undefined", () => {
    expect(buildWebhookPayload(null)).toEqual({ variables: { body: null } });
    expect(buildWebhookPayload(undefined)).toEqual({ variables: { body: undefined } });
  });
});

describe("sanitizeWebhookTriggerConfig — anti-token-imposé (finding sécurité Important)", () => {
  it("création : ignore un token/secret fourni par le client et régénère côté serveur", () => {
    const clientToken = "0".repeat(48); // 48 hex mais entropie nulle
    const clientSecret = "0".repeat(48);
    const result = sanitizeWebhookTriggerConfig({
      token: clientToken,
      secret: clientSecret,
      someOtherField: "conservé",
    });

    expect(result.token).not.toBe(clientToken);
    expect(result.secret).not.toBe(clientSecret);
    expect(result.token).toMatch(/^[0-9a-f]{48}$/);
    expect(result.secret).toMatch(/^[0-9a-f]{48}$/);
    // Les champs non sensibles de la config sont préservés.
    expect(result.someOtherField).toBe("conservé");
  });

  it("création : génère un token/secret même si le client n'en fournit aucun", () => {
    const result = sanitizeWebhookTriggerConfig({});
    expect(result.token).toMatch(/^[0-9a-f]{48}$/);
    expect(result.secret).toMatch(/^[0-9a-f]{48}$/);
  });

  it("édition : ignore un token/secret fourni par le client et conserve celui déjà en base", () => {
    const existing = { token: "aaaa".repeat(12), secret: "bbbb".repeat(12) };
    const result = sanitizeWebhookTriggerConfig(
      { token: "0".repeat(48), secret: "1".repeat(48), url: "https://example.com" },
      existing
    );

    expect(result.token).toBe(existing.token);
    expect(result.secret).toBe(existing.secret);
    expect(result.url).toBe("https://example.com");
  });
});

import {
  resolvePatchedTriggerConfig,
  buildLastReceived,
  redactWebhookTriggerConfig,
  LAST_RECEIVED_MAX_BYTES,
} from "@/lib/automations/webhook-inbound";

describe("clés gérées par le serveur", () => {
  const current = {
    token: "a".repeat(48),
    secret: "b".repeat(48),
    lastReceived: { at: "2026-01-01T00:00:00.000Z", size: 2, body: {} },
  };

  it("PATCH sans régénération : jeton, secret et lastReceived ne sont ni écrasés ni effacés", () => {
    const out = resolvePatchedTriggerConfig({
      currentTriggerType: "webhook_inbound",
      currentConfig: current,
      clientConfig: { token: "0".repeat(48), secret: "x", lastReceived: "pirate", note: "ok" },
    })!;
    expect(out.token).toBe(current.token);
    expect(out.secret).toBe(current.secret);
    expect(out.lastReceived).toEqual(current.lastReceived);
    expect(out.note).toBe("ok");
  });

  it("PATCH avec un corps vide conserve les clés serveur", () => {
    const out = resolvePatchedTriggerConfig({
      currentTriggerType: "webhook_inbound",
      currentConfig: current,
      clientConfig: {},
    })!;
    expect(out.token).toBe(current.token);
    expect(out.lastReceived).toEqual(current.lastReceived);
  });

  it("regenerate : nouveau jeton et secret, lastReceived non repris du client", () => {
    const out = resolvePatchedTriggerConfig({
      currentTriggerType: "webhook_inbound",
      currentConfig: current,
      clientConfig: { lastReceived: "pirate" },
      regenerate: true,
    })!;
    expect(out.token).not.toBe(current.token);
    expect(out.token).toMatch(/^[0-9a-f]{48}$/);
    expect(out.lastReceived).toBeUndefined();
  });

  it("bascule vers webhook_inbound : génère jeton et secret", () => {
    const out = resolvePatchedTriggerConfig({
      currentTriggerType: "row_created",
      currentConfig: {},
      nextTriggerType: "webhook_inbound",
    })!;
    expect(out.token).toMatch(/^[0-9a-f]{48}$/);
    expect(out.secret).toMatch(/^[0-9a-f]{48}$/);
  });

  it("sortie de webhook_inbound : retire les clés serveur du client", () => {
    const out = resolvePatchedTriggerConfig({
      currentTriggerType: "webhook_inbound",
      currentConfig: current,
      nextTriggerType: "cron",
      clientConfig: { token: "t", secret: "s", lastReceived: 1, cron: "* * * * *" },
    })!;
    expect(out).toEqual({ cron: "* * * * *" });
  });

  it("autre déclencheur sans config : undefined (rien à écrire)", () => {
    expect(
      resolvePatchedTriggerConfig({ currentTriggerType: "cron", currentConfig: {} })
    ).toBeUndefined();
  });

  it("buildLastReceived : conserve un petit corps", () => {
    const r = buildLastReceived({ a: 1 }, new Date("2026-02-03T04:05:06.000Z"));
    expect(r).toEqual({ at: "2026-02-03T04:05:06.000Z", size: 7, body: { a: 1 } });
  });

  it("buildLastReceived : tronque au-delà de 16 Ko", () => {
    const r = buildLastReceived({ big: "x".repeat(LAST_RECEIVED_MAX_BYTES) });
    expect(r.body).toBeNull();
    expect(r.truncated).toBe(true);
    expect(r.size).toBeGreaterThan(LAST_RECEIVED_MAX_BYTES);
  });

  it("redactWebhookTriggerConfig : masque jeton, secret et lastReceived", () => {
    const row = { triggerType: "webhook_inbound", triggerConfig: { ...current, note: "n" } };
    expect(redactWebhookTriggerConfig(row).triggerConfig).toEqual({ note: "n" });
    const other = { triggerType: "cron", triggerConfig: { token: "garde" } };
    expect(redactWebhookTriggerConfig(other)).toBe(other);
  });
});
