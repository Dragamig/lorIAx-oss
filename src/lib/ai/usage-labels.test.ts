import { describe, it, expect } from "vitest";
// Via `schema` et non `schema-ai` : les deux modules sont mutuellement
// dépendants, seul ce point d'entrée les initialise dans le bon ordre.
import { aiUsageTypeEnum } from "@/lib/db/schema";
import { PROMPT_USAGE_TYPES } from "./builtin-prompts";
import {
  AI_USAGE_TYPES,
  AI_USAGE_LABELS,
  AI_USAGE_SHORT_LABELS,
  AI_USAGE_COLORS,
  AI_USAGE_BADGE_CLASSES,
  AI_USAGE_TYPES_ASSIGNABLE,
  AI_USAGE_TYPES_NOT_ASSIGNABLE,
  AI_USAGE_DESCRIPTIONS,
  aiUsageLabel,
  aiUsageShortLabel,
  aiUsageOptions,
} from "./usage-labels";

/**
 * Garde-fou de complétude : l'écran d'administration a longtemps ignoré quatre
 * usages de l'énumération, qui tournaient donc sur le modèle par défaut du
 * fournisseur sans que personne ne l'ait décidé. Ces tests échouent au
 * prochain usage ajouté tant qu'il n'a pas été libellé et classé.
 */
describe("complétude des usages IA", () => {
  it("couvre exactement l'énumération ai_usage_type", () => {
    expect([...AI_USAGE_TYPES].sort()).toEqual(
      [...aiUsageTypeEnum.enumValues].sort(),
    );
  });

  it("donne un libellé, un libellé court, une couleur et un badge à chaque usage", () => {
    for (const usage of AI_USAGE_TYPES) {
      expect(AI_USAGE_LABELS[usage], `libellé manquant : ${usage}`).toBeTruthy();
      expect(
        AI_USAGE_SHORT_LABELS[usage],
        `libellé court manquant : ${usage}`,
      ).toBeTruthy();
      expect(AI_USAGE_COLORS[usage], `couleur manquante : ${usage}`).toMatch(
        /^#[0-9a-f]{6}$/i,
      );
      expect(
        AI_USAGE_BADGE_CLASSES[usage],
        `badge manquant : ${usage}`,
      ).toBeTruthy();
    }
  });

  it("n'affiche jamais l'identifiant technique à l'utilisateur", () => {
    for (const usage of AI_USAGE_TYPES) {
      expect(AI_USAGE_LABELS[usage]).not.toBe(usage);
      expect(AI_USAGE_LABELS[usage]).not.toContain("_");
      expect(AI_USAGE_SHORT_LABELS[usage]).not.toBe(usage);
      expect(AI_USAGE_SHORT_LABELS[usage]).not.toContain("_");
    }
  });

  it("classe chaque usage comme pilotable ou explicitement non pilotable", () => {
    const assignable = new Set<string>(AI_USAGE_TYPES_ASSIGNABLE);
    const notAssignable = new Set(Object.keys(AI_USAGE_TYPES_NOT_ASSIGNABLE));

    for (const usage of AI_USAGE_TYPES) {
      const inAssignable = assignable.has(usage);
      const inNotAssignable = notAssignable.has(usage);
      expect(
        inAssignable !== inNotAssignable,
        `usage non classé (ou classé deux fois) : ${usage}`,
      ).toBe(true);
    }

    // Aucune entrée fantôme dans les deux listes.
    for (const usage of [...assignable, ...notAssignable]) {
      expect(AI_USAGE_TYPES).toContain(usage);
    }
  });

  it("justifie chaque usage écarté de l'écran d'affectation", () => {
    for (const [usage, reason] of Object.entries(
      AI_USAGE_TYPES_NOT_ASSIGNABLE,
    )) {
      expect(reason.length, `raison trop courte : ${usage}`).toBeGreaterThan(20);
    }
  });

  it("rend l'action IA des automatisations pilotable", () => {
    // Régression : `automation_ai` passe par `getLanguageModelForUsageInOrg`, donc
    // sans ligne d'affectation les automatisations tournaient sur le modèle par
    // défaut du fournisseur.
    expect(AI_USAGE_TYPES_ASSIGNABLE).toContain("automation_ai");
  });

  it("rend « Actions sur les bases » pilotable, libellé et description fixés", () => {
    expect(aiUsageTypeEnum.enumValues).toContain("chat_database_actions");
    expect(AI_USAGE_TYPES_ASSIGNABLE).toContain("chat_database_actions");
    expect(AI_USAGE_LABELS.chat_database_actions).toBe("Actions sur les bases");
    expect(AI_USAGE_DESCRIPTIONS.chat_database_actions).toBe(
      "Modèle fiable utilisé quand l'assistant travaille sur les bases",
    );
  });

  it("rend « Création » pilotable, libellé fixé", () => {
    expect(aiUsageTypeEnum.enumValues).toContain("creation");
    expect(AI_USAGE_TYPES_ASSIGNABLE).toContain("creation");
    expect(AI_USAGE_LABELS.creation).toBe("Création");
  });

  it("restreint les usages de prompt à des usages connus", () => {
    for (const usage of PROMPT_USAGE_TYPES) {
      expect(AI_USAGE_TYPES).toContain(usage);
      expect(AI_USAGE_LABELS[usage]).toBeTruthy();
    }
  });
});

describe("helpers de libellé", () => {
  it("retombe sur la valeur brute pour un usage inconnu", () => {
    expect(aiUsageLabel("chat")).toBe("Chat RAG");
    expect(aiUsageLabel("inconnu")).toBe("inconnu");
    expect(aiUsageShortLabel("chat")).toBe("Chat");
    expect(aiUsageShortLabel("inconnu")).toBe("inconnu");
  });

  it("produit des options value/label dans l'ordre demandé", () => {
    expect(aiUsageOptions(["help", "chat"])).toEqual([
      { value: "help", label: "Assistant d'aide" },
      { value: "chat", label: "Chat RAG" },
    ]);
  });
});
