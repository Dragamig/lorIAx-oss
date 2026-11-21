import { describe, it, expect } from "vitest";
import { extractVoiceNoteActions } from "@/lib/voice-notes/extract-actions";

describe("extractVoiceNoteActions", () => {
  it("extrait plusieurs actions dans l'ordre", () => {
    const markdown = `## Synthèse\nUne note vocale sur le projet.\n\n## Actions\n- Rappeler le client\n- Envoyer le devis (vendredi)\n- Relancer l'équipe`;
    expect(extractVoiceNoteActions(markdown)).toEqual([
      "Rappeler le client",
      "Envoyer le devis (vendredi)",
      "Relancer l'équipe",
    ]);
  });

  it("retourne un tableau vide sur (Aucune)", () => {
    const markdown = `## Synthèse\nRien de particulier.\n\n## Actions\n(Aucune)`;
    expect(extractVoiceNoteActions(markdown)).toEqual([]);
  });

  it("retourne un tableau vide sur (Aucune) en puce, insensible à la casse", () => {
    const markdown = `## Actions\n- (aucune)`;
    expect(extractVoiceNoteActions(markdown)).toEqual([]);
  });

  it("retourne un tableau vide en l'absence de section Actions", () => {
    const markdown = `## Synthèse\nUne note vocale sans section actions.`;
    expect(extractVoiceNoteActions(markdown)).toEqual([]);
  });

  it("retourne un tableau vide pour une entrée nulle ou vide", () => {
    expect(extractVoiceNoteActions(null)).toEqual([]);
    expect(extractVoiceNoteActions(undefined)).toEqual([]);
    expect(extractVoiceNoteActions("")).toEqual([]);
  });

  it("conserve l'échéance entre parenthèses dans l'intitulé", () => {
    const markdown = `## Actions\n- Envoyer le rapport (avant lundi prochain)`;
    expect(extractVoiceNoteActions(markdown)).toEqual(["Envoyer le rapport (avant lundi prochain)"]);
  });

  it("ignore le texte parasite non-puce dans la section", () => {
    const markdown = `## Actions\nVoici les actions relevées :\n- Préparer la présentation\nMerci de vérifier.\n- Contacter le fournisseur`;
    expect(extractVoiceNoteActions(markdown)).toEqual([
      "Préparer la présentation",
      "Contacter le fournisseur",
    ]);
  });

  it("déduplique les intitulés strictement identiques", () => {
    const markdown = `## Actions\n- Rappeler le client\n- Rappeler le client\n- Rappeler   le client  \n- Envoyer le devis`;
    expect(extractVoiceNoteActions(markdown)).toEqual(["Rappeler le client", "Envoyer le devis"]);
  });

  it("s'arrête au titre markdown suivant", () => {
    const markdown = `## Actions\n- Action 1\n- Action 2\n\n## Autre section\n- Ne doit pas être inclus`;
    expect(extractVoiceNoteActions(markdown)).toEqual(["Action 1", "Action 2"]);
  });

  it("tolère les variantes de titre (casse, accents, ponctuation)", () => {
    const markdown = `##Actions :\n- Une action`;
    expect(extractVoiceNoteActions(markdown)).toEqual(["Une action"]);
  });

  it("tolère les puces * et + et les listes numérotées", () => {
    const markdown = `## Actions\n* Action étoile\n+ Action plus\n1. Action numérotée`;
    expect(extractVoiceNoteActions(markdown)).toEqual([
      "Action étoile",
      "Action plus",
      "Action numérotée",
    ]);
  });

  it("retourne un tableau vide pour une section Actions vide", () => {
    const markdown = `## Actions\n\n## Autre section\n- Item`;
    expect(extractVoiceNoteActions(markdown)).toEqual([]);
  });
});
