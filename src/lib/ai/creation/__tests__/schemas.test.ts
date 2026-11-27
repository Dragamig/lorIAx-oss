import { describe, it, expect } from "vitest";
import {
  spreadsheetProposalSchema,
  documentProposalSchema,
  presentationProposalSchema,
  creationOverridesSchema,
} from "../schemas";

const spaceId = "6f1c1d0e-8f55-4c0b-9a39-3b6f0f4b1a11";
const base = { spaceId, title: "Titre" };
const col = (i: number) => ({ name: `c${i}` });
const cols = (n: number) => Array.from({ length: n }, (_, i) => col(i));

describe("spreadsheetProposalSchema", () => {
  it("accepte 1 et 30 colonnes", () => {
    expect(spreadsheetProposalSchema.safeParse({ ...base, columns: cols(1) }).success).toBe(true);
    expect(spreadsheetProposalSchema.safeParse({ ...base, columns: cols(30) }).success).toBe(true);
  });
  it("refuse 0 et 31 colonnes", () => {
    expect(spreadsheetProposalSchema.safeParse({ ...base, columns: [] }).success).toBe(false);
    expect(spreadsheetProposalSchema.safeParse({ ...base, columns: cols(31) }).success).toBe(false);
  });
  it("refuse une ligne de mauvaise longueur", () => {
    expect(
      spreadsheetProposalSchema.safeParse({ ...base, columns: cols(2), rows: [["a"]] }).success,
    ).toBe(false);
  });
  it("accepte des lignes de bonne longueur, max 50", () => {
    const ok = Array.from({ length: 50 }, () => ["a", "b"]);
    expect(spreadsheetProposalSchema.safeParse({ ...base, columns: cols(2), rows: ok }).success).toBe(true);
    const ko = Array.from({ length: 51 }, () => ["a", "b"]);
    expect(spreadsheetProposalSchema.safeParse({ ...base, columns: cols(2), rows: ko }).success).toBe(false);
  });
  it("refuse un type de colonne inconnu et un nom trop long", () => {
    expect(spreadsheetProposalSchema.safeParse({ ...base, columns: [{ name: "a", type: "bool" }] }).success).toBe(false);
    expect(spreadsheetProposalSchema.safeParse({ ...base, columns: [{ name: "x".repeat(61) }] }).success).toBe(false);
  });
  it("refuse titre vide, spaceId invalide, classification, createdBy", () => {
    expect(spreadsheetProposalSchema.safeParse({ ...base, title: "", columns: cols(1) }).success).toBe(false);
    expect(spreadsheetProposalSchema.safeParse({ ...base, spaceId: "x", columns: cols(1) }).success).toBe(false);
    expect(spreadsheetProposalSchema.safeParse({ ...base, columns: cols(1), classification: "secret" }).success).toBe(false);
    expect(spreadsheetProposalSchema.safeParse({ ...base, columns: cols(1), createdBy: "u" }).success).toBe(false);
  });
});

describe("documentProposalSchema", () => {
  const outline = [{ heading: "H", level: 1 }];
  it("refuse toute visibilité venue du modèle", () => {
    expect(documentProposalSchema.safeParse({ ...base, outline, visibility: "public" }).success).toBe(false);
    expect(documentProposalSchema.safeParse({ ...base, outline, visibility: "private" }).success).toBe(false);
    expect(documentProposalSchema.safeParse({ ...base, outline }).success).toBe(true);
  });
  it("refuse niveau 4, plan vide ou > 30", () => {
    expect(documentProposalSchema.safeParse({ ...base, outline: [{ heading: "H", level: 4 }] }).success).toBe(false);
    expect(documentProposalSchema.safeParse({ ...base, outline: [] }).success).toBe(false);
    expect(documentProposalSchema.safeParse({ ...base, outline: Array.from({ length: 31 }, () => outline[0]) }).success).toBe(false);
  });
  it("borne bodyMarkdown à 20 000", () => {
    expect(documentProposalSchema.safeParse({ ...base, outline, bodyMarkdown: "a".repeat(20000) }).success).toBe(true);
    expect(documentProposalSchema.safeParse({ ...base, outline, bodyMarkdown: "a".repeat(20001) }).success).toBe(false);
  });
  it("refuse classification et createdBy", () => {
    expect(documentProposalSchema.safeParse({ ...base, outline, classification: "x" }).success).toBe(false);
    expect(documentProposalSchema.safeParse({ ...base, outline, createdBy: "x" }).success).toBe(false);
  });
});

describe("presentationProposalSchema", () => {
  const slide = { title: "S" };
  it("accepte 12 diapositives, refuse 0 et 13", () => {
    expect(presentationProposalSchema.safeParse({ ...base, slides: Array.from({ length: 12 }, () => slide) }).success).toBe(true);
    expect(presentationProposalSchema.safeParse({ ...base, slides: [] }).success).toBe(false);
    expect(presentationProposalSchema.safeParse({ ...base, slides: Array.from({ length: 13 }, () => slide) }).success).toBe(false);
  });
  it("borne les puces à 8 et le layout", () => {
    const b = (n: number) => ({ title: "S", bullets: Array.from({ length: n }, () => "p") });
    expect(presentationProposalSchema.safeParse({ ...base, slides: [b(8)] }).success).toBe(true);
    expect(presentationProposalSchema.safeParse({ ...base, slides: [b(9)] }).success).toBe(false);
    expect(presentationProposalSchema.safeParse({ ...base, slides: [{ title: "S", layout: "cover" }] }).success).toBe(true);
    expect(presentationProposalSchema.safeParse({ ...base, slides: [{ title: "S", layout: "x" }] }).success).toBe(false);
  });
  it("refuse classification et createdBy", () => {
    expect(presentationProposalSchema.safeParse({ ...base, slides: [slide], classification: "x" }).success).toBe(false);
    expect(presentationProposalSchema.safeParse({ ...base, slides: [slide], createdBy: "x" }).success).toBe(false);
  });
});

describe("creationOverridesSchema", () => {
  it("accepte des surcharges partielles", () => {
    expect(
      creationOverridesSchema.safeParse({
        title: "T",
        spaceId,
        columns: cols(2),
        outline: [{ heading: "H", level: 2 }],
        slideTitles: ["a", "b"],
      }).success,
    ).toBe(true);
    expect(creationOverridesSchema.safeParse({}).success).toBe(true);
  });
  it("refuse champs inconnus et bornes", () => {
    expect(creationOverridesSchema.safeParse({ classification: "x" }).success).toBe(false);
    expect(creationOverridesSchema.safeParse({ createdBy: "x" }).success).toBe(false);
    expect(creationOverridesSchema.safeParse({ columns: cols(31) }).success).toBe(false);
    expect(creationOverridesSchema.safeParse({ slideTitles: Array.from({ length: 13 }, () => "a") }).success).toBe(false);
  });
});
