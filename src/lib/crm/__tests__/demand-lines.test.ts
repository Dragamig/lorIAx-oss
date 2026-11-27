import { describe, expect, it, vi } from "vitest";
import { tallyAnswersText, extractDemandLines } from "../demand-lines";

// Charge Tally anonymisée (forme réelle : champs typés, choix par identifiants, fichiers).
const body = {
  eventId: "evt-1",
  eventType: "FORM_RESPONSE",
  data: {
    responseId: "resp-1",
    formId: "form-1",
    fields: [
      { key: "q_nom", label: "Votre nom", type: "INPUT_TEXT", value: "Camille Test" },
      { key: "q_mail", label: "E-mail", type: "INPUT_EMAIL", value: "camille@example.test" },
      { key: "q_besoin", label: "Décrivez votre projet", type: "TEXTAREA", value: "100 sweats noirs taille M, 50 sweats écrus taille L, broderie logo poitrine" },
      { key: "q_qte", label: "Quantité estimée", type: "INPUT_NUMBER", value: 150 },
      {
        key: "q_type",
        label: "Type de commande",
        type: "MULTIPLE_CHOICE",
        value: ["opt-prod"],
        options: [{ id: "opt-prod", text: "Production" }, { id: "opt-ech", text: "Échantillon" }],
      },
      { key: "q_vide", label: "Commentaire", type: "TEXTAREA", value: null },
      { key: "q_fichiers", label: "Maquettes", type: "FILE_UPLOAD", value: [{ id: "f1", name: "logo.png", url: "https://example.test/logo.png" }] },
    ],
  },
};

describe("tallyAnswersText", () => {
  it("rend chaque réponse renseignée en « libellé : valeur », résout les choix, ignore les vides", () => {
    const t = tallyAnswersText(body);
    expect(t).toContain("Décrivez votre projet : 100 sweats noirs");
    expect(t).toContain("Quantité estimée : 150");
    expect(t).toContain("Type de commande : Production");
    expect(t).toContain("Maquettes : logo.png");
    expect(t).not.toContain("Commentaire");
    expect(t).not.toContain("https://example.test");
  });
  it("renvoie une chaîne vide pour un corps non Tally", () => {
    expect(tallyAnswersText({ hello: 1 })).toBe("");
  });
});

describe("extractDemandLines", () => {
  it("transmet le texte des réponses à l'IA et normalise les lignes en provenance « Extrait »", async () => {
    const generate = vi.fn().mockResolvedValue({
      lines: [
        { modele: "Sweat", couleur: "Noir", taille: "M", quantite: 100, type: "Production", personnalisation: "Broderie logo poitrine" },
        { modele: "Sweat", couleur: "Écru", taille: "L", quantite: 50 },
      ],
    });
    const r = await extractDemandLines(body, generate);
    expect(generate).toHaveBeenCalledWith(expect.stringContaining("100 sweats noirs"));
    expect(r.warnings).toEqual([]);
    expect(r.lines).toHaveLength(2);
    expect(r.lines[0]).toMatchObject({ modele: "Sweat", couleur: "Noir", quantite: 100, type: "Production", statut: "À chiffrer", provenance: "Extrait" });
    expect(r.lines[1]).toMatchObject({ couleur: "Écru", quantite: 50, statut: "À chiffrer", provenance: "Extrait" });
  });

  it("écarte une ligne inexploitable et garde les autres, avec avertissement", async () => {
    const generate = vi.fn().mockResolvedValue({
      lines: [{ modele: "Sweat", quantite: 10 }, "n'importe quoi", { quantite: "beaucoup" }, {}, { modele: "Tee", type: "Inconnu" }],
    });
    const r = await extractDemandLines(body, generate);
    expect(r.lines.map((l) => l.modele)).toEqual(["Sweat", "Tee"]);
    expect(r.lines[1].type).toBeUndefined();
    expect(r.warnings).toEqual(["3 ligne(s) inexploitable(s) écartée(s)"]);
  });

  it("ne lève jamais : échec de l'IA = aucune ligne et un avertissement", async () => {
    const r = await extractDemandLines(body, vi.fn().mockRejectedValue(new Error("quota")));
    expect(r.lines).toEqual([]);
    expect(r.warnings[0]).toContain("quota");
  });

  it("tronque la personnalisation à 500, écarte une quantité négative avec avertissement, garde la ligne", async () => {
    const generate = vi.fn().mockResolvedValue({
      lines: [{ modele: "Sweat", quantite: -5, personnalisation: "x".repeat(900) }, { modele: "Tee", quantite: 3 }],
    });
    const r = await extractDemandLines(body, generate);
    expect(r.lines).toHaveLength(2);
    expect(r.lines[0].personnalisation).toHaveLength(500);
    expect(r.lines[0].quantite).toBeUndefined();
    expect(r.warnings.join(" ")).toContain("quantité");
  });

  it("type comparé sans casse ni accents, valeur canonique conservée", async () => {
    const generate = vi.fn().mockResolvedValue({ lines: [{ modele: "A", type: "echantillon" }, { modele: "B", type: " PRODUCTION " }] });
    const r = await extractDemandLines(body, generate);
    expect(r.lines.map((l) => l.type)).toEqual(["Échantillon", "Production"]);
  });

  it("tronque le texte envoyé à l'IA et les lignes à 100", async () => {
    const big = { eventType: "FORM_RESPONSE", data: { fields: [{ label: "L", value: "y".repeat(50000) }] } };
    const generate = vi.fn().mockResolvedValue({ lines: Array.from({ length: 150 }, (_, i) => ({ modele: `M${i}` })) });
    const r = await extractDemandLines(big, generate);
    expect((generate.mock.calls[0][0] as string).length).toBeLessThanOrEqual(12000);
    expect(r.lines).toHaveLength(100);
    expect(r.warnings.join(" ")).toContain("100");
  });

  it("sans réponse exploitable : pas d'appel IA", async () => {
    const generate = vi.fn();
    const r = await extractDemandLines({ hello: 1 }, generate);
    expect(generate).not.toHaveBeenCalled();
    expect(r.lines).toEqual([]);
  });
});
