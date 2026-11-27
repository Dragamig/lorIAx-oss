import { describe, expect, it } from "vitest";
import { generateWebhookToken } from "../webhook-inbound";
import { activationRequiresTallyForm, tallyFormMissing } from "../tally-activation-guard";

const withMarker = (tallyFormId: unknown) => ({ token: "t", secret: "s", tallyFormId });

describe("tallyFormMissing", () => {
  it("vrai pour un webhook entrant dont le formulaire est déclaré mais vide", () => {
    expect(tallyFormMissing("webhook_inbound", withMarker(null))).toBe(true);
    expect(tallyFormMissing("webhook_inbound", withMarker(""))).toBe(true);
    expect(tallyFormMissing("webhook_inbound", withMarker("   "))).toBe(true);
  });
  it("faux quand le formulaire est choisi", () => {
    expect(tallyFormMissing("webhook_inbound", withMarker("wMeKx2"))).toBe(false);
  });
  it("faux pour un webhook sans déclaration de formulaire (Tally réel de prod, webhook générique)", () => {
    expect(tallyFormMissing("webhook_inbound", { token: "t", secret: "s", lastReceived: {} })).toBe(false);
    expect(tallyFormMissing("webhook_inbound", null)).toBe(false);
  });
  it("faux pour tout autre déclencheur", () => {
    expect(tallyFormMissing("value_changed", { tallyFormId: null })).toBe(false);
  });
});

describe("activationRequiresTallyForm (c)(d)", () => {
  const stored = { enabled: false, triggerType: "webhook_inbound", triggerConfig: withMarker(null) };

  it("(c) refuse l'activation tant que le formulaire n'est pas choisi", () => {
    expect(activationRequiresTallyForm(stored, { enabled: true })).toBe(true);
  });
  it("(d) accepte l'activation quand le PATCH choisit le formulaire", () => {
    expect(activationRequiresTallyForm(stored, { enabled: true, triggerConfig: { tallyFormId: "wMeKx2" } })).toBe(false);
  });
  it("(d) accepte l'activation quand le formulaire est déjà enregistré", () => {
    expect(activationRequiresTallyForm({ ...stored, triggerConfig: withMarker("wMeKx2") }, { enabled: true })).toBe(false);
  });
  it("ne bloque ni la désactivation ni une édition qui laisse l'automatisme inactif", () => {
    expect(activationRequiresTallyForm({ ...stored, enabled: true }, { enabled: false })).toBe(false);
    expect(activationRequiresTallyForm(stored, {})).toBe(false);
  });
  it("refuse d'effacer le formulaire d'un automatisme actif, même en omettant la clé", () => {
    const active = { enabled: true, triggerType: "webhook_inbound", triggerConfig: withMarker("wMeKx2") };
    expect(activationRequiresTallyForm(active, { triggerConfig: { tallyFormId: null } })).toBe(true);
    expect(activationRequiresTallyForm(active, { triggerConfig: {} })).toBe(true);
  });
  it("ne bloque pas un Tally réel sans déclaration de formulaire", () => {
    const real = { enabled: false, triggerType: "webhook_inbound", triggerConfig: { ...generateWebhookToken() } };
    expect(activationRequiresTallyForm(real, { enabled: true })).toBe(false);
  });
  it("vérifie aussi un automatisme créé directement actif", () => {
    expect(activationRequiresTallyForm(null, { enabled: true, triggerType: "webhook_inbound", triggerConfig: { tallyFormId: null } })).toBe(true);
    expect(activationRequiresTallyForm(null, { enabled: true, triggerType: "webhook_inbound", triggerConfig: {} })).toBe(false);
  });
});
