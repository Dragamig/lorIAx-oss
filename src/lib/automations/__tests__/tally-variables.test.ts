import { describe, expect, it } from "vitest";
import { buildWebhookPayload, tallyFormIdMismatch, tallyFieldsFromBody, resolvePatchedTriggerConfig } from "../webhook-inbound";

const body = (fields: { type: string; value: unknown }[]) => ({
  eventType: "FORM_RESPONSE",
  data: { responseId: "r", formId: "f1", fields: fields.map((f, i) => ({ key: `k${i}`, label: `L${i}`, ...f })) },
});

describe("variables Tally normalisées", () => {
  it("choisit l'e-mail et le nom par type, quel que soit l'ordre des champs", () => {
    const a = buildWebhookPayload(body([{ type: "INPUT_TEXT", value: "Ada" }, { type: "INPUT_EMAIL", value: "a@x.fr" }]));
    const b = buildWebhookPayload(body([{ type: "INPUT_EMAIL", value: "a@x.fr" }, { type: "INPUT_TEXT", value: "Ada" }]));
    expect(a.variables).toMatchObject({ tally: { name: "Ada", email: "a@x.fr" } });
    expect(b.variables).toMatchObject({ tally: { name: "Ada", email: "a@x.fr" } });
  });
  it("ignore les champs vides ou non texte, premier champ renseigné gagne", () => {
    const p = buildWebhookPayload(body([{ type: "INPUT_TEXT", value: null }, { type: "INPUT_TEXT", value: "Bob" }, { type: "INPUT_TEXT", value: "Autre" }]));
    expect(p.variables).toMatchObject({ tally: { name: "Bob", email: "" } });
  });
  it("n'ajoute rien à un corps qui n'est pas Tally", () => {
    expect(buildWebhookPayload({ hello: 1 }).variables).toEqual({ body: { hello: 1 } });
  });
});

describe("tallyFormIdMismatch", () => {
  const cfg = { tallyFormId: "f1" };
  it("faux sans clé ou clé vide", () => {
    expect(tallyFormIdMismatch({}, body([]))).toBe(false);
    expect(tallyFormIdMismatch({ tallyFormId: null }, body([]))).toBe(false);
  });
  it("faux pour le même formulaire, vrai pour un autre ou un corps sans formId", () => {
    expect(tallyFormIdMismatch(cfg, body([]))).toBe(false);
    expect(tallyFormIdMismatch({ tallyFormId: "zz" }, body([]))).toBe(true);
    expect(tallyFormIdMismatch(cfg, { hello: 1 })).toBe(true);
  });
});

describe("correspondance des champs Tally (tallyFieldMap)", () => {
  const fields = [
    { key: "q_nom", label: "Nom", type: "INPUT_TEXT", value: "Ada" },
    { key: "q_societe", label: "Société", type: "INPUT_TEXT", value: "Acme" },
    { key: "q_mail", label: "Mail", type: "INPUT_EMAIL", value: "a@x.fr" },
    { key: "q_mail2", label: "Mail pro", type: "INPUT_EMAIL", value: "pro@x.fr" },
    { key: "q_projet", label: "Projet", type: "TEXTAREA", value: "Refonte du site" },
  ];
  const b = { eventType: "FORM_RESPONSE", data: { formId: "f1", fields } };

  it("le mapping prime sur la détection par type", () => {
    const map = { name: "q_societe", email: "q_mail2", title: "q_projet" };
    const p = buildWebhookPayload(b, { tallyFieldMap: map });
    expect(p.variables.tally).toEqual({ name: "Acme", email: "pro@x.fr", title: "Refonte du site" });
  });

  it("sans mapping : détection par type, titre = nom du contact", () => {
    for (const cfg of [undefined, {}, { tallyFieldMap: null }]) {
      expect(buildWebhookPayload(b, cfg).variables.tally).toEqual({ name: "Ada", email: "a@x.fr", title: "Ada" });
    }
    expect(buildWebhookPayload(b).variables.tally).toEqual({ name: "Ada", email: "a@x.fr", title: "Ada" });
  });

  it("titre non mappé ou vide : nom du contact (mappé ou détecté)", () => {
    const p = buildWebhookPayload(b, { tallyFieldMap: { name: "q_societe", title: "absent" } });
    expect(p.variables.tally).toMatchObject({ name: "Acme", email: "a@x.fr", title: "Acme" });
  });

  it("une clé mappée absente du corps donne une valeur vide, sans retomber sur la détection", () => {
    const p = buildWebhookPayload(b, { tallyFieldMap: { email: "inconnue" } });
    expect(p.variables.tally).toMatchObject({ email: "", name: "Ada" });
  });

  it("un champ numérique mappé est converti en texte", () => {
    const body = { eventType: "FORM_RESPONSE", data: { fields: [{ key: "n", label: "N", type: "INPUT_NUMBER", value: 42 }] } };
    expect(buildWebhookPayload(body, { tallyFieldMap: { title: "n" } }).variables.tally?.title).toBe("42");
  });
});

describe("tallyFieldsFromBody", () => {
  it("liste key, label et type des champs de la réponse", () => {
    expect(tallyFieldsFromBody(body([{ type: "INPUT_TEXT", value: "x" }, { type: "INPUT_EMAIL", value: "" }]))).toEqual([
      { key: "k0", label: "L0", type: "INPUT_TEXT" },
      { key: "k1", label: "L1", type: "INPUT_EMAIL" },
    ]);
  });
  it("liste vide pour un corps absent ou non Tally", () => {
    expect(tallyFieldsFromBody(undefined)).toEqual([]);
    expect(tallyFieldsFromBody({ hello: 1 })).toEqual([]);
  });
});

describe("PATCH de trigger_config : tallyFieldMap", () => {
  it("traverse resolvePatchedTriggerConfig, token et secret conservés", () => {
    const map = { name: "a", email: "b", title: "c" };
    const out = resolvePatchedTriggerConfig({
      currentTriggerType: "webhook_inbound",
      currentConfig: { token: "t", secret: "s", tallyFormId: null },
      clientConfig: { tallyFormId: "f1", tallyFieldMap: map },
    });
    expect(out).toMatchObject({ token: "t", secret: "s", tallyFormId: "f1", tallyFieldMap: map });
  });
});
