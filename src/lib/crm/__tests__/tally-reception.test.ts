import { describe, expect, it } from "vitest";
import { buildFieldMap, extractTallyFormId, resolveMapping, type TallyField } from "../tally-reception";

const FIELDS: TallyField[] = [
  { key: "q1", label: "Votre nom", type: "INPUT_TEXT" },
  { key: "q2", label: "Société", type: "INPUT_TEXT" },
  { key: "q3", label: "E-mail", type: "INPUT_EMAIL" },
  { key: "q4", label: "Votre besoin", type: "TEXTAREA" },
];

describe("extractTallyFormId", () => {
  it("extrait l'identifiant d'une URL tally.so avec chemin, requête ou ancre", () => {
    expect(extractTallyFormId("https://tally.so/r/wMx4Rq")).toEqual({ id: "wMx4Rq" });
    expect(extractTallyFormId("  https://tally.so/r/wMx4Rq?utm=demo ")).toEqual({ id: "wMx4Rq" });
    expect(extractTallyFormId("https://www.tally.so/forms/abc123/edit")).toEqual({ id: "abc123" });
    expect(extractTallyFormId("https://tally.so/embed/wMx4Rq#x")).toEqual({ id: "wMx4Rq" });
  });
  it("accepte un identifiant nu", () => {
    expect(extractTallyFormId("wMx4Rq")).toEqual({ id: "wMx4Rq" });
  });
  it("vide : rien, ni identifiant ni erreur", () => {
    expect(extractTallyFormId("   ")).toEqual({});
  });
  it("refuse une autre URL ou un identifiant invalide", () => {
    expect(extractTallyFormId("https://example.com/r/wMx4Rq")).toEqual({ error: true });
    expect(extractTallyFormId("a b")).toEqual({ error: true });
    expect(extractTallyFormId("abc")).toEqual({ error: true });
  });
});

describe("resolveMapping", () => {
  it("sans correspondance stockée : détecte par type et le signale", () => {
    const m = resolveMapping(undefined, FIELDS);
    expect(m.name).toEqual({ key: "q1", detected: true });
    expect(m.email).toEqual({ key: "q3", detected: true });
    expect(m.title).toEqual({ key: null, detected: false });
  });
  it("une correspondance stockée prime et n'est pas détectée", () => {
    const m = resolveMapping({ name: "q2", title: "q4" }, FIELDS);
    expect(m.name).toEqual({ key: "q2", detected: false });
    expect(m.email).toEqual({ key: "q3", detected: true });
    expect(m.title).toEqual({ key: "q4", detected: false });
  });
  it("aucun champ du type voulu : pas de détection", () => {
    const m = resolveMapping(undefined, [FIELDS[3]]);
    expect(m.name).toEqual({ key: null, detected: false });
    expect(m.email).toEqual({ key: null, detected: false });
  });
});

describe("buildFieldMap", () => {
  it("ne garde que les choix explicites, titre automatique omis", () => {
    expect(buildFieldMap({ name: { key: "q1", detected: true }, email: { key: "q3", detected: false }, title: { key: null, detected: false } })).toEqual({ email: "q3" });
  });
});
