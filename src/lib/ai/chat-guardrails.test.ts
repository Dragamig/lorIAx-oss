import { describe, it, expect } from "vitest";
import {
  CHAT_NO_ACTION_RULES,
  CHAT_TOOL_RULES,
  CHAT_PRODUCT_RULES,
  buildChatToolRules,
  buildChatCreationRules,
  withChatGuardrails,
} from "./chat-guardrails";
import { ALL_ON_CHAT_ACTIONS } from "./chat-actions-settings";

describe("garde-fou du chat IA, sans outils", () => {
  it("annonce l'absence d'outils d'action", () => {
    expect(CHAT_NO_ACTION_RULES).toMatch(/aucun outil sur les bases ni sur les documents/i);
    expect(CHAT_NO_ACTION_RULES).toMatch(/jamais/i);
  });

  it("impose de recopier les identifiants et de relister si introuvable", () => {
    expect(CHAT_TOOL_RULES).toMatch(/Recopie les identifiants .* exactement tels que les outils/);
    expect(CHAT_TOOL_RULES).toMatch(/n'en invente jamais un/);
    expect(CHAT_TOOL_RULES).toMatch(/introuvable, dis-le et rappelle list_databases \(ou query_rows\)/);
  });

  it("n'utilise ni tiret cadratin ni demi-cadratin", () => {
    expect(CHAT_NO_ACTION_RULES).not.toMatch(/[–—]/);
  });

  it("s'ajoute à la fin d'un prompt surchargé en base", () => {
    const out = withChatGuardrails("Prompt personnalisé par l'admin");
    expect(out.startsWith("Prompt personnalisé par l'admin")).toBe(true);
    expect(out.endsWith(CHAT_NO_ACTION_RULES)).toBe(true);
    expect(out).not.toContain(CHAT_TOOL_RULES);
  });

  it("s'applique même sur un prompt vide", () => {
    expect(withChatGuardrails("")).toContain(CHAT_NO_ACTION_RULES);
  });
});

describe("garde-fou du chat IA, avec outils", () => {
  it("dit que les lectures sont libres et que tout changement est une proposition", () => {
    expect(CHAT_TOOL_RULES).toMatch(/lectures sont libres/i);
    expect(CHAT_TOOL_RULES).toMatch(/proposition/i);
    expect(CHAT_TOOL_RULES).toMatch(/cliquez sur Appliquer/);
  });

  it("interdit de dire qu'une action est faite avant confirmation", () => {
    expect(CHAT_TOOL_RULES).toMatch(
      /Ne dis jamais qu'une action est faite, appliquée, supprimée ou fusionnée/,
    );
    expect(CHAT_TOOL_RULES).toMatch(/avant la confirmation de l'utilisateur/);
  });

  it("exige de rapporter ce que les outils ont renvoyé", () => {
    expect(CHAT_TOOL_RULES).toMatch(/Rapporte exactement ce que les outils ont renvoyé/);
  });

  it("n'utilise ni tiret cadratin ni demi-cadratin", () => {
    expect(CHAT_TOOL_RULES).not.toMatch(/[–—]/);
  });

  it("s'ajoute à la fin du prompt, remplace les règles sans outils, y compris prompt vide", () => {
    const out = withChatGuardrails("Prompt admin", { hasTools: true });
    expect(out.startsWith("Prompt admin")).toBe(true);
    expect(out.endsWith(CHAT_TOOL_RULES)).toBe(true);
    expect(out).not.toContain(CHAT_NO_ACTION_RULES);
    expect(withChatGuardrails("", { hasTools: true })).toContain(CHAT_TOOL_RULES);
  });
});

describe("règles du chat selon le réglage des actions", () => {
  const off = { proposeUpdates: false, proposeDeletes: false, proposeMerges: false, proposeCreates: false };

  it("réglage par défaut : règles identiques à CHAT_TOOL_RULES", () => {
    expect(withChatGuardrails("p", { hasTools: true, actions: ALL_ON_CHAT_ACTIONS })).toBe(`p\n\n${CHAT_PRODUCT_RULES}\n\n${CHAT_TOOL_RULES}\n\n${buildChatCreationRules(ALL_ON_CHAT_ACTIONS)}`);
  });

  it("lecture seule : dit qu'aucune écriture n'est possible, ne promet ni proposition ni clic", () => {
    const rules = buildChatToolRules({ ...ALL_ON_CHAT_ACTIONS, ...off });
    expect(rules).toMatch(/lecture seule/);
    expect(rules).not.toMatch(/Appliquer|j.ai préparé une proposition|Tu peux seulement proposer/);
    expect(rules).not.toMatch(/[–—]/);
  });

  it("ne liste que les propositions activées", () => {
    const rules = buildChatToolRules({ ...ALL_ON_CHAT_ACTIONS, ...off, proposeMerges: true });
    expect(rules).toContain("proposer de fusionner des doublons");
    expect(rules).not.toMatch(/supprimer des lignes|créer des lignes|modifier des lignes/);
  });

  it("maître éteint ou lecture éteinte : règles sans outils", () => {
    expect(withChatGuardrails("p", { hasTools: true, actions: { ...ALL_ON_CHAT_ACTIONS, actionsEnabled: false } })).toBe(
      `p\n\n${CHAT_PRODUCT_RULES}\n\n${CHAT_NO_ACTION_RULES}`,
    );
    expect(withChatGuardrails("p", { hasTools: true, actions: { ...ALL_ON_CHAT_ACTIONS, readDatabases: false } })).toBe(
      `p\n\n${CHAT_PRODUCT_RULES}\n\n${CHAT_NO_ACTION_RULES}\n\n${buildChatCreationRules({ ...ALL_ON_CHAT_ACTIONS, readDatabases: false })}`,
    );
  });
});

describe("règles de documentation produit", () => {
  it("sont présentes avec ou sans outils et interdisent les intégrations inventées", () => {
    expect(withChatGuardrails("p")).toContain(CHAT_PRODUCT_RULES);
    expect(withChatGuardrails("p", { hasTools: true })).toContain(CHAT_PRODUCT_RULES);
    expect(CHAT_PRODUCT_RULES).toMatch(/product_docs/);
    expect(CHAT_PRODUCT_RULES).toMatch(/Zapier/);
    expect(CHAT_PRODUCT_RULES).toMatch(/appelle d'abord search_help/);
    expect(CHAT_PRODUCT_RULES).not.toContain("bouton « ? »");
    expect(CHAT_PRODUCT_RULES.toLowerCase()).not.toContain("bug");
  });
});

describe("règles de création de fichiers", () => {
  const none = { proposeSpreadsheets: false, proposeDocuments: false, proposePresentations: false };

  it("rien quand aucun interrupteur n'est actif ou que le maître est éteint", () => {
    expect(buildChatCreationRules({ ...ALL_ON_CHAT_ACTIONS, ...none })).toBe("");
    expect(buildChatCreationRules({ ...ALL_ON_CHAT_ACTIONS, actionsEnabled: false })).toBe("");
  });

  it("ne mentionne que les outils dont l'interrupteur est actif", () => {
    const r = buildChatCreationRules({ ...ALL_ON_CHAT_ACTIONS, ...none, proposeDocuments: true });
    expect(r).toContain("propose_create_document");
    expect(r).not.toMatch(/propose_create_spreadsheet|propose_create_presentation/);
    const all = buildChatCreationRules(ALL_ON_CHAT_ACTIONS);
    expect(all).toMatch(/propose_create_spreadsheet/);
    expect(all).toMatch(/propose_create_document/);
    expect(all).toMatch(/propose_create_presentation/);
  });

  it("explique quand proposer, l'espace éditeur et l'attente du clic, sans tiret cadratin", () => {
    const r = buildChatCreationRules(ALL_ON_CHAT_ACTIONS);
    expect(r).toMatch(/demande explicite/);
    expect(r).toMatch(/éditeur/);
    expect(r).toMatch(/avant le clic/);
    expect(r).not.toMatch(/[–—]/);
  });

  it("est ajoutée par withChatGuardrails, y compris lecture éteinte, garde-fous inchangés", () => {
    const out = withChatGuardrails("p", { hasTools: true, actions: ALL_ON_CHAT_ACTIONS });
    expect(out).toContain(CHAT_PRODUCT_RULES);
    expect(out).toContain(CHAT_TOOL_RULES);
    expect(out).toContain(buildChatCreationRules(ALL_ON_CHAT_ACTIONS));
    const noRead = withChatGuardrails("p", { hasTools: false, actions: { ...ALL_ON_CHAT_ACTIONS, readDatabases: false } });
    expect(noRead).toContain(CHAT_NO_ACTION_RULES);
    expect(noRead).toContain("propose_create_document");
    expect(withChatGuardrails("p", { hasTools: true, actions: { ...ALL_ON_CHAT_ACTIONS, ...none } })).not.toContain("propose_create");
  });
});
